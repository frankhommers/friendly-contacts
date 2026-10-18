import { PushOptions, VCardMeta, VCardRaw } from 'src/sync/adapters/adapter';
import { AdapterInterface } from 'src/sync/adapters/adapterInterface';
import { moveCard } from 'src/sync/moveCard';
import { SyncState, SyncStateEntry } from 'src/sync/syncState';
import { AppHttpResponse } from 'src/util/platformHttpClient';
import { cleanUid } from 'src/util/vcard';
import { describe, expect, it } from 'vitest';

const UID = 'urn:uuid:1234ABCD-0000-4000-8000-000000000001';
const ID = cleanUid(UID);
const RAW = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Jan de Vries', `UID:${ID}`, 'END:VCARD', ''].join('\r\n');

const response = (status: number, headers: Record<string, string> = {}, errorMessage = ''): AppHttpResponse => ({
  status,
  data: '',
  headers,
  errorMessage,
});

type Call = string;

/** One address book: records every call in the shared `calls` list, prefixed with its name. */
function fakeBook(name: string, calls: Call[], book = '/' + name + '/') {
  const cards = new Map<string, { raw: string; etag: string }>();
  let counter = 0;
  const options = { deleteStatus: 204, putStatus: undefined as number | undefined };
  const adapter: AdapterInterface = {
    async push(vcard: VCardRaw, opts?: PushOptions) {
      calls.push(`${name} PUT${opts?.ifNoneMatch ? ' If-None-Match' : ''}${opts?.ifMatch ? ` If-Match ${opts.ifMatch}` : ''}`);
      const href = opts?.href ?? `${book}${vcard.uid}.vcf`;
      if (options.putStatus !== undefined) return response(options.putStatus, {}, options.putStatus >= 300 ? `HTTP ${options.putStatus}` : '');
      if (opts?.ifNoneMatch && [...cards.values()].some((c) => c.raw.includes(`UID:${vcard.uid}`))) return response(412);
      const etag = `${name}-e${++counter}`;
      cards.set(href, { raw: vcard.raw, etag });
      return response(201, { etag: `"${etag}"` });
    },
    async delete(href: string, ifMatch?: string) {
      calls.push(`${name} DELETE ${href} If-Match ${ifMatch ?? '-'}`);
      if (options.deleteStatus >= 300) return response(options.deleteStatus, {}, `HTTP ${options.deleteStatus}`);
      cards.delete(href);
      return response(options.deleteStatus);
    },
    async pull() {
      return undefined;
    },
    async getMetaList() {
      return [];
    },
    async getMetaByUid(uid: string): Promise<VCardMeta | undefined> {
      calls.push(`${name} lookup`);
      const found = [...cards.entries()].find(([, c]) => c.raw.includes(`UID:${cleanUid(uid)}`));
      return found && { href: found[0], etag: found[1].etag, lastModified: new Date(), uid: cleanUid(uid), fn: undefined, n: undefined };
    },
    async checkConnectivity() {
      return response(200);
    },
  };
  return { adapter, cards, options };
}

function memoryState(name: string, calls: Call[], initial: Record<string, SyncStateEntry> = {}) {
  const entries = new Map(Object.entries(initial).map(([k, v]) => [cleanUid(k), v]));
  const state: SyncState = {
    get: async (uid) => entries.get(cleanUid(uid)),
    set: async (uid, entry) => {
      calls.push(`${name} base set`);
      entries.set(cleanUid(uid), entry);
    },
    remove: async (uid) => {
      calls.push(`${name} base remove`);
      entries.delete(cleanUid(uid));
    },
  };
  return { state, entries };
}

function setup() {
  const calls: Call[] = [];
  const private_ = fakeBook('private', calls);
  const family = fakeBook('family', calls);
  const href = `/private/${ID}.vcf`;
  private_.cards.set(href, { raw: RAW, etag: 'p1' });
  const fromState = memoryState('private', calls, { [UID]: { raw: RAW, etag: 'p1', href } });
  const toState = memoryState('family', calls);
  const from = { adapter: private_.adapter, state: fromState.state, location: { sourceId: 'private', href, etag: 'p1' } };
  const to = { adapter: family.adapter, state: toState.state };
  return { calls, private_, family, fromState, toState, from, to, href };
}

describe('moveCard', () => {
  it('moves: create then delete then base', async () => {
    const t = setup();

    expect(await moveCard(RAW, UID, t.from, t.to)).toEqual({ ok: true, oldKept: false });

    expect(t.calls).toEqual([
      'family PUT If-None-Match',
      'private DELETE /private/' + ID + '.vcf If-Match p1',
      'family lookup',
      'family base set',
      'private base remove',
    ]);
    expect([...t.family.cards.values()].map((c) => c.raw)).toEqual([RAW]);
    expect(t.private_.cards.size).toBe(0);
    expect(t.toState.entries.get(ID)).toEqual({ raw: RAW, etag: 'family-e1', href: `/family/${ID}.vcf` });
    expect(t.fromState.entries.has(ID)).toBe(false);
  });

  it('target already has the card refuses before deleting', async () => {
    const t = setup();
    t.family.cards.set('/family/other.vcf', { raw: RAW, etag: 'f9' });

    expect(await moveCard(RAW, UID, t.from, t.to)).toEqual({
      ok: false,
      message: 'The address book already has a card with this UID',
    });

    expect(t.calls).toEqual(['family PUT If-None-Match']);
    expect(t.private_.cards.get(t.href)?.raw).toBe(RAW);
    expect(t.fromState.entries.has(ID)).toBe(true);
    expect(t.toState.entries.size).toBe(0);
  });

  it('a UID conflict (409) refuses like 412', async () => {
    const t = setup();
    t.family.options.putStatus = 409;

    expect(await moveCard(RAW, UID, t.from, t.to)).toEqual({
      ok: false,
      message: 'The address book already has a card with this UID',
    });
    expect(t.calls).toEqual(['family PUT If-None-Match']);
  });

  it('a failed create writes nothing else', async () => {
    const t = setup();
    t.family.options.putStatus = 500;

    const result = await moveCard(RAW, UID, t.from, t.to);

    expect(result.ok).toBe(false);
    expect(t.calls).toEqual(['family PUT If-None-Match']);
    expect(t.fromState.entries.has(ID)).toBe(true);
  });

  it('no ETag for the old card refuses before anything is written', async () => {
    const t = setup();

    const result = await moveCard(RAW, UID, { ...t.from, location: { ...t.from.location, etag: '' } }, t.to);

    expect(result.ok).toBe(false);
    expect(t.calls).toEqual([]);
  });

  it('move with failed delete keeps both', async () => {
    const t = setup();
    t.private_.options.deleteStatus = 412;

    expect(await moveCard(RAW, UID, t.from, t.to)).toEqual({ ok: true, oldKept: true });

    expect(t.calls).toEqual([
      'family PUT If-None-Match',
      'private DELETE /private/' + ID + '.vcf If-Match p1',
      'family lookup',
      'family base set',
      'private base remove',
    ]);
    // Never retried: exactly one DELETE.
    expect(t.calls.filter((c) => c.includes('DELETE'))).toHaveLength(1);
    expect(t.private_.cards.get(t.href)?.raw).toBe(RAW);
    expect(t.family.cards.size).toBe(1);
    expect(t.toState.entries.get(ID)?.href).toBe(`/family/${ID}.vcf`);
    expect(t.fromState.entries.has(ID)).toBe(false);
  });

  it('a delete that throws keeps both', async () => {
    const t = setup();
    t.private_.adapter.delete = async () => {
      throw new Error('offline');
    };

    expect(await moveCard(RAW, UID, t.from, t.to)).toEqual({ ok: true, oldKept: true });
    expect(t.toState.entries.has(ID)).toBe(true);
    expect(t.fromState.entries.has(ID)).toBe(false);
  });
});
