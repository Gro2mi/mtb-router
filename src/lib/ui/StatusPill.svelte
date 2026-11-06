<script lang="ts">
  import { planning } from '../state/planning.svelte';
  import { i18n } from '../i18n.svelte';
</script>

<!-- Corridor loading status (E2.3/E3): stages, widening, errors with retry. -->
{#if planning.phase === 'loading'}
  <div
    class="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4"
    role="status"
  >
    <div
      class="flex items-center gap-2 rounded-full border-2 border-slate-700 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-900 shadow-lg dark:border-slate-400 dark:bg-slate-900 dark:text-white"
    >
      <span class="mtbr-spinner text-orange-600" aria-hidden="true"></span>
      {planning.widening
        ? i18n.m.widening_search()
        : planning.stage === 0
          ? i18n.m.loading_tiles()
          : planning.stage === 1
            ? i18n.m.loading_trails()
            : planning.stage === 2
              ? i18n.m.loading_roads()
              : planning.stage === 3
                ? i18n.m.loading_fallback()
                : i18n.m.loading_elevation()}
    </div>
  </div>
{:else if planning.phase === 'error'}
  <div class="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
    <div
      class="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl border-2 border-red-800 bg-red-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg"
      role="alert"
      data-testid="route-error"
    >
      <div class="flex items-center gap-2">
        {planning.errorCode === 'waypoint'
          ? i18n.m.error_waypoint()
          : planning.errorCode === 'no_route'
            ? i18n.m.error_no_route()
            : i18n.m.corridor_error()}
        <button
          type="button"
          class="rounded-full bg-white px-2 py-0.5 font-bold text-red-700 hover:bg-red-50"
          onclick={() => planning.retry()}
        >
          {i18n.m.retry()}
        </button>
      </div>
      {#if planning.errorCode === 'corridor'}
        <span class="font-medium opacity-95">{i18n.m.corridor_error_hint()}</span>
      {/if}
    </div>
  </div>
{/if}
