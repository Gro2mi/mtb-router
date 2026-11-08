<script lang="ts">
  /**
   * Dual-handle range slider (E4.1): two stacked native range inputs — fully
   * keyboard accessible, ≥ 44 px touch target, accent-colored selection band.
   */
  interface Props {
    min: number;
    max: number;
    valueMin: number;
    valueMax: number;
    ariaLabelMin: string;
    ariaLabelMax: string;
    change: (valueMin: number, valueMax: number) => void;
    uid: string;
  }

  const { min, max, valueMin, valueMax, ariaLabelMin, ariaLabelMax, change, uid }: Props = $props();

  let lo = $state(valueMin);
  let hi = $state(valueMax);

  // keep in sync when the parent changes values (e.g. preset applied)
  $effect(() => {
    lo = valueMin;
    hi = valueMax;
  });

  const pct = $derived.by(() => {
    const span = max - min;
    const start = ((Math.min(lo, hi) - min) / span) * 100;
    const end = ((Math.max(lo, hi) - min) / span) * 100;
    return { start, width: end - start };
  });

  function onLo(event: Event): void {
    const raw = Number((event.currentTarget as HTMLInputElement).value);
    const next = Math.min(raw, hi);
    lo = next;
    change(next, hi);
  }
  function onHi(event: Event): void {
    const raw = Number((event.currentTarget as HTMLInputElement).value);
    const next = Math.max(raw, lo);
    hi = next;
    change(lo, next);
  }
</script>

<div class="relative flex h-11 w-full items-center" data-testid={`range-${uid}`}>
  <div class="absolute inset-x-0 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"></div>
  <div
    class="absolute h-1.5 rounded-full bg-orange-600"
    style={`left: ${pct.start}%; width: ${pct.width}%;`}
  ></div>
  <input
    type="range"
    class="mtbr-range"
    style={`z-index: ${lo > max - 1 ? 3 : 1};`}
    {min}
    {max}
    step="1"
    value={lo}
    aria-label={ariaLabelMin}
    oninput={onLo}
  />
  <input
    type="range"
    class="mtbr-range"
    style="z-index: 2;"
    {min}
    {max}
    step="1"
    value={hi}
    aria-label={ariaLabelMax}
    oninput={onHi}
  />
</div>
