import { describe, expect, it } from "vitest";
import { createSyncState, FileStore } from "src/sync/syncState";

function memoryStore() {
  const files = new Map<string, string>();
  const store: FileStore = {
    read: async path => files.get(path),
    write: async (path, data) => { files.set(path, data); },
    remove: async path => { files.delete(path); },
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
  };
  return { files, store };
}

const entry = { raw: 'BEGIN:VCARD\nEND:VCARD', etag: 'e1', href: '/frank/contacts/x.vcf' };

describe('SyncState', () => {
  it('set then get returns entry', async () => {
    const { store } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('abc', entry);
    expect(await state.get('abc')).toEqual(entry);
    expect(await state.get('other')).toBeUndefined();
  });

  it('uid with urn:uuid prefix uses clean file name', async () => {
    const { store, files } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('urn:uuid:abc', entry);
    expect(files.get('sync/abc.vcf')).toBe(entry.raw);
    expect(JSON.parse(files.get('sync/index.json')!)).toEqual({ abc: { etag: 'e1', href: entry.href } });
    expect(await state.get('abc')).toEqual(entry);
  });

  it('replaces unsafe characters in file names', async () => {
    const { store, files } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('a/b:c*d', entry);
    expect([...files.keys()]).toContain('sync/c_d.vcf');
  });

  it('remove deletes both', async () => {
    const { store, files } = memoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('abc', entry);
    await state.set('def', entry);
    await state.remove('abc');
    expect(files.has('sync/abc.vcf')).toBe(false);
    expect(JSON.parse(files.get('sync/index.json')!)).toEqual({ def: { etag: 'e1', href: entry.href } });
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
    for (const uid of uids) expect(await state.get(uid)).toEqual(entry);
  });

  it('concurrent set and remove keep the other entries', async () => {
    const { store, files } = asyncMemoryStore();
    const state = createSyncState(store, 'sync');
    await state.set('a', entry);
    await Promise.all([state.remove('a'), state.set('b', entry), state.set('c', entry)]);
    expect(Object.keys(JSON.parse(files.get('sync/index.json')!)).sort()).toEqual(['b', 'c']);
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
