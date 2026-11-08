<script lang="ts">
  import { planning } from '../state/planning.svelte';
  import { waypoints } from '../waypoints/store.svelte';
  import { i18n } from '../i18n.svelte';
</script>

<!-- Plan-mode toggle (E2.2): tap the map to add waypoints.
     Sits ABOVE the collapsed bottom sheet (z-30 so it is never cut by it) —
     the sheet publishes its live height as --sheet-h, so the button always
     clears the bar regardless of content or safe-area insets. The plan hint
     sits left of the button and disappears once the first waypoint exists.
     On phones the whole stack hides while the sheet is open. -->
<div
  class="pointer-events-none absolute right-4 bottom-[calc(env(safe-area-inset-bottom)+var(--sheet-h,10rem)+12px)] z-30 flex flex-row items-center gap-2 {planning
    .sheetExpanded
    ? 'hidden lg:flex'
    : 'flex'} lg:right-[calc(384px+1.5rem)] lg:bottom-6"
>
  {#if planning.mode === 'plan' && waypoints.waypoints.length === 0}
    <div
      class="rounded-full bg-orange-600 px-3 py-1.5 text-xs font-bold tracking-wide text-white shadow-lg ring-1 ring-orange-800"
    >
      {i18n.m.plan_hint()}
    </div>
  {/if}
  <button
    type="button"
    class="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-lg transition-colors {planning
      .mode ===
    'plan'
      ? 'border-orange-800 bg-orange-600 text-white'
      : 'border-slate-700 bg-white text-slate-900 hover:bg-orange-50 dark:border-slate-400 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800'}"
    aria-pressed={planning.mode === 'plan'}
    aria-label={i18n.m.plan_mode()}
    title={i18n.m.plan_mode()}
    onclick={() => planning.toggleMode()}
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="1.5" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22.5" />
      <line x1="1.5" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22.5" y2="12" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  </button>
</div>
