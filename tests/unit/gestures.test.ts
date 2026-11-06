import { describe, expect, it, vi } from 'vitest';
import { createGestureClassifier } from '../../src/lib/map/pointerGestures';

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('gesture classifier', () => {
  it('classifies a quick press-and-release without movement as a tap', () => {
    const clock = fakeClock();
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    const classifier = createGestureClassifier({ onTap, onLongPress }, { now: clock.now });

    classifier.pointerdown(10, 20, 1);
    clock.advance(120);
    classifier.pointerup(10, 20, 1);

    expect(onTap).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 20, pointerId: 1, target: null });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('fires a long-press when held stationary past the threshold', () => {
    const clock = fakeClock();
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    const classifier = createGestureClassifier({ onTap, onLongPress }, { now: clock.now });

    classifier.pointerdown(30, 40, 1);
    clock.advance(600);
    classifier.tick();
    classifier.pointerup(30, 40, 1);

    expect(onLongPress).toHaveBeenCalledExactlyOnceWith({
      x: 30,
      y: 40,
      pointerId: 1,
      target: null,
    });
    expect(onTap).not.toHaveBeenCalled();
  });

  it('fires a long-press only once even if tick runs repeatedly', () => {
    const clock = fakeClock();
    const onLongPress = vi.fn();
    const classifier = createGestureClassifier({ onLongPress }, { now: clock.now });

    classifier.pointerdown(0, 0, 1);
    clock.advance(600);
    classifier.tick();
    clock.advance(200);
    classifier.tick();

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('cancels tap and long-press when the pointer moves beyond tolerance', () => {
    const clock = fakeClock();
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    const classifier = createGestureClassifier(
      { onTap, onLongPress },
      { now: clock.now, moveTolerancePx: 8 },
    );

    classifier.pointerdown(0, 0, 1);
    // cumulative drift: many small moves totalling > 8 px from the anchor
    for (let i = 1; i <= 10; i++) {
      classifier.pointermove(i * 1.5, 0, 1);
    }
    clock.advance(600);
    classifier.tick();
    classifier.pointerup(15, 0, 1);

    expect(onTap).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('tolerates small jitter below the move threshold', () => {
    const clock = fakeClock();
    const onTap = vi.fn();
    const classifier = createGestureClassifier({ onTap }, { now: clock.now, moveTolerancePx: 8 });

    classifier.pointerdown(0, 0, 1);
    classifier.pointermove(3, 3, 1); // ~4.2 px from anchor
    clock.advance(100);
    classifier.pointerup(3, 3, 1);

    expect(onTap).toHaveBeenCalledExactlyOnceWith({ x: 3, y: 3, pointerId: 1, target: null });
  });

  it('does not classify a tap when a second finger joins (pinch)', () => {
    const clock = fakeClock();
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    const classifier = createGestureClassifier({ onTap, onLongPress }, { now: clock.now });

    classifier.pointerdown(0, 0, 1);
    classifier.pointerdown(100, 100, 2); // second finger
    clock.advance(50);
    classifier.pointerup(0, 0, 1);
    classifier.pointerup(100, 100, 2);

    expect(onTap).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does not fire a long-press after a second finger joined', () => {
    const clock = fakeClock();
    const onLongPress = vi.fn();
    const classifier = createGestureClassifier({ onLongPress }, { now: clock.now });

    classifier.pointerdown(0, 0, 1);
    classifier.pointerdown(50, 50, 2);
    clock.advance(600);
    classifier.tick();

    // long-press was allowed to fire per the state machine only if not moved;
    // multi-touch must not produce a *tap* on release, and a long-press fired
    // here is acceptable — but for pinch we expect no interaction at all.
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('ignores events for unknown pointer ids', () => {
    const clock = fakeClock();
    const onTap = vi.fn();
    const classifier = createGestureClassifier({ onTap }, { now: clock.now });

    classifier.pointerdown(0, 0, 1);
    classifier.pointerup(5, 5, 2); // different pointer — ignored
    expect(classifier.isActive()).toBe(true);

    classifier.pointerup(0, 0, 1); // the real release
    expect(onTap).toHaveBeenCalledExactlyOnceWith({ x: 0, y: 0, pointerId: 1, target: null });
  });

  it('resets state on pointercancel', () => {
    const clock = fakeClock();
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    const classifier = createGestureClassifier({ onTap, onLongPress }, { now: clock.now });

    classifier.pointerdown(0, 0, 1);
    classifier.pointercancel(1);
    expect(classifier.isActive()).toBe(false);

    clock.advance(600);
    classifier.tick();
    classifier.pointerup(0, 0, 1);

    expect(onTap).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does not tap after a long-press already fired, even on slow release', () => {
    const clock = fakeClock();
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    const classifier = createGestureClassifier({ onTap, onLongPress }, { now: clock.now });

    classifier.pointerdown(0, 0, 1);
    clock.advance(500);
    classifier.tick();
    clock.advance(1500); // released way after the long-press window
    classifier.pointerup(0, 0, 1);

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('classifies a long hold as long-press at release when ticks were delayed', () => {
    const clock = fakeClock();
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    const classifier = createGestureClassifier({ onTap, onLongPress }, { now: clock.now });

    // no tick() ever runs (busy main thread); release at 700 ms
    classifier.pointerdown(5, 5, 1);
    clock.advance(700);
    classifier.pointerup(5, 5, 1);

    expect(onLongPress).toHaveBeenCalledExactlyOnceWith({ x: 5, y: 5, pointerId: 1, target: null });
    expect(onTap).not.toHaveBeenCalled();
  });
});
