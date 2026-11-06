<script lang="ts">
  /**
   * Routes tab (E6.1/E6.2): save the current route, list saved ones with
   * load / GPX / rename / duplicate / delete. All targets ≥ 44 px.
   */
  import { onMount } from 'svelte';
  import { i18n } from '../i18n.svelte';
  import { routeLibrary } from '../routes/routeLibrary.svelte';
  import { planning } from '../state/planning.svelte';
  import type { StoredRoute } from '../routes/serialization';

  let nameDraft = $state('');
  let editingId = $state<string | null>(null);
  let editDraft = $state('');

  const canSave = $derived(planning.route !== null && planning.route.legs.length > 0);

  onMount(() => {
    void routeLibrary.refresh();
  });

  async function save(): Promise<void> {
    const ok = await routeLibrary.saveCurrent(nameDraft);
    if (ok) nameDraft = '';
  }

  function fmtKm(meters: number): string {
    return `${(meters / 1000).toLocaleString(i18n.locale, { maximumFractionDigits: 1 })} km`;
  }

  function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString(i18n.locale);
  }

  function startEdit(route: StoredRoute): void {
    editingId = route.id;
    editDraft = route.name;
  }

  async function commitEdit(): Promise<void> {
    if (editingId !== null) await routeLibrary.rename(editingId, editDraft);
    editingId = null;
  }
</script>

<div class="space-y-4" data-testid="routes-panel">
  <!-- save current -->
  <div class="flex gap-2">
    <input
      type="text"
      class="h-11 min-w-0 flex-1 rounded-lg border-2 border-slate-400 bg-white px-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-400 dark:bg-slate-900 dark:text-white"
      placeholder={i18n.m.route_name_placeholder()}
      bind:value={nameDraft}
      data-testid="route-name-input"
      onkeydown={(e) => {
        if (e.key === 'Enter') void save();
      }}
    />
    <button
      type="button"
      class="h-11 shrink-0 rounded-lg border-2 border-orange-700 bg-orange-600 px-3 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-40"
      disabled={!canSave || routeLibrary.busy}
      onclick={save}
      data-testid="route-save"
    >
      {i18n.m.route_save()}
    </button>
  </div>
  {#if !canSave}
    <p class="text-xs text-slate-500 dark:text-slate-400">{i18n.m.routes_save_hint()}</p>
  {/if}

  <!-- list -->
  {#if routeLibrary.routes.length === 0}
    <p
      class="text-sm leading-relaxed text-slate-600 dark:text-slate-300"
      data-testid="routes-empty"
    >
      {i18n.m.routes_empty_hint()}
    </p>
  {:else}
    <ul class="space-y-2" data-testid="routes-list">
      {#each routeLibrary.routes as route (route.id)}
        <li
          class="rounded-xl border-2 border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800"
        >
          {#if editingId === route.id}
            <div class="flex gap-2">
              <input
                type="text"
                class="h-11 min-w-0 flex-1 rounded-lg border-2 border-orange-600 bg-white px-2 text-sm text-slate-900 dark:bg-slate-900 dark:text-white"
                bind:value={editDraft}
                onkeydown={(e) => {
                  if (e.key === 'Enter') void commitEdit();
                }}
              />
              <button
                type="button"
                class="h-11 shrink-0 rounded-lg border-2 border-orange-700 bg-orange-600 px-3 text-sm font-bold text-white"
                onclick={commitEdit}
              >
                ✓
              </button>
            </div>
          {:else}
            <button
              type="button"
              class="block w-full rounded-lg px-1 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
              onclick={() => void routeLibrary.load(route.id)}
              data-testid={`route-load-${route.name}`}
            >
              <span class="block truncate text-sm font-extrabold text-slate-900 dark:text-white">
                {route.name}
              </span>
              <span class="block text-xs text-slate-500 dark:text-slate-400">
                {route.route ? fmtKm(route.route.total.distanceM) : '–'}
                · {fmtDate(route.updatedAt)}
              </span>
            </button>
            <div class="mt-1 flex gap-1">
              <button
                type="button"
                class="h-11 flex-1 rounded-lg border-2 border-slate-300 bg-white text-xs font-bold text-slate-900 hover:border-orange-600 hover:text-orange-700 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                onclick={() => void routeLibrary.exportSaved(route.id)}
                data-testid={`route-gpx-${route.name}`}
              >
                GPX
              </button>
              <button
                type="button"
                class="h-11 flex-1 rounded-lg border-2 border-slate-300 bg-white text-xs font-bold text-slate-900 hover:border-orange-600 hover:text-orange-700 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                onclick={() => startEdit(route)}
              >
                {i18n.m.route_rename()}
              </button>
              <button
                type="button"
                class="h-11 flex-1 rounded-lg border-2 border-slate-300 bg-white text-xs font-bold text-slate-900 hover:border-orange-600 hover:text-orange-700 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                onclick={() => void routeLibrary.duplicate(route.id)}
              >
                {i18n.m.route_duplicate()}
              </button>
              <button
                type="button"
                class="h-11 flex-1 rounded-lg border-2 border-slate-300 bg-white text-xs font-bold text-slate-900 hover:border-red-600 hover:text-red-700 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                onclick={() => void routeLibrary.remove(route.id)}
                data-testid={`route-delete-${route.name}`}
              >
                {i18n.m.route_delete()}
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
