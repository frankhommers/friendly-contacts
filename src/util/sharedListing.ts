/**
 * One listing shared by many callers (the sidebar shows many contacts): callers asking at the same time share one
 * call, and a listing that failed is kept for a while so that every contact shown does not ask again.
 * Free of Obsidian; the fetch is passed in.
 */

/**
 * `fetch` lists the contacts, with the sources that could not be read in `failed`. A full listing is not kept here
 * (the fetch caches it itself); one with failures, or an error (as an empty listing, reported once to `onError`),
 * is kept for `failureTtlMs`.
 */
export function sharedListing<T>(
  fetch: () => Promise<{ contacts: T[]; failed: string[] }>,
  failureTtlMs: number,
  onError: (error: unknown) => void,
  now: () => number = Date.now,
): () => Promise<T[]> {
  let inFlight: Promise<T[]> | undefined;
  let kept: { at: number; contacts: T[] } | undefined;

  const load = async (): Promise<T[]> => {
    try {
      const { contacts, failed } = await fetch();
      kept = failed.length > 0 ? { at: now(), contacts } : undefined;
      return contacts;
    } catch (error) {
      onError(error);
      kept = { at: now(), contacts: [] };
      return [];
    } finally {
      inFlight = undefined;
    }
  };

  return () => {
    if (kept !== undefined && now() - kept.at < failureTtlMs) return Promise.resolve(kept.contacts);
    inFlight ??= load();
    return inFlight;
  };
}
