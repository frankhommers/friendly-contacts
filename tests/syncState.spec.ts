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
});
