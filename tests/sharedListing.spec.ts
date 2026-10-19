import { sharedListing } from 'src/util/sharedListing';
import { describe, expect, it, vi } from 'vitest';

type Listing = { contacts: string[]; failed: string[] };

describe('sharedListing', () => {
  function setup(results: (Listing | Error)[]) {
    let clock = 0;
    const fetch = vi.fn(async (): Promise<Listing> => {
      const next = results.shift();
      if (next === undefined) throw new Error('no more results');
      if (next instanceof Error) throw next;
      return next;
    });
    const onError = vi.fn();
    const list = sharedListing(fetch, 60_000, onError, () => clock);
    return { list, fetch, onError, tick: (ms: number) => (clock += ms) };
  }

  it('callers asking at the same time share one call', async () => {
    const { list, fetch } = setup([{ contacts: ['a'], failed: [] }]);
    expect(await Promise.all([list(), list(), list()])).toEqual([['a'], ['a'], ['a']]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a full listing is asked for again next time (the server listing caches it)', async () => {
    const { list, fetch } = setup([
      { contacts: ['a'], failed: [] },
      { contacts: ['b'], failed: [] },
    ]);
    await list();
    expect(await list()).toEqual(['b']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a failed listing is kept for a minute, then asked for again', async () => {
    const { list, fetch, tick } = setup([
      { contacts: ['a'], failed: ['work'] },
      { contacts: ['a', 'b'], failed: [] },
    ]);
    expect(await list()).toEqual(['a']);
    tick(59_999);
    expect(await list()).toEqual(['a']);
    expect(fetch).toHaveBeenCalledTimes(1);
    tick(1);
    expect(await list()).toEqual(['a', 'b']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('an error is reported once and kept for a minute as an empty listing', async () => {
    const { list, fetch, onError, tick } = setup([new Error('offline'), { contacts: ['a'], failed: [] }]);
    expect(await list()).toEqual([]);
    expect(await list()).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    tick(60_000);
    expect(await list()).toEqual(['a']);
  });
});
