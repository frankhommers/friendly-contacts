import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyncState, FileStore, migrateSyncStateDir } from "src/sync/syncState";

function memoryStore() {
  const files = new Map<string, string>();
  const store: FileStore = {
    read: async path => files.get(path),
    write: async (path, data) => { files.set(path, data); },
    remove: async path => { files.delete(path); },
    list: async dir => [...files.keys()].filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')),
    rename: async (from, to) => { files.set(to, files.get(from)!); files.delete(from); },
  };
  return { files, store };
}

/** Like memoryStore, but every operation yields to the event loop first, so unserialized writes interleave. */
function asyncMemoryStore() {
  const files = new Map<string, string>();
  const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  const store: FileStore = {
    read: async path => { await tick(); return files.get(path); },
    write: async (path, data) => { await tick(); files.set(path, data); },
    remove: async path => { await tick(); files.delete(path); },
    list: async () => [],
    rename: async () => {},
  };
  return { files, store };
}

const entry = { raw: 'BEGIN:VCARD\nEND:VCARD', etag: 'e1', href: '/frank/contacts/x.vcf' };
/** The clock while a base is stored; every stored entry records it. */
const NOW = 1_700_000_000_000;
const kept = { ...entry, storedAt: NOW };

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SyncState', () => {
  it('set then get returns entry', async () => {
    const { store } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('abc', entry);
    expect(await state.get('abc')).toEqual(kept);
    expect(await state.get('other')).toBeUndefined();
  });

  it('records when a base was stored, unless the caller says when', async () => {
    const { files, store } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('abc', entry);
    expect(JSON.parse(files.get('sync/index.json')!).abc).toEqual({ etag: 'e1', href: entry.href, storedAt: NOW });
    expect((await state.get('abc'))?.storedAt).toBe(NOW);
    await state.set('given', { ...entry, storedAt: 1000 });
    expect((await state.get('given'))?.storedAt).toBe(1000);
  });

  it('an entry stored before storedAt was recorded has none', async () => {
    const { files, store } = memoryStore();
    files.set('sync/old.vcf', entry.raw);
    files.set('sync/index.json', JSON.stringify({ old: { etag: 'e1', href: entry.href, reader: 2 } }));
    const old = await createSyncState(store, 'sync').get('old');
    expect(old).toEqual({ ...entry, reader: 2 });
    expect(old).not.toHaveProperty('storedAt');
  });

  it('keeps the reader a base was stored with; an old index entry has none', async () => {
    const { files, store } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('abc', { ...entry, reader: 2 });
    expect(await state.get('abc')).toEqual({ ...kept, reader: 2 });
    expect(JSON.parse(files.get('sync/index.json')!).abc).toEqual({ etag: 'e1', href: entry.href, reader: 2, storedAt: NOW });
    await state.set('old', entry);
    expect(await state.get('old')).toEqual(kept);
    expect(await state.get('old')).not.toHaveProperty('reader');
  });

  it('keeps that the server damaged the photo; touch keeps it too', async () => {
    const { files, store } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('abc', { ...entry, photoDamaged: true });
    expect(await state.get('abc')).toEqual({ ...kept, photoDamaged: true });
    expect(JSON.parse(files.get('sync/index.json')!).abc).toEqual({ etag: 'e1', href: entry.href, storedAt: NOW, photoDamaged: true });
    await state.touch('abc', NOW + 1);
    expect((await state.get('abc'))?.photoDamaged).toBe(true);
    await state.set('abc', entry);
    expect(await state.get('abc')).not.toHaveProperty('photoDamaged');
  });

  it('uid with urn:uuid prefix uses clean file name', async () => {
    const { store, files } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('urn:uuid:abc', entry);
    expect(files.get('sync/abc.vcf')).toBe(entry.raw);
    expect(JSON.parse(files.get('sync/index.json')!)).toEqual({ abc: { etag: 'e1', href: entry.href, storedAt: NOW } });
    expect(await state.get('abc')).toEqual(kept);
  });

  it('replaces unsafe characters in file names', async () => {
    const { store, files } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('a/b:c*d_e', entry);
    expect([...files.keys()]).toContain('sync/a_2f_b_3a_c_2a_d_5f_e.vcf');
    expect(await state.get('a/b:c*d_e')).toEqual(kept);
  });

  it('remove deletes both', async () => {
    const { store, files } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('abc', entry);
    await state.set('def', entry);
    await state.remove('abc');
    expect(files.has('sync/abc.vcf')).toBe(false);
    expect(JSON.parse(files.get('sync/index.json')!)).toEqual({ def: { etag: 'e1', href: entry.href, storedAt: NOW } });
    expect(await state.get('abc')).toBeUndefined();
  });

  it('get returns undefined when the raw file or index entry is missing', async () => {
    const { store, files } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('abc', entry);
    files.delete('sync/abc.vcf');
    expect(await state.get('abc')).toBeUndefined();
    await state.set('abc', entry);
    files.set('sync/index.json', '{}');
    expect(await state.get('abc')).toBeUndefined();
  });

  it('concurrent sets keep every entry', async () => {
    const { store, files } = asyncMemoryStore();
    const state = createSyncState(store, 'sync');
    const uids = ['a', 'b', 'c', 'd', 'e'];
    await Promise.all(uids.map(uid => state.set(uid, entry)));
    expect(Object.keys(JSON.parse(files.get('sync/index.json')!)).sort()).toEqual(uids);
    for (const uid of uids) expect(await state.get(uid)).toEqual(kept);
  });

  it('concurrent set and remove keep the other entries', async () => {
    const { store, files } = asyncMemoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('a', entry);
    await Promise.all([state.remove('a'), state.set('b', entry), state.set('c', entry)]);
    expect(Object.keys(JSON.parse(files.get('sync/index.json')!)).sort()).toEqual(['b', 'c']);
  });

  describe('touch', () => {
    it('updates storedAt only', async () => {
      const { files, store } = memoryStore();
      const state = createSyncState(store, 'sync');
      await state.set('abc', { ...entry, reader: 2, storedAt: 1000 });
      await state.touch('abc', 2000);
      expect(await state.get('abc')).toEqual({ ...entry, reader: 2, storedAt: 2000 });
      expect(files.get('sync/abc.vcf')).toBe(entry.raw);
      expect(JSON.parse(files.get('sync/index.json')!).abc).toEqual({ etag: 'e1', href: entry.href, reader: 2, storedAt: 2000 });
    });

    it('gives an entry that has no storedAt one, and keeps it having no reader', async () => {
      const { files, store } = memoryStore();
      files.set('sync/old.vcf', entry.raw);
      files.set('sync/index.json', JSON.stringify({ old: { etag: 'e1', href: entry.href } }));
      const state = createSyncState(store, 'sync');
      await state.touch('old', 2000);
      const touched = await state.get('old');
      expect(touched).toEqual({ ...entry, storedAt: 2000 });
      expect(touched).not.toHaveProperty('reader');
    });

    it('never makes a base older', async () => {
      const { store } = memoryStore();
      const state = createSyncState(store, 'sync');
      await state.set('abc', { ...entry, storedAt: 3000 });
      await state.touch('abc', 2000);
      expect((await state.get('abc'))?.storedAt).toBe(3000);
    });

    it('does nothing for a uid without a base', async () => {
      const { files, store } = memoryStore();
      const state = createSyncState(store, 'sync');
      await state.touch('nobody', 2000);
      expect(files.size).toBe(0);
      await state.set('abc', entry);
      const before = files.get('sync/index.json');
      await state.touch('nobody', 2000);
      expect(files.get('sync/index.json')).toBe(before);
      expect(await state.get('nobody')).toBeUndefined();
    });

    it('is serialized with set: no index entry is lost', async () => {
      const { store, files } = asyncMemoryStore();
      const state = createSyncState(store, 'sync');
      await state.set('a', { ...entry, storedAt: 1000 });
      await Promise.all([state.touch('a', 2000), state.set('b', entry), state.touch('a', 2500), state.set('c', entry)]);
      const index = JSON.parse(files.get('sync/index.json')!);
      expect(Object.keys(index).sort()).toEqual(['a', 'b', 'c']);
      expect(index.a.storedAt).toBe(2500);
    });
  });

  it('a failed write does not block later writes', async () => {
    const { store, files } = memoryStore();
    let fail = true;
    const flaky: FileStore = {
      ...store,
      write: async (path, data) => {
        if (fail) { fail = false; throw new Error('disk full'); }
        await store.write(path, data);
      },
    };
    const state = createSyncState(flaky, 'sync');
    await expect(state.set('a', entry)).rejects.toThrow('disk full');
    await state.set('b', entry);
    expect(Object.keys(JSON.parse(files.get('sync/index.json')!))).toEqual(['b']);
  });
});

describe('sync state per source', () => {
  it('sources do not share bases', async () => {
    const { store } = memoryStore();
    const a = createSyncState(store, 's/A');
    const b = createSyncState(store, 's/B');
    await a.set('abc', entry);
    await b.set('abc', { ...entry, raw: 'other', etag: 'e2' });
    expect((await a.get('abc'))?.raw).toBe(entry.raw);
    expect((await b.get('abc'))?.etag).toBe('e2');
    await a.remove('abc');
    expect(await a.get('abc')).toBeUndefined();
    expect(await b.get('abc')).toBeDefined();
  });

  it('moves old sync state once', async () => {
    const { store, files } = memoryStore();
    files.set('s/index.json', '{}');
    files.set('s/a.vcf', 'A');
    expect(await migrateSyncStateDir(store, 's', 'id1')).toBe(2);
    expect([...files.keys()].sort()).toEqual(['s/id1/a.vcf', 's/id1/index.json']);
    expect(files.get('s/id1/a.vcf')).toBe('A');
    const before = new Map(files);
    expect(await migrateSyncStateDir(store, 's', 'id1')).toBe(0);
    expect(files).toEqual(before);
  });

  it('migrated bases are readable through the source state', async () => {
    const { store } = memoryStore();
    await createSyncState(store, 's').set('abc', entry);
    await migrateSyncStateDir(store, 's', 'id1');
    expect(await createSyncState(store, 's/id1').get('abc')).toEqual(kept);
  });

  it('merge keeps the target\'s newer base', async () => {
    const { store, files } = memoryStore();
    const old = { ...entry, raw: 'OLD', etag: 'old' };
    const newer = { ...entry, raw: 'NEW', etag: 'new' };
    files.set('s/index.json', JSON.stringify({ abc: { etag: 'old', href: entry.href }, def: { etag: 'old', href: entry.href } }));
    files.set('s/abc.vcf', 'OLD');
    files.set('s/def.vcf', 'DEF');
    files.set('s/id1/index.json', JSON.stringify({ abc: { etag: 'new', href: entry.href } }));
    files.set('s/id1/abc.vcf', 'NEW');
    expect(await migrateSyncStateDir(store, 's', 'id1')).toBe(3);
    expect([...files.keys()].sort()).toEqual(['s/id1/abc.vcf', 's/id1/def.vcf', 's/id1/index.json']);
    const state = createSyncState(store, 's/id1');
    expect(await state.get('abc')).toEqual(newer);
    expect(await state.get('abc')).not.toEqual(old);
    expect((await state.get('def'))?.raw).toBe('DEF');
  });

  it('retries an interrupted move on the next load', async () => {
    const { store, files } = memoryStore();
    const index = { a: { etag: 'ea', href: '/a.vcf' }, b: { etag: 'eb', href: '/b.vcf' }, c: { etag: 'ec', href: '/c.vcf' } };
    // First run died after moving a.vcf (no index yet) and a sync wrote a fresh base for c in the target.
    files.set('s/index.json', JSON.stringify(index));
    files.set('s/b.vcf', 'B');
    files.set('s/c.vcf', 'C-old');
    files.set('s/id1/a.vcf', 'A');
    files.set('s/id1/c.vcf', 'C-new');
    files.set('s/id1/index.json', JSON.stringify({ c: { etag: 'ec2', href: '/c.vcf' } }));
    expect(await migrateSyncStateDir(store, 's', 'id1')).toBe(3);
    expect([...files.keys()].filter(path => !path.startsWith('s/id1/'))).toEqual([]);
    const state = createSyncState(store, 's/id1');
    expect(await state.get('a')).toEqual({ raw: 'A', etag: 'ea', href: '/a.vcf' });
    expect(await state.get('b')).toEqual({ raw: 'B', etag: 'eb', href: '/b.vcf' });
    expect(await state.get('c')).toEqual({ raw: 'C-new', etag: 'ec2', href: '/c.vcf' });
    expect(await migrateSyncStateDir(store, 's', 'id1')).toBe(0);
  });

  it('never overwrites a target card', async () => {
    const { store, files } = memoryStore();
    files.set('s/index.json', JSON.stringify({ a: { etag: 'ea', href: '/a.vcf' } }));
    files.set('s/a.vcf', 'A-old');
    files.set('s/id1/index.json', JSON.stringify({ a: { etag: 'new', href: '/a.vcf' } }));
    files.set('s/id1/a.vcf', 'A-new');
    const rename = vi.fn(store.rename);
    await migrateSyncStateDir({ ...store, rename }, 's', 'id1');
    expect(rename).not.toHaveBeenCalled();
    expect(files.get('s/id1/a.vcf')).toBe('A-new');
  });

  it('does nothing without old state', async () => {
    const { store, files } = memoryStore();
    expect(await migrateSyncStateDir(store, 's', 'id1')).toBe(0);
    expect(files.size).toBe(0);
  });

  it('finishes an interrupted move: index.json moves last', async () => {
    const { store, files } = memoryStore();
    files.set('s/index.json', '{}');
    files.set('s/a.vcf', 'A');
    files.set('s/b.vcf', 'B');
    let renames = 0;
    const flaky: FileStore = {
      ...store,
      rename: async (from, to) => {
        if (++renames === 2) throw new Error('crash');
        await store.rename(from, to);
      },
    };
    await expect(migrateSyncStateDir(flaky, 's', 'id1')).rejects.toThrow('crash');
    expect(files.has('s/index.json')).toBe(true);
    expect(await migrateSyncStateDir(store, 's', 'id1')).toBe(2);
    expect([...files.keys()].sort()).toEqual(['s/id1/a.vcf', 's/id1/b.vcf', 's/id1/index.json']);
  });
});
