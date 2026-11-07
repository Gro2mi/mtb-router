<script lang="ts">
  import { i18n } from '../i18n.svelte';
  import LocaleSwitcher from './LocaleSwitcher.svelte';
  import Difficulty from './Difficulty.svelte';
  import RoutesTab from './RoutesTab.svelte';
  import RouteLegend from './RouteLegend.svelte';
  import ElevationProfile from './ElevationProfile.svelte';
  import { difficultyColor, WALKING_COLOR } from '../map/difficultyColors';
  import { planning, SNAP_RADIUS_CHOICES } from '../state/planning.svelte';
  import { waypoints } from '../waypoints/store.svelte';
  import { getTileBaseUrl, setTileBaseUrl } from '../osm/staticTiles';

  const route = $derived(planning.route);

  function formatKm(meters: number): string {
    return `${(meters / 1000).toLocaleString(i18n.locale, { maximumFractionDigits: 1 })} km`;
  }
  function formatM(meters: number): string {
    return `${Math.round(meters).toLocaleString(i18n.locale)} m`;
  }
  function formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const min = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h}:${String(min).padStart(2, '0')} h` : `${min} min`;
  }

  type Tab = 'route' | 'difficulty' | 'routes';

  let activeTab = $state<Tab>('route');

  // >= lg the panel is a persistent side drawer and always expanded (E1.4).
  let isDesktop = $state(false);
  $effect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => (isDesktop = mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  });

  const open = $derived(planning.sheetExpanded || isDesktop);
  const count = $derived(waypoints.waypoints.length);

  // phone usability: adding a waypoint in plan mode collapses the sheet so
  // the map (and the FAB) are visible again while planning
  $effect(() => {
    if (waypoints.waypoints.length > 0 && planning.mode === 'plan') {
      planning.sheetExpanded = false;
    }
  });

  /** whole collapsed bar opens on any tap (not just the handle) */
  function openOnBackground(e: MouseEvent): void {
    if ((e.target as Element | null)?.closest('button, a, input, select, label, details, summary')) {
      return;
    }
    planning.sheetExpanded = true;
  }

  let tileUrlDraft = $state(getTileBaseUrl() ?? '');

  function saveTileUrl(): void {
    setTileBaseUrl(tileUrlDraft);
    tileUrlDraft = getTileBaseUrl() ?? '';
    // a changed data source invalidates the loaded corridor
    planning.retry();
  }

  const tabs = $derived([
    { id: 'route' as Tab, label: () => i18n.m.tab_route() },
    { id: 'difficulty' as Tab, label: () => i18n.m.tab_difficulty() },
    { id: 'routes' as Tab, label: () => i18n.m.tab_routes() },
  ]);
</script>

<aside
  class="pointer-events-auto absolute inset-x-0 bottom-0 z-20 rounded-t-2xl border-t-2 border-orange-600 bg-white shadow-[0_-4px_16px_rgb(0_0_0/0.25)] lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:w-96 lg:rounded-none lg:border-t-0 lg:border-l-2 dark:border-orange-500 dark:bg-slate-900"
  data-testid="sheet"
>
  <div class="pb-[env(safe-area-inset-bottom)]">
    <!-- Mobile: drag-handle style toggle. Desktop drawer: nothing to toggle. -->
    <button
      type="button"
      class="flex min-h-11 w-full flex-col items-center justify-center lg:hidden"
      aria-expanded={open}
      aria-controls="sheet-content"
      onclick={() => (planning.sheetExpanded = !planning.sheetExpanded)}
    >
      <span class="h-1.5 w-12 rounded-full bg-slate-400 dark:bg-slate-500"></span>
      <span class="sr-only">{open ? i18n.m.sheet_collapse() : i18n.m.sheet_expand()}</span>
    </button>

    <!-- keyboard users toggle via the handle button below; these click
         handlers are pointer-convenience for touch phones -->
    <header
      role="presentation"
      class="flex items-center justify-between gap-2 px-4 pt-1 pb-2 lg:pt-4 {!open
        ? 'cursor-pointer'
        : ''}"
      onclick={!open ? openOnBackground : undefined}
    >
      <h1 class="text-base font-extrabold tracking-tight">{i18n.m.app_name()}</h1>
      <LocaleSwitcher />
    </header>

    {#if !open}
      <!-- Collapsed stats bar — live from the engine since E3. Any tap on it
           (or the header) opens the sheet; only the handle collapses again. -->
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
      <div
        role="group"
        class="grid cursor-pointer grid-cols-3 gap-2 px-4 pb-3 text-center"
        data-testid="stats-row"
        onclick={openOnBackground}
      >
        <div>
          <div class="text-lg font-extrabold tabular-nums" data-testid="stat-distance">
            {route ? formatKm(route.total.distanceM) : '–'}
          </div>
          <div class="text-xs font-medium text-slate-600 dark:text-slate-300">
            {i18n.m.stats_distance()}
          </div>
        </div>
        <div>
          <div class="text-lg font-extrabold tabular-nums" data-testid="stat-ascent">
            {route && route.elevationAvailable ? formatM(route.total.ascentM) : '–'}
          </div>
          <div class="text-xs font-medium text-slate-600 dark:text-slate-300">
            {i18n.m.stats_ascent()}
          </div>
        </div>
        <div>
          <div class="text-lg font-extrabold tabular-nums" data-testid="stat-duration">
            {route ? formatTime(route.total.timeS) : '–'}
          </div>
          <div class="text-xs font-medium text-slate-600 dark:text-slate-300">
            {i18n.m.stats_duration()}
          </div>
        </div>
      </div>
    {:else}
      <div id="sheet-content" class="px-4 pb-4">
        <div
          role="group"
          class="flex gap-1 rounded-xl border border-slate-300 bg-slate-100 p-1 dark:border-slate-600 dark:bg-slate-800"
        >
          {#each tabs as tab (tab.id)}
            <button
              type="button"
              class="flex h-11 flex-1 items-center justify-center rounded-lg px-2 text-sm font-bold transition-colors {activeTab ===
              tab.id
                ? 'bg-orange-600 text-white shadow dark:bg-orange-600 dark:text-white'
                : 'text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}"
              aria-pressed={activeTab === tab.id}
              onclick={() => (activeTab = tab.id)}
            >
              {tab.label()}
            </button>
          {/each}
        </div>

        <div class="mt-4 max-h-[45dvh] overflow-y-auto lg:max-h-[calc(100dvh-18rem)]">
          {#if activeTab === 'route'}
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-bold" data-testid="waypoint-count">
                {i18n.m.waypoints()}: {count}
              </span>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="h-11 rounded-lg border-2 border-slate-400 bg-white px-3 text-sm font-bold text-slate-900 transition-colors hover:border-orange-600 hover:text-orange-700 disabled:opacity-40 dark:border-slate-400 dark:bg-slate-900 dark:text-white dark:hover:border-orange-500"
                  disabled={count < 2}
                  onclick={() => waypoints.reverse()}
                >
                  {i18n.m.reverse()}
                </button>
                <button
                  type="button"
                  class="h-11 rounded-lg border-2 border-slate-400 bg-white px-3 text-sm font-bold text-slate-900 transition-colors hover:border-red-600 hover:text-red-700 disabled:opacity-40 dark:border-slate-400 dark:bg-slate-900 dark:text-white dark:hover:border-red-500"
                  disabled={count < 1}
                  onclick={() => waypoints.clear()}
                >
                  {i18n.m.clear()}
                </button>
              </div>
            </div>

            <label class="mt-4 flex items-center justify-between gap-2 text-sm">
              <span class="font-medium text-slate-700 dark:text-slate-200"
                >{i18n.m.snap_radius()}</span
              >
              <select
                class="h-11 rounded-lg border-2 border-slate-400 bg-white px-2 text-sm font-medium text-slate-900 dark:border-slate-400 dark:bg-slate-900 dark:text-white"
                value={planning.snapRadiusM}
                onchange={(e) => planning.setSnapRadius(Number(e.currentTarget.value))}
              >
                {#each SNAP_RADIUS_CHOICES as radius (radius)}
                  <option value={radius}>{radius} m</option>
                {/each}
              </select>
            </label>

            <details class="mt-4">
              <summary class="cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-200">
                {i18n.m.tiles_url_label()}
              </summary>
              <p class="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {i18n.m.tiles_url_hint()}
              </p>
              <div class="mt-2 flex gap-2">
                <input
                  type="url"
                  class="h-11 min-w-0 flex-1 rounded-lg border-2 border-slate-400 bg-white px-2 text-sm text-slate-900 dark:border-slate-400 dark:bg-slate-900 dark:text-white"
                  placeholder="https://example.at/tiles"
                  bind:value={tileUrlDraft}
                  data-testid="tiles-url-input"
                />
                <button
                  type="button"
                  class="h-11 shrink-0 rounded-lg border-2 border-slate-400 bg-white px-3 text-sm font-bold text-slate-900 hover:border-orange-600 hover:text-orange-700 dark:border-slate-400 dark:bg-slate-900 dark:text-white dark:hover:border-orange-500"
                  onclick={saveTileUrl}
                >
                  {i18n.m.tiles_url_save()}
                </button>
              </div>
            </details>

            {#if route}
              <div
                class="mt-4 grid grid-cols-3 gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 p-3 text-center dark:border-slate-700 dark:bg-slate-800"
                data-testid="route-stats"
              >
                <div>
                  <div class="text-base font-extrabold tabular-nums">
                    {formatKm(route.total.distanceM)}
                  </div>
                  <div class="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {i18n.m.stats_distance()}
                  </div>
                </div>
                <div>
                  <div class="text-base font-extrabold tabular-nums">
                    {route.elevationAvailable ? formatM(route.total.ascentM) : '–'}
                  </div>
                  <div class="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {i18n.m.stats_ascent()}
                  </div>
                </div>
                <div>
                  <div class="text-base font-extrabold tabular-nums">
                    {formatTime(route.total.timeS)}
                  </div>
                  <div class="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {i18n.m.stats_duration()}
                  </div>
                </div>
              </div>

              <!-- difficulty split + max slope (E5.2) -->
              <div class="mt-3" data-testid="difficulty-breakdown">
                <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
                  {#each route.kmByMtb as km, level (level)}
                    {#if km > 0}
                      <span class="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                        <span
                          class="inline-block h-3 w-3 rounded-sm"
                          style={`background: ${difficultyColor(level)}`}
                          aria-hidden="true"
                        ></span>
                        S{level}: {formatKm(km * 1000)}
                      </span>
                    {/if}
                  {/each}
                  {#if (route.kmWalking ?? 0) > 0}
                    <span class="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <span
                        class="inline-block h-3 w-3 rounded-sm"
                        style={`background: ${WALKING_COLOR}`}
                        aria-hidden="true"
                      ></span>
                      {i18n.m.breakdown_walking()}: {formatKm((route.kmWalking ?? 0) * 1000)}
                    </span>
                  {/if}
                  {#if (route.kmBeeline ?? 0) > 0}
                    <span class="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <span
                        class="inline-block h-3 w-3 rounded-sm border-2 border-dashed border-amber-500"
                        aria-hidden="true"
                      ></span>
                      {i18n.m.breakdown_beeline()}: {formatKm((route.kmBeeline ?? 0) * 1000)}
                    </span>
                  {/if}
                </div>
                {#if route.elevationAvailable && (route.total.maxSlope ?? 0) > 0}
                  <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {i18n.m.max_slope()}: {Math.round((route.total.maxSlope ?? 0) * 100)} %
                  </p>
                {/if}
              </div>

              <RouteLegend />
              {#if route.elevationAvailable}
                <ElevationProfile {route} />
              {:else}
                <p class="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  {i18n.m.profile_degraded()}
                </p>
              {/if}
            {:else}
              <p class="mt-4 font-bold" data-testid="route-empty">{i18n.m.stats_empty()}</p>
              <p class="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {count === 0 ? i18n.m.route_empty_hint() : i18n.m.route_next_hint()}
              </p>
            {/if}
          {:else if activeTab === 'difficulty'}
            <Difficulty />
          {:else}
            <RoutesTab />
          {/if}
        </div>

        <footer
          class="mt-4 space-y-1 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400"
        >
          <p>
            <a
              class="underline"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              {i18n.m.attribution_data()}
            </a>
          </p>
          <p>{i18n.m.attribution_tiles()}</p>
          <p>{i18n.m.attribution_elevation()}</p>
        </footer>
      </div>
    {/if}
  </div>
</aside>
