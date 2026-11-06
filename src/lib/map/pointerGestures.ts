/**
 * Pointer gesture abstraction (E1.3): classifies tap / long-press from pointer
 * events so touch, pen and mouse produce identical interactions on the map.
 * E2 builds waypoint editing on top of this.
 *
 * `createGestureClassifier` is a pure state machine (clock injected for tests);
 * `bindGestures` wires it to a DOM element with element-relative coordinates.
 */
export interface GesturePoint {
  x: number;
  y: number;
  pointerId: number;
  /** original event target (markup guards, e.g. ignore taps on markers) */
  target?: EventTarget | null;
}

export interface GestureCallbacks {
  onTap?: (point: GesturePoint) => void;
  onLongPress?: (point: GesturePoint) => void;
}

export interface GestureOptions {
  /** Hold time before a long-press fires (default 500 ms). */
  longPressMs?: number;
  /** Cumulative movement that cancels tap/long-press classification (default 8 px). */
  moveTolerancePx?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface ActivePointer {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startAt: number;
  moved: boolean;
  longPressFired: boolean;
  target: EventTarget | null;
}

export interface GestureClassifier {
  pointerdown(x: number, y: number, pointerId: number): void;
  pointermove(x: number, y: number, pointerId: number): void;
  pointerup(x: number, y: number, pointerId: number): void;
  pointercancel(pointerId: number): void;
  /** Remember the DOM target of the initial pointerdown (markup guards). */
  setTarget(target: EventTarget | null): void;
  /** Call periodically while a pointer is down; fires long-press when due. */
  tick(): void;
  isActive(): boolean;
}

export function createGestureClassifier(
  callbacks: GestureCallbacks,
  options: GestureOptions = {},
): GestureClassifier {
  const longPressMs = options.longPressMs ?? 500;
  const tolerance = options.moveTolerancePx ?? 8;
  const now = options.now ?? (() => performance.now());

  let active: ActivePointer | null = null;

  const distanceFromStart = (p: ActivePointer, x: number, y: number): number =>
    Math.hypot(x - p.startX, y - p.startY);

  return {
    pointerdown(x, y, pointerId) {
      if (active) {
        // a second finger joins — a pinch/rotate begins and the pending
        // tap/long-press gesture is dead
        active = null;
        return;
      }
      active = {
        pointerId,
        startX: x,
        startY: y,
        x,
        y,
        startAt: now(),
        moved: false,
        longPressFired: false,
        target: null,
      };
    },

    pointermove(x, y, pointerId) {
      if (!active || active.pointerId !== pointerId) return;
      if (distanceFromStart(active, x, y) > tolerance) active.moved = true;
      active.x = x;
      active.y = y;
    },

    pointerup(x, y, pointerId) {
      if (!active || active.pointerId !== pointerId) return;
      const gesture = active;
      active = null;
      if (gesture.moved || gesture.longPressFired) return;
      const held = now() - gesture.startAt;
      if (held >= longPressMs) {
        // hold exceeded the threshold but ticks were delayed (busy main
        // thread / browser throttling) — classify at release time
        callbacks.onLongPress?.({ x, y, pointerId, target: gesture.target });
      } else {
        callbacks.onTap?.({ x, y, pointerId, target: gesture.target });
      }
    },

    pointercancel(pointerId) {
      if (active?.pointerId === pointerId) active = null;
    },

    setTarget(target) {
      if (active) active.target = target;
    },

    tick() {
      if (!active || active.moved || active.longPressFired) return;
      if (now() - active.startAt >= longPressMs) {
        active.longPressFired = true;
        callbacks.onLongPress?.({
          x: active.x,
          y: active.y,
          pointerId: active.pointerId,
          target: active.target,
        });
      }
    },

    isActive() {
      return active !== null;
    },
  };
}

export interface GestureBinding {
  destroy(): void;
}

/**
 * Binds gesture classification to an element. Pointer coordinates are converted
 * to be relative to `el` before classification. Does not preventDefault or stop
 * propagation of pointer events, so map panning keeps working.
 */
export function bindGestures(
  el: HTMLElement,
  callbacks: GestureCallbacks,
  options: GestureOptions = {},
): GestureBinding {
  const classifier = createGestureClassifier(callbacks, options);

  const toLocal = (e: PointerEvent): { x: number; y: number } => {
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  let tickTimer: ReturnType<typeof setInterval> | undefined;
  const stopTicking = (): void => {
    if (tickTimer !== undefined) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  };

  const onPointerDown = (e: PointerEvent): void => {
    const { x, y } = toLocal(e);
    classifier.pointerdown(x, y, e.pointerId);
    classifier.setTarget(e.target);
    if (e.isPrimary && tickTimer === undefined) {
      tickTimer = setInterval(() => classifier.tick(), 80);
    }
  };
  const onPointerMove = (e: PointerEvent): void => {
    const { x, y } = toLocal(e);
    classifier.pointermove(x, y, e.pointerId);
  };
  const onPointerUp = (e: PointerEvent): void => {
    const { x, y } = toLocal(e);
    classifier.pointerup(x, y, e.pointerId);
    if (!classifier.isActive()) stopTicking();
  };
  const onPointerCancel = (e: PointerEvent): void => {
    classifier.pointercancel(e.pointerId);
    stopTicking();
  };
  // suppress the browser's own long-press context menu on the map surface
  const onContextMenu = (e: Event): void => e.preventDefault();

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerCancel);
  el.addEventListener('contextmenu', onContextMenu);

  return {
    destroy() {
      stopTicking();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
