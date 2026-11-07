<script lang="ts">
  /**
   * Elevation profile (E5.3): canvas profile colored by segment difficulty,
   * scrub ↔ map marker sync, highlight band from segment clicks.
   */
  import { i18n } from '../i18n.svelte';
  import { buildProfileData, profileAt } from '../profile/profileData';
  import { profileState } from '../state/profile.svelte';
  import type { RouteResult } from '../../engine/protocol';

  let { route }: { route: RouteResult } = $props();

  const HEIGHT = 110;
  let canvas: HTMLCanvasElement;
  let dragging = $state(false);

  const data = $derived(buildProfileData(route));

  function draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas?.clientWidth ?? 0;
    if (width === 0) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const eleSpan = Math.max(1, data.maxEle - data.minEle);
    const x = (dM: number): number => (dM / Math.max(1, data.totalM)) * (width - 4) + 2;
    const y = (ele: number): number => HEIGHT - 8 - ((ele - data.minEle) / eleSpan) * (HEIGHT - 22);

    const highlight = profileState.highlight;
    if (highlight) {
      ctx.fillStyle = 'rgba(234, 88, 12, 0.18)';
      const x0 = x(highlight.startM);
      ctx.fillRect(x0, 0, Math.max(2, x(highlight.endM) - x0), HEIGHT);
    }

    // area fill
    ctx.beginPath();
    let started = false;
    for (const s of data.samples) {
      if (s.ele === null) continue;
      const px = x(s.dM);
      const py = y(s.ele);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    if (started) {
      ctx.lineTo(x(data.totalM), HEIGHT);
      ctx.lineTo(x(0), HEIGHT);
      ctx.closePath();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
      ctx.fill();
    }

    // difficulty-colored line
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    for (let i = 1; i < data.samples.length; i++) {
      const a = data.samples[i - 1]!;
      const b = data.samples[i]!;
      if (a.ele === null || b.ele === null) continue;
      ctx.strokeStyle = b.color ?? '#0f172a';
      ctx.beginPath();
      ctx.moveTo(x(a.dM), y(a.ele));
      ctx.lineTo(x(b.dM), y(b.ele));
      ctx.stroke();
    }

    // scrub cursor
    const scrub = profileState.scrub;
    if (scrub?.ele !== null && scrub?.ele !== undefined) {
      const px = x(scrub.dM);
      const py = y(scrub.ele);
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = '600 11px system-ui, sans-serif';
      const label = `${Math.round(scrub.ele)} m`;
      const textX = Math.min(px + 6, width - 42);
      ctx.fillText(label, textX, Math.max(12, py - 8));
    }
  }

  $effect(() => {
    // track everything that changes the drawing
    void data;
    void profileState.highlight;
    void profileState.scrub;
    draw();
  });

  $effect(() => {
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  });

  function dMFromEvent(e: PointerEvent): number {
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return frac * data.totalM;
  }

  function updateScrub(e: PointerEvent): void {
    const dM = dMFromEvent(e);
    const sample = profileAt(data, dM);
    if (sample) {
      profileState.setScrub({ dM, lat: sample.lat, lng: sample.lng, ele: sample.ele });
    }
  }

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    updateScrub(e);
  }
  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    updateScrub(e);
  }
  function onPointerUp(e: PointerEvent): void {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  }
</script>

<div class="mt-3">
  <p class="mb-1 text-xs font-bold text-slate-600 dark:text-slate-300">{i18n.m.profile_title()}</p>
  <canvas
    bind:this={canvas}
    class="mtbr-profile h-[110px] w-full touch-none rounded-lg border-2 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
    data-testid="elevation-profile"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  ></canvas>
  <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">{i18n.m.profile_hint()}</p>
</div>
