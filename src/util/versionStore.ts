/**
 * A version number that goes up when something changes, for React's `useSyncExternalStore`: one subscription to
 * the source however many components read it. Free of Obsidian; the source is passed in.
 */

export interface VersionStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): number;
}

/**
 * `start` subscribes to the source when the first listener comes and returns how to stop when the last one leaves;
 * it gets `bump` to call on every change. Changes within `delayMs` of the first one become one new version.
 */
export function versionStore(start: (bump: () => void) => () => void, delayMs = 0): VersionStore {
  const listeners = new Set<() => void>();
  let version = 0;
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const publish = () => {
    timer = undefined;
    version++;
    for (const listener of [...listeners]) listener();
  };
  const bump = () => {
    if (delayMs <= 0) publish();
    else timer ??= setTimeout(publish, delayMs);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      stop ??= start(bump);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || stop === undefined) return;
        stop();
        stop = undefined;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      };
    },
    getSnapshot: () => version,
  };
}
