import { parseCard, serializeCard, serializeLine } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { RelationContext } from 'src/contacts/friendly/relations';
import { FriendlyValue, toFriendly } from 'src/contacts/friendly/translate';
import { PushOptions, VCardMeta, VCardRaw } from 'src/sync/adapters/adapter';
import { AdapterInterface } from 'src/sync/adapters/adapterInterface';
import { NoteIO, SyncDeps, syncContact } from 'src/sync/syncContact';
import { SyncState, SyncStateEntry } from 'src/sync/syncState';
import { AppHttpResponse } from 'src/util/platformHttpClient';
import { cleanUid } from 'src/util/vcard';
import { readVcfFixture } from 'tests/fixtures/fixtures';
import { describe, expect, it } from 'vitest';

const ctx: RelationContext = {
  uidToName: () => undefined,
  resolveLink: (name) => ({ text: name }),
};

const UID = '1234ABCD-0000-4000-8000-000000000001';
const HREF = `/frank/contacts/${UID}.vcf`;
const V1 = readVcfFixture('appleV3.vcf');
const FAX = 'TEL;type=WORK;type=FAX:030-7654321';
const edit = (raw: string, from: string, to: string) => {
  expect(raw).toContain(from);
  return raw.replace(from, to);
};
const friendlyOf = (raw: string) => toFriendly(parseCard(raw), DEFAULT_MAPPING, ctx).props;
const lineTexts = (raw: string) => parseCard(raw).map(serializeLine);

type Push = { vcard: VCardRaw; opts?: PushOptions; status: number };

/** In-memory CardDAV server: cards keyed by href, etags e1, e2, ... */
function fakeAdapter() {
  const cards = new Map<string, { raw: string; etag: string }>();
  const pushes: Push[] = [];
  let counter = 0;
  const nextEtag = () => `e${++counter}`;
  const ok = (status: number, headers: Record<string, string> = {}): AppHttpResponse => ({ status, data: '', headers, errorMessage: '' });
  const options = {
    /** Called before each PUT is applied; may change the server card (another client) or return a response. */
    beforePut: undefined as undefined | ((attempt: number) => AppHttpResponse | void),
    etagOnPut: true,
    metaError: undefined as AppHttpResponse | undefined,
    pullError: undefined as AppHttpResponse | undefined,
    metaAfterCreate: true,
    /** Replaces what GET returns (e.g. a broken or foreign card). */
    pullResult: undefined as VCardRaw | undefined,
    /** Thrown from getMetaByUid (e.g. a parser crash). */
    metaThrows: undefined as Error | undefined,
  };

  const uidOf = (raw: string) => parseCard(raw).find((l) => l.name === 'UID')?.value;
  const put = (href: string, raw: string) => {
    const etag = nextEtag();
    cards.set(href, { raw, etag });
    return etag;
  };

  const adapter: AdapterInterface = {
    async getMetaByUid(uid: string): Promise<VCardMeta | AppHttpResponse | undefined> {
      if (options.metaThrows) throw options.metaThrows;
      if (options.metaError) return options.metaError;
      const found = [...cards.entries()].filter(([, c]) => (uidOf(c.raw) ?? '').includes(uid));
      if (found.length !== 1) return undefined;
      if (!options.metaAfterCreate && pushes.some((p) => p.opts?.ifNoneMatch)) return undefined;
      const [href, card] = found[0];
      return { href, etag: card.etag, lastModified: new Date(), uid: uidOf(card.raw), fn: undefined, n: undefined };
    },
    async pull(href: string): Promise<VCardRaw | AppHttpResponse | undefined> {
      if (options.pullError) return options.pullError;
      if (options.pullResult) return options.pullResult;
      const card = cards.get(href);
      if (!card) return { status: 404, data: '', headers: {}, errorMessage: '404 Not Found' };
      return { uid: uidOf(card.raw), raw: card.raw, etag: card.etag, href };
    },
    async push(vcard: VCardRaw, opts?: PushOptions): Promise<AppHttpResponse> {
      const href = opts?.href ?? `/frank/contacts/${vcard.uid}.vcf`;
      const record: Push = { vcard, opts, status: 0 };
      pushes.push(record);
      const forced = options.beforePut?.(pushes.length);
      if (forced) {
        record.status = forced.status;
        return forced;
      }
      const current = cards.get(href);
      if ((opts?.ifMatch !== undefined && current?.etag !== opts.ifMatch) || (opts?.ifNoneMatch && current)) {
        record.status = 412;
        return ok(412);
      }
      const etag = put(href, vcard.raw);
      record.status = current ? 204 : 201;
      return ok(record.status, options.etagOnPut ? { etag: `"${etag}"` } : {});
    },
    delete: async () => ok(204),
    getMetaList: async () => [],
    checkConnectivity: async () => ok(200),
  };
  return { adapter, cards, pushes, options, put };
}

function memoryState(initial: Record<string, SyncStateEntry> = {}) {
  const entries = new Map(Object.entries(initial).map(([k, v]) => [cleanUid(k), v]));
  const state: SyncState = {
    get: async (uid) => entries.get(cleanUid(uid)),
    set: async (uid, entry) => {
      entries.set(cleanUid(uid), entry);
    },
    remove: async (uid) => {
      entries.delete(cleanUid(uid));
    },
  };
  return { state, entries };
}

function memoryNote(frontmatter: Record<string, unknown>, body = 'Private notes about Jan. SECRET-BODY-TEXT') {
  const note = {
    frontmatter: { ...frontmatter },
    body,
    writes: [] as { set: Record<string, FriendlyValue>; remove: string[] }[],
    appended: [] as string[],
  };
  const io: NoteIO = {
    readFrontmatter: async () => ({ ...note.frontmatter }),
    writeProps: async (set, remove) => {
      note.writes.push({ set, remove });
      for (const key of remove) delete note.frontmatter[key];
      Object.assign(note.frontmatter, set);
    },
    appendToBody: async (markdown) => {
      note.appended.push(markdown);
      note.body += `\n\n${markdown}`;
    },
  };
  return { note, io };
}

function setup(opts: { server?: string; href?: string; base?: string; local?: Record<string, unknown> } = {}) {
  const fake = fakeAdapter();
  const serverEtag = opts.server !== undefined ? fake.put(opts.href ?? HREF, opts.server) : undefined;
  const { state, entries } = memoryState(
    opts.base !== undefined ? { [UID]: { raw: opts.base, etag: 'old', href: opts.href ?? HREF } } : {},
  );
  const { note, io } = memoryNote(opts.local ?? friendlyOf(V1));
  const notices: string[] = [];
  const deps: SyncDeps = {
    adapter: fake.adapter,
    state,
    rows: DEFAULT_MAPPING,
    ctx,
    notify: (msg) => notices.push(msg),
    now: () => new Date(2026, 9, 17, 9, 30),
  };
  return { ...fake, entries, note, io, notices, deps, serverEtag, run: () => syncContact(io, deps) };
}

describe('syncContact', () => {
  it('unchanged on both sides writes nothing and stores the base', async () => {
    const t = setup({ server: V1, base: V1 });
    expect(await t.run()).toBe('unchanged');
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);
    expect(t.note.appended).toEqual([]);
    expect(t.notices).toEqual([]);
    expect(t.entries.get(UID)).toEqual({ raw: V1, etag: t.serverEtag, href: HREF });
  });

  it('server-only change is pulled', async () => {
    const v2 = edit(V1, 'item1.TEL;type=CELL;type=VOICE;type=pref:06-12345678', 'item1.TEL;type=CELL;type=VOICE;type=pref:06-99999999');
    const t = setup({ server: v2, base: V1 });
    expect(await t.run()).toBe('pulled');
    expect(t.note.frontmatter.mobile).toBe('06-99999999');
    expect(t.note.writes).toEqual([{ set: { mobile: '06-99999999' }, remove: [] }]);
    expect(t.pushes).toEqual([]);
    expect(t.entries.get(UID)).toEqual({ raw: v2, etag: t.serverEtag, href: HREF });
  });

  it('server-side removal removes the note property', async () => {
    const v2 = edit(V1, 'TITLE:Baker\r\n', '');
    const t = setup({ server: v2, base: V1 });
    expect(await t.run()).toBe('pulled');
    expect(t.note.writes).toEqual([{ set: {}, remove: ['title'] }]);
    expect(t.note.frontmatter.title).toBeUndefined();
    expect(t.pushes).toEqual([]);
  });

  it('local-only change is pushed with If-Match', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl' } });
    expect(await t.run()).toBe('pushed');
    expect(t.pushes).toHaveLength(1);
    const [put] = t.pushes;
    expect(put.opts).toEqual({ href: HREF, ifMatch: t.serverEtag });
    const pushed = lineTexts(put.vcard.raw);
    expect(pushed).toContain('X-CREATED:2019-04-02T10:11:12Z');
    expect(pushed).toContain('item1.X-ABLabel:_$!<Mobile>!$_');
    expect(pushed).toContain(FAX);
    const changed = pushed.filter((l) => !lineTexts(V1).includes(l));
    expect(changed.map((l) => l.split(/[;:]/)[0]).sort()).toEqual(['EMAIL', 'REV']);
    expect(changed.find((l) => l.startsWith('EMAIL'))).toMatch(/:jan@new\.nl$/);
    expect(friendlyOf(put.vcard.raw).email).toBe('jan@new.nl');
    expect(t.note.writes).toEqual([]);
    const stored = t.cards.get(HREF)!;
    expect(stored.raw).toBe(put.vcard.raw);
    expect(t.entries.get(UID)).toEqual({ raw: put.vcard.raw, etag: stored.etag, href: HREF });
  });

  it('local and server changes on different properties give both', async () => {
    const v2 = edit(V1, 'TITLE:Baker', 'TITLE:Master baker');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl' } });
    expect(await t.run()).toBe('both');
    expect(t.note.writes).toEqual([{ set: { title: 'Master baker' }, remove: [] }]);
    const server = friendlyOf(t.cards.get(HREF)!.raw);
    expect(server.title).toBe('Master baker');
    expect(server.email).toBe('jan@new.nl');
  });

  it('puts to the existing href, not uid.vcf', async () => {
    const href = '/frank/contacts/ABC-DEF.vcf';
    const t = setup({ server: V1, base: V1, href, local: { ...friendlyOf(V1), title: 'Chef' } });
    expect(await t.run()).toBe('pushed');
    expect(t.pushes).toHaveLength(1);
    expect(t.pushes[0].opts?.href).toBe(href);
    expect(t.cards.has(HREF)).toBe(false);
    expect(t.entries.get(UID)?.href).toBe(href);
  });

  it('conflict keeps server and appends callout', async () => {
    const v2 = edit(V1, 'type=pref:06-12345678', 'type=pref:06-11111111');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), mobile: '06-22222222' } });
    expect(['both', 'pulled']).toContain(await t.run());
    expect(t.note.frontmatter.mobile).toBe('06-11111111');
    expect(t.note.appended).toHaveLength(1);
    expect(t.note.appended[0]).toContain('mobile');
    expect(t.note.appended[0]).toContain('06-22222222');
    expect(t.note.appended[0]).toContain('2026-10-17 09:30');
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]).toContain('mobile');
    expect(friendlyOf(t.cards.get(HREF)!.raw).mobile).toBe('06-11111111');
  });

  it('412 retries once from a fresh server card', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl' } });
    let otherEtag = '';
    t.options.beforePut = (attempt) => {
      // Another client edits the card between our GET and PUT; our If-Match then fails.
      if (attempt === 1) otherEtag = t.put(HREF, edit(V1, 'TITLE:Baker', 'TITLE:Master baker'));
    };
    expect(await t.run()).toBe('both');
    expect(t.pushes.map((p) => p.status)).toEqual([412, 204]);
    expect(t.pushes[0].opts?.ifMatch).toBe(t.serverEtag);
    expect(t.pushes[1].opts?.ifMatch).toBe(otherEtag);
    const server = friendlyOf(t.cards.get(HREF)!.raw);
    expect(server.title).toBe('Master baker');
    expect(server.email).toBe('jan@new.nl');
    expect(t.note.writes).toEqual([{ set: { title: 'Master baker' }, remove: [] }]);
    expect(t.entries.get(UID)).toEqual({ raw: t.cards.get(HREF)!.raw, etag: t.cards.get(HREF)!.etag, href: HREF });
  });

  it('two 412s fail without writing anything', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl' } });
    t.options.beforePut = () => ({ status: 412, data: '', headers: {}, errorMessage: '' });
    expect(await t.run()).toBe('failed');
    expect(t.pushes).toHaveLength(2);
    expect(t.notices).toHaveLength(1);
    expect(t.note.writes).toEqual([]);
    expect(t.note.appended).toEqual([]);
    expect(t.entries.get(UID)).toEqual({ raw: V1, etag: 'old', href: HREF });
    expect(t.cards.get(HREF)!.raw).toBe(V1);
  });

  it('no base merges server-first', async () => {
    const local = { name: 'Jan de Vries', uid: UID, mobile: '06-12345678', role: 'Owner' };
    const t = setup({ server: V1, local });
    expect(await t.run()).toBe('both');
    const pushed = lineTexts(t.pushes[0].vcard.raw);
    for (const line of lineTexts(V1)) if (!line.startsWith('REV:')) expect(pushed).toContain(line);
    expect(pushed).toContain('ROLE:Owner');
    expect(t.note.frontmatter.email).toBe('jan@example.nl');
    expect(t.note.frontmatter.role).toBe('Owner');
    expect(t.note.writes[0].remove).toEqual([]);
  });

  it('no base with a differing value keeps the server value as a conflict', async () => {
    const t = setup({ server: V1, local: { ...friendlyOf(V1), title: 'Chef' } });
    expect(await t.run()).toBe('pulled');
    expect(t.note.frontmatter.title).toBe('Baker');
    expect(t.note.appended).toHaveLength(1);
    expect(t.pushes).toEqual([]);
  });

  it('new contact is created', async () => {
    const t = setup({ local: { name: 'Sem Jansen', uid: 'urn:uuid:sem-0001', mobile: '06-55555555' } });
    expect(await t.run()).toBe('created');
    expect(t.pushes).toHaveLength(1);
    const [put] = t.pushes;
    expect(put.opts).toEqual({ ifNoneMatch: true });
    expect(put.vcard.uid).toBe('sem-0001');
    const href = '/frank/contacts/sem-0001.vcf';
    const card = t.cards.get(href)!;
    expect(friendlyOf(card.raw)).toMatchObject({ name: 'Sem Jansen', uid: 'urn:uuid:sem-0001', mobile: '06-55555555' });
    expect(t.entries.get('sem-0001')).toEqual({ raw: put.vcard.raw, etag: card.etag, href });
    expect(t.note.writes).toEqual([]);
  });

  it('new contact without uid gets one written to the note first', async () => {
    const t = setup({ local: { name: 'Sem Jansen' } });
    expect(await t.run()).toBe('created');
    expect(t.note.writes).toHaveLength(1);
    const uid = t.note.writes[0].set.uid as string;
    expect(uid).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(t.note.writes[0]).toEqual({ set: { uid }, remove: [] });
    expect(friendlyOf(t.pushes[0].vcard.raw).uid).toBe(uid);
    expect(t.entries.get(cleanUid(uid))?.href).toBe(`/frank/contacts/${cleanUid(uid)}.vcf`);
  });

  it('created card falls back to <uid>.vcf when the lookup after create fails', async () => {
    const t = setup({ local: { name: 'Sem Jansen', uid: 'sem-0001' } });
    t.options.metaAfterCreate = false;
    expect(await t.run()).toBe('created');
    expect(t.entries.get('sem-0001')?.href).toBe('sem-0001.vcf');
  });

  it('local-only properties never reach the server', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl', 'met-via': 'Conference' } });
    expect(await t.run()).toBe('pushed');
    expect(t.pushes[0].vcard.raw).not.toMatch(/MET-VIA/i);
    expect(t.pushes[0].vcard.raw).not.toContain('Conference');

    const created = setup({ local: { name: 'Sem', uid: 'sem-0001', 'met-via': 'Conference' } });
    expect(await created.run()).toBe('created');
    expect(created.pushes[0].vcard.raw).not.toMatch(/MET-VIA/i);
    expect(created.note.writes).toEqual([]);
  });

  it('body is never sent', async () => {
    const v2 = edit(V1, 'type=pref:06-12345678', 'type=pref:06-11111111');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), mobile: '06-22222222', email: 'jan@new.nl' } });
    await t.run();
    const created = setup({ local: { name: 'Sem', uid: 'sem-0001' } });
    await created.run();
    const pushes = [...t.pushes, ...created.pushes];
    expect(pushes.length).toBeGreaterThan(1);
    for (const p of pushes) {
      expect(p.vcard.raw).not.toContain('SECRET-BODY-TEXT');
      expect(p.vcard.raw).not.toContain('Sync conflict');
    }
  });

  it('a PUT without etag stores the card as pulled again', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: 'Chef' } });
    t.options.etagOnPut = false;
    expect(await t.run()).toBe('pushed');
    const card = t.cards.get(HREF)!;
    expect(t.entries.get(UID)).toEqual({ raw: card.raw, etag: card.etag, href: HREF });
  });

  it('lookup errors fail without writing', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: 'Chef' } });
    t.options.metaError = { status: 401, data: '', headers: {}, errorMessage: '401 Unauthorized' };
    expect(await t.run()).toBe('failed');
    expect(t.notices).toEqual([expect.stringContaining('401 Unauthorized')]);
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);
    expect(t.entries.get(UID)?.etag).toBe('old');

    const p = setup({ server: V1, base: V1 });
    p.options.pullError = { status: 500, data: '', headers: {}, errorMessage: '500 Internal Server Error' };
    expect(await p.run()).toBe('failed');
    expect(p.notices).toEqual([expect.stringContaining('500 Internal Server Error')]);
    expect(p.note.writes).toEqual([]);
  });

  it('a failed PUT fails without writing the note or the base', async () => {
    const v2 = edit(V1, 'TITLE:Baker', 'TITLE:Master baker');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl' } });
    t.options.beforePut = () => ({ status: 403, data: '', headers: {}, errorMessage: '403 Forbidden' });
    expect(await t.run()).toBe('failed');
    expect(t.notices).toEqual([expect.stringContaining('403 Forbidden')]);
    expect(t.note.writes).toEqual([]);
    expect(t.entries.get(UID)?.etag).toBe('old');
  });

  it('a urn:uuid uid in the note matches a plain server UID without a conflict', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), uid: `urn:uuid:${UID}` } });
    expect(await t.run()).toBe('unchanged');
    expect(t.pushes).toEqual([]);
    expect(t.note.appended).toEqual([]);
    expect(lineTexts(t.cards.get(HREF)!.raw)).toContain(`UID:${UID}`);
  });

  it('a card found under a different UID is not merged into', async () => {
    const other = edit(V1, `UID:${UID}`, `UID:${UID}-other`);
    const t = setup({ server: other, href: '/frank/contacts/other.vcf' });
    expect(await t.run()).toBe('created');
    expect(t.cards.get('/frank/contacts/other.vcf')!.raw).toBe(other);
    expect(t.pushes[0].opts).toEqual({ ifNoneMatch: true });
  });

  it('note coercion warnings are notified', async () => {
    // The note's list is read as its first item, which equals the server value: nothing to write.
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: ['Baker', 'Chef'] } });
    expect(await t.run()).toBe('unchanged');
    expect(t.notices).toEqual([expect.stringContaining('title')]);
    expect(t.pushes).toEqual([]);
  });

  it('a conflict found again after a 412 is reported once', async () => {
    const v2 = edit(V1, 'type=pref:06-12345678', 'type=pref:06-11111111');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), mobile: '06-22222222', email: 'jan@new.nl' } });
    t.options.beforePut = (attempt) => (attempt === 1 ? { status: 412, data: '', headers: {}, errorMessage: '' } : undefined);
    expect(await t.run()).toBe('both');
    expect(t.pushes).toHaveLength(2);
    expect(t.note.appended).toHaveLength(1);
    expect(t.notices).toHaveLength(1);
    expect(t.note.writes).toEqual([{ set: { mobile: '06-11111111' }, remove: [] }]);
  });

  it('a 412 on create retries through the lookup and merges', async () => {
    const t = setup({ local: { ...friendlyOf(V1), title: 'Chef' } });
    t.options.beforePut = (attempt) => {
      // Another client creates the card between our lookup and our PUT.
      if (attempt === 1) t.put(HREF, V1);
    };
    expect(await t.run()).toBe('pulled');
    expect(t.pushes.map((p) => p.status)).toEqual([412]);
    expect(t.pushes[0].opts).toEqual({ ifNoneMatch: true });
    expect(t.note.frontmatter.title).toBe('Baker');
    expect(t.note.appended).toHaveLength(1);
    expect(t.cards.get(HREF)!.raw).toBe(V1);
  });

  it('a PUT rejected without an error message fails', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: 'Chef' } });
    t.options.beforePut = () => ({ status: 409, data: '', headers: {}, errorMessage: '' });
    expect(await t.run()).toBe('failed');
    expect(t.notices).toEqual([expect.stringContaining('409')]);
    expect(t.note.writes).toEqual([]);
    expect(t.entries.get(UID)?.etag).toBe('old');
  });

  it('a pulled card with another UID fails without writing', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: 'Chef' } });
    t.options.pullResult = { uid: undefined, raw: '', etag: 'x', href: HREF };
    expect(await t.run()).toBe('failed');
    expect(t.notices).toHaveLength(1);
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);
    expect(t.entries.get(UID)?.etag).toBe('old');
  });

  it('an unexpected error fails with a notice', async () => {
    const t = setup({ server: V1, base: V1 });
    t.options.metaThrows = new Error('boom');
    expect(await t.run()).toBe('failed');
    expect(t.notices).toEqual([expect.stringContaining('boom')]);
    expect(t.note.writes).toEqual([]);
  });

  it('a category added on the server reaches the note as a list', async () => {
    const v2 = edit(V1, 'TITLE:Baker\r\n', 'TITLE:Baker\r\nCATEGORIES:family,bakers\r\n');
    const t = setup({ server: v2, base: V1 });
    expect(await t.run()).toBe('pulled');
    expect(t.note.writes).toEqual([{ set: { categories: ['family', 'bakers'] }, remove: [] }]);
  });

  it('serializes the pushed card with CRLF', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: 'Chef' } });
    await t.run();
    expect(t.pushes[0].vcard.raw).toBe(serializeCard(parseCard(t.pushes[0].vcard.raw)));
  });
});
