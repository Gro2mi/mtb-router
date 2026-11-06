<script lang="ts">
  /**
   * Difficulty preference panel (E4.1/E4.2/E4.4, PLAN §7.2): presets,
   * uphill/downhill MTB + SAC bands as dual-handle sliders, forest-road
   * preference (4-step), untagged-singletrail toggle and scale education.
   */
  import { planning } from '../state/planning.svelte';
  import { i18n } from '../i18n.svelte';
  import RangeSlider from './RangeSlider.svelte';
  import { PRESETS, matchPreset, type PresetId } from './presets';
  import type { DifficultyBands, RiderSettings } from '../../engine/protocol';

  const settings = $derived(planning.settings);
  const activePreset = $derived(matchPreset(settings));

  const FOREST_STEPS = [0, 1 / 3, 2 / 3, 1] as const;
  const forestLabels = [
    () => i18n.m.diff_forest_0(),
    () => i18n.m.diff_forest_1(),
    () => i18n.m.diff_forest_2(),
    () => i18n.m.diff_forest_3(),
  ];
  const presetLabels: Record<string, () => string> = {
    easy: () => i18n.m.preset_easy(),
    allmountain: () => i18n.m.preset_allmountain(),
    enduro: () => i18n.m.preset_enduro(),
  };

  function apply(next: RiderSettings): void {
    planning.setSettings(next);
  }

  function applyPreset(id: PresetId): void {
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) apply(structuredClone(preset.settings));
  }

  function setBand(
    direction: 'uphill' | 'downhill',
    kind: 'mtb' | 'sac',
    valueMin: number,
    valueMax: number,
  ): void {
    const dir: DifficultyBands = settings[direction];
    apply({ ...settings, [direction]: { ...dir, [kind]: { min: valueMin, max: valueMax } } });
  }

  function setForest(step: number): void {
    apply({ ...settings, forestRoadPreference: FOREST_STEPS[step]! });
  }

  const forestStep = $derived(
    FOREST_STEPS.findIndex((v) => Math.abs(v - settings.forestRoadPreference) < 0.17),
  );
</script>

<div class="space-y-5" data-testid="difficulty-panel">
  <!-- presets -->
  <div>
    <div
      role="group"
      class="grid grid-cols-4 gap-1 rounded-xl border border-slate-300 bg-slate-100 p-1 dark:border-slate-600 dark:bg-slate-800"
      aria-label={i18n.m.diff_presets()}
    >
      {#each PRESETS as preset (preset.id)}
        <button
          type="button"
          class="flex h-11 items-center justify-center rounded-lg px-1 text-xs font-bold transition-colors {activePreset ===
          preset.id
            ? 'bg-orange-600 text-white'
            : 'text-slate-700 hover:text-orange-700 dark:text-slate-300 dark:hover:text-orange-400'}"
          aria-pressed={activePreset === preset.id}
          onclick={() => applyPreset(preset.id)}
        >
          {presetLabels[preset.id]?.() ?? preset.id}
        </button>
      {/each}
    </div>
    {#if activePreset === 'custom'}
      <p class="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
        {i18n.m.preset_custom()}
      </p>
    {/if}
  </div>

  <!-- uphill -->
  <section aria-label={i18n.m.diff_uphill()}>
    <h3 class="text-sm font-extrabold tracking-wide text-orange-700 uppercase dark:text-orange-400">
      ↑ {i18n.m.diff_uphill()}
    </h3>
    <div class="mt-2">
      <div class="flex items-baseline justify-between">
        <span class="text-sm font-bold">{i18n.m.diff_mtb_scale()}</span>
        <span class="text-sm font-bold text-orange-700 tabular-nums dark:text-orange-400">
          {i18n.m.diff_range({
            prefix: 'S',
            min: settings.uphill.mtb.min,
            max: settings.uphill.mtb.max,
          })}
        </span>
      </div>
      <RangeSlider
        uid="up-mtb"
        min={0}
        max={5}
        valueMin={settings.uphill.mtb.min}
        valueMax={settings.uphill.mtb.max}
        ariaLabelMin={`${i18n.m.diff_up_mtb()} · ${i18n.m.diff_min()}`}
        ariaLabelMax={`${i18n.m.diff_up_mtb()} · ${i18n.m.diff_max()}`}
        change={(lo, hi) => setBand('uphill', 'mtb', lo, hi)}
      />
    </div>
    <div class="mt-3">
      <div class="flex items-baseline justify-between">
        <span class="text-sm font-bold">{i18n.m.diff_sac_scale()}</span>
        <span class="text-sm font-bold text-orange-700 tabular-nums dark:text-orange-400">
          {i18n.m.diff_range({
            prefix: 'T',
            min: settings.uphill.sac.min,
            max: settings.uphill.sac.max,
          })}
        </span>
      </div>
      <RangeSlider
        uid="up-sac"
        min={1}
        max={6}
        valueMin={settings.uphill.sac.min}
        valueMax={settings.uphill.sac.max}
        ariaLabelMin={`${i18n.m.diff_up_sac()} · ${i18n.m.diff_min()}`}
        ariaLabelMax={`${i18n.m.diff_up_sac()} · ${i18n.m.diff_max()}`}
        change={(lo, hi) => setBand('uphill', 'sac', lo, hi)}
      />
    </div>
  </section>

  <!-- downhill -->
  <section aria-label={i18n.m.diff_downhill()}>
    <h3 class="text-sm font-extrabold tracking-wide text-orange-700 uppercase dark:text-orange-400">
      ↓ {i18n.m.diff_downhill()}
    </h3>
    <div class="mt-2">
      <div class="flex items-baseline justify-between">
        <span class="text-sm font-bold">{i18n.m.diff_mtb_scale()}</span>
        <span class="text-sm font-bold text-orange-700 tabular-nums dark:text-orange-400">
          {i18n.m.diff_range({
            prefix: 'S',
            min: settings.downhill.mtb.min,
            max: settings.downhill.mtb.max,
          })}
        </span>
      </div>
      <RangeSlider
        uid="down-mtb"
        min={0}
        max={6}
        valueMin={settings.downhill.mtb.min}
        valueMax={settings.downhill.mtb.max}
        ariaLabelMin={`${i18n.m.diff_down_mtb()} · ${i18n.m.diff_min()}`}
        ariaLabelMax={`${i18n.m.diff_down_mtb()} · ${i18n.m.diff_max()}`}
        change={(lo, hi) => setBand('downhill', 'mtb', lo, hi)}
      />
    </div>
    <div class="mt-3">
      <div class="flex items-baseline justify-between">
        <span class="text-sm font-bold">{i18n.m.diff_sac_scale()}</span>
        <span class="text-sm font-bold text-orange-700 tabular-nums dark:text-orange-400">
          {i18n.m.diff_range({
            prefix: 'T',
            min: settings.downhill.sac.min,
            max: settings.downhill.sac.max,
          })}
        </span>
      </div>
      <RangeSlider
        uid="down-sac"
        min={1}
        max={6}
        valueMin={settings.downhill.sac.min}
        valueMax={settings.downhill.sac.max}
        ariaLabelMin={`${i18n.m.diff_down_sac()} · ${i18n.m.diff_min()}`}
        ariaLabelMax={`${i18n.m.diff_down_sac()} · ${i18n.m.diff_max()}`}
        change={(lo, hi) => setBand('downhill', 'sac', lo, hi)}
      />
    </div>
  </section>

  <!-- forest-road preference: 4-step control (E4.1) -->
  <div>
    <span class="text-sm font-bold">{i18n.m.diff_forest()}</span>
    <div
      role="group"
      aria-label={i18n.m.diff_forest()}
      class="mt-1 grid grid-cols-4 gap-1 rounded-xl border border-slate-300 bg-slate-100 p-1 dark:border-slate-600 dark:bg-slate-800"
    >
      {#each [0, 1, 2, 3] as step (step)}
        <button
          type="button"
          class="flex h-11 items-center justify-center rounded-lg px-1 text-xs font-bold transition-colors {forestStep ===
          step
            ? 'bg-orange-600 text-white'
            : 'text-slate-700 hover:text-orange-700 dark:text-slate-300 dark:hover:text-orange-400'}"
          aria-pressed={forestStep === step}
          onclick={() => setForest(step)}
        >
          {forestLabels[step]?.() ?? step}
        </button>
      {/each}
    </div>
  </div>

  <!-- safety toggle (E4.4) -->
  <label class="flex min-h-11 items-center justify-between gap-3 text-sm font-bold">
    <span>{i18n.m.diff_avoid_untagged()}</span>
    <input
      type="checkbox"
      class="h-6 w-6 accent-orange-600"
      checked={settings.avoidUntaggedSingletrail}
      onchange={(e) => apply({ ...settings, avoidUntaggedSingletrail: e.currentTarget.checked })}
    />
  </label>

  <!-- education (E4.4) -->
  <div
    class="space-y-1.5 rounded-xl border-2 border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
  >
    <p>{i18n.m.diff_bands_hint()}</p>
    <p>{i18n.m.diff_mtb_hint()}</p>
    <p>{i18n.m.diff_sac_hint()}</p>
    <p>{i18n.m.diff_legend()}</p>
  </div>
</div>
