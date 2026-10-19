import { versionStore } from 'src/util/versionStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('versionStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A store whose source events are fired by hand; counts how often it was started and stopped. */
  function setup(delayMs = 100) {
    let fire: (() => void) | undefined;
    const counts = { started: 0, stopped: 0 };
    const store = versionStore((bump) => {
      counts.started++;
      fire = bump;
      return () => {
        counts.stopped++;
        fire = undefined;
      };
    }, delayMs);
    return { store, counts, fire: () => fire?.() };
  }

  it('listens to its source once, however many subscribe, and stops when the last one leaves', () => {
    const { store, counts } = setup();
    const offA = store.subscribe(() => {});
    const offB = store.subscribe(() => {});
    expect(counts).toEqual({ started: 1, stopped: 0 });
    offA();
    expect(counts.stopped).toBe(0);
    offB();
    expect(counts).toEqual({ started: 1, stopped: 1 });
    store.subscribe(() => {});
    expect(counts.started).toBe(2);
  });

  it('a burst of changes is one new version and one notification per subscriber', () => {
    const { store, fire } = setup();
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);
    const before = store.getSnapshot();
    for (let i = 0; i < 50; i++) fire();
    expect(store.getSnapshot()).toBe(before);
    vi.advanceTimersByTime(100);
    expect(store.getSnapshot()).toBe(before + 1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    fire();
    vi.advanceTimersByTime(100);
    expect(store.getSnapshot()).toBe(before + 2);
  });

  it('an unsubscribed listener is not called, and stopping drops a pending change', () => {
    const { store, fire } = setup();
    const a = vi.fn();
    const off = store.subscribe(a);
    fire();
    off();
    vi.advanceTimersByTime(100);
    expect(a).not.toHaveBeenCalled();
  });

  it('without a delay a change is seen at once', () => {
    const { store, fire } = setup(0);
    const a = vi.fn();
    store.subscribe(a);
    fire();
    expect(a).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(1);
  });
});
