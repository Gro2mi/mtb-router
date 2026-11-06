<script lang="ts">
  import { toasts } from '../state/toast.svelte';
</script>

{#if toasts.length > 0}
  <div
    class="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col items-center gap-2 px-4 pt-[max(env(safe-area-inset-top),0.75rem)]"
  >
    {#each toasts as t (t.id)}
      <div
        role="status"
        class="rounded-lg bg-slate-900/90 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-slate-100/95 dark:text-slate-900"
      >
        {t.text}
      </div>
    {/each}
  </div>
{/if}
