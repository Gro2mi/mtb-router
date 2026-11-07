<script lang="ts">
  /**
   * Difficulty legend (E5.1): colored chips S0–S6 + walking, tagged vs
   * inferred note.
   */
  import { i18n } from '../i18n.svelte';
  import { difficultyColor, WALKING_COLOR } from '../map/difficultyColors';

  const levels = [0, 1, 2, 3, 4, 5, 6];
  const labels = [
    () => i18n.m.legend_s0(),
    () => i18n.m.legend_s1(),
    () => i18n.m.legend_s2(),
    () => i18n.m.legend_s3(),
    () => i18n.m.legend_s4(),
    () => i18n.m.legend_s5(),
    () => i18n.m.legend_s6(),
  ];
</script>

<div class="mt-3" data-testid="route-legend">
  <div class="flex flex-wrap gap-x-3 gap-y-1.5">
    {#each levels as level (level)}
      <span class="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
        <span
          class="inline-block h-3 w-3 rounded-sm"
          style={`background: ${difficultyColor(level)}`}
          aria-hidden="true"
        ></span>
        S{level}
        {labels[level]?.() ?? ''}
      </span>
    {/each}
    <span class="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
      <span
        class="inline-block h-3 w-3 rounded-sm"
        style={`background: ${WALKING_COLOR}`}
        aria-hidden="true"
      ></span>
      {i18n.m.legend_walk()}
    </span>
  </div>
  <p class="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{i18n.m.legend_note()}</p>
</div>
