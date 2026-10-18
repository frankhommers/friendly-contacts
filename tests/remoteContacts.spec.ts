import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "src/settings/settings";

const state = vi.hoisted(() => ({
  active: [] as unknown[],
  lists: {} as Record<string, unknown>,
  calls: [] as string[],
  notices: [] as string[],
}));

vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    Notice: class {
      constructor(message: string) {
        state.notices.push(message);
      }
    },
  };
});

vi.mock("src/sync/adapters", () => ({
  activeSources: () => state.active,
  defaultActiveSource: () => state.active[0],
  adapterFor: (source: Source) => ({
    getMetaList: async () => {
      state.calls.push(source.id);
      const result = state.lists[source.id];
      if (result instanceof Error) throw result;
      return result;
    },
  }),
}));

import { clearRemoteContactsCache, ObsidianRelationContext, remoteContacts } from "src/contacts/obsidianNotes";
import { orgOutOfString } from "src/util/vcard";

const source = (id: string, name = id): Source => ({
  id, name, addressBookUrl: `http://x/${id}/`, authType: "apikey", authKey: "secret-key", enabled: true,
});

const meta = (uid: string, fn: string, extra: Record<string, unknown> = {}) => ({
  uid, fn, n: undefined, href: `/${uid}.vcf`, etag: `e-${uid}`, lastModified: new Date(), ...extra,
});

beforeEach(() => {
  state.active = [];
  state.lists = {};
  state.calls = [];
  state.notices = [];
  clearRemoteContactsCache();
});

describe('orgOutOfString', () => {
  it('is the first ORG component, unescaped', () => {
    expect(orgOutOfString('BEGIN:VCARD\r\nORG:Acme\\; Inc;Sales\r\nEND:VCARD')).toBe('Acme; Inc');
    expect(orgOutOfString('ORG;TYPE=work:Acme')).toBe('Acme');
    expect(orgOutOfString('FN:Anna')).toBeUndefined();
  });
});

describe('remoteContacts', () => {
  it('lists the contacts of every active source with their source, href, etag and org', async () => {
    state.active = [source('a'), source('b')];
    state.lists = {
      a: [meta('1', 'Anna', { org: 'Acme' })],
      b: [meta('2', 'Piet')],
    };
    expect(await remoteContacts()).toEqual([
      { uid: '1', fileName: 'Anna', sourceId: 'a', href: '/1.vcf', etag: 'e-1', org: 'Acme' },
      { uid: '2', fileName: 'Piet', sourceId: 'b', href: '/2.vcf', etag: 'e-2', org: undefined },
    ]);
  });

  it('skips a failing source with one Notice that names the source, not its credentials', async () => {
    state.active = [source('a', 'Work'), source('b')];
    state.lists = { a: new Error('boom http://x/a/ secret-key'), b: [meta('2', 'Piet')] };
    const list = await remoteContacts();
    expect(list.map((r) => r.uid)).toEqual(['2']);
    expect(state.notices).toHaveLength(1);
    expect(state.notices[0]).toContain('Could not read Work');
    expect(state.notices[0]).not.toContain('secret-key');
    expect(state.notices[0]).not.toContain('http://x/a/');
  });

  it('caches per set of active sources', async () => {
    state.active = [source('a')];
    state.lists = { a: [meta('1', 'Anna')], b: [meta('2', 'Piet')] };
    await remoteContacts();
    await remoteContacts();
    expect(state.calls).toEqual(['a']);
    state.active = [source('a'), source('b')];
    expect((await remoteContacts()).map((r) => r.uid)).toEqual(['1', '2']);
  });
});

describe('ObsidianRelationContext', () => {
  const entry = (uid: string, fileName: string, sourceId: string) => ({ uid, fileName, sourceId, href: '', etag: '' });
  const context = (remote: ReturnType<typeof entry>[]) =>
    new ObsidianRelationContext({} as never, 'Contacts/X.md', [], remote);

  it('uidToName ignores a uid with two names', () => {
    const ctx = context([entry('1', 'Anna', 'a'), entry('1', 'Anna Jansen', 'b'), entry('2', 'Piet', 'a')]);
    expect(ctx.uidToName('1')).toBeUndefined();
    expect(ctx.uidToName('2')).toBe('Piet');
  });

  it('uidToName accepts the same name in two sources', () => {
    const ctx = context([entry('1', 'Anna', 'a'), entry('1', 'Anna', 'b')]);
    expect(ctx.uidToName('1')).toBe('Anna');
  });
});
