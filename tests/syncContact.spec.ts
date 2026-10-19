import { parseCard, serializeCard, serializeLine } from 'src/contacts/friendly/lines';
import { convertFrontmatter } from 'src/contacts/convertNotes';
import { DEFAULT_MAPPING, isMappedProperty } from 'src/contacts/friendly/mapping';
import { RelationContext } from 'src/contacts/friendly/relations';
import { FriendlyValue, toFriendly } from 'src/contacts/friendly/translate';
import { PushOptions, VCardMeta, VCardRaw } from 'src/sync/adapters/adapter';
import { AdapterInterface } from 'src/sync/adapters/adapterInterface';
import { canApply, Choice, resultProps } from 'src/sync/review';
import { applySync, locateCard, NoteIO, prepareSync, PreparedSync, SyncDeps } from 'src/sync/syncContact';
import { SyncState, SyncStateEntry } from 'src/sync/syncState';
import { AppHttpResponse } from 'src/util/platformHttpClient';
import { cleanUid } from 'src/util/vcard';
import { readVcfFixture } from 'tests/fixtures/fixtures';
import { describe, expect, it } from 'vitest';

const ctx: RelationContext = {
  uidToName: () => undefined,
  displayName: () => undefined,
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
function fakeAdapter(book = '/frank/contacts/') {
  const cards = new Map<string, { raw: string; etag: string }>();
  const pushes: Push[] = [];
  const deletes: { href: string; etag: string; status: number }[] = [];
  let counter = 0;
  const nextEtag = () => `${book.length}e${++counter}`;
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
    /** The server sends no ETag on GET and none in the lookup. */
    noEtags: false,
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
      // Like the CardDAV adapter: the server matches "contains", the adapter keeps the exact (cleanUid) match.
      const found = [...cards.entries()].find(([, c]) => cleanUid(uidOf(c.raw)) === cleanUid(uid));
      if (!found) return undefined;
      if (!options.metaAfterCreate && pushes.some((p) => p.opts?.ifNoneMatch)) return undefined;
      const [href, card] = found;
      const etag = options.noEtags ? '' : card.etag;
      return { href, etag, lastModified: new Date(), uid: cleanUid(uidOf(card.raw)), fn: undefined, n: undefined };
    },
    async pull(href: string): Promise<VCardRaw | AppHttpResponse | undefined> {
      if (options.pullError) return options.pullError;
      if (options.pullResult) return options.pullResult;
      const card = cards.get(href);
      if (!card) return { status: 404, data: '', headers: {}, errorMessage: '404 Not Found' };
      return { uid: uidOf(card.raw), raw: card.raw, etag: options.noEtags ? undefined : card.etag, href };
    },
    async push(vcard: VCardRaw, opts?: PushOptions): Promise<AppHttpResponse> {
      const href = opts?.href ?? `${book}${vcard.uid}.vcf`;
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
    async delete(href: string, etag: string) {
      const current = cards.get(href);
      const status = !current ? 404 : current.etag !== etag ? 412 : 204;
      deletes.push({ href, etag, status });
      if (status === 204) cards.delete(href);
      return ok(status);
    },
    getMetaList: async () => [],
    checkConnectivity: async () => ok(200),
  };
  return { adapter, cards, pushes, deletes, options, put };
}

function memoryState(initial: Record<string, SyncStateEntry> = {}) {
  const entries = new Map(Object.entries(initial).map(([k, v]) => [cleanUid(k), v]));
  const sets: string[] = [];
  const state: SyncState = {
    get: async (uid) => entries.get(cleanUid(uid)),
    set: async (uid, entry) => {
      sets.push(uid);
      entries.set(cleanUid(uid), entry);
    },
    remove: async (uid) => {
      entries.delete(cleanUid(uid));
    },
  };
  return { state, entries, sets };
}

function memoryNote(frontmatter: Record<string, unknown>) {
  const note = {
    frontmatter: { ...frontmatter },
    basename: 'Jan de Vries',
    writes: [] as { set: Record<string, FriendlyValue>; remove: string[] }[],
    renames: [] as string[],
    /** The display name each rename was given (for the links to the contact). */
    displayNames: [] as (string | undefined)[],
    /** Basenames that already exist next to the note. */
    taken: new Set<string>(),
    /** Reads, writes and renames in the order they happened. */
    log: [] as string[],
  };
  const io: NoteIO = {
    readFrontmatter: async () => {
      note.log.push('read');
      return { ...note.frontmatter };
    },
    writeProps: async (set, remove) => {
      note.log.push(`write:${note.basename}`);
      note.writes.push({ set, remove });
      for (const key of remove) delete note.frontmatter[key];
      Object.assign(note.frontmatter, set);
    },
    rename: async (newBasename, displayName) => {
      if (note.taken.has(newBasename)) return 'exists';
      note.log.push(`rename:${newBasename}`);
      note.renames.push(newBasename);
      note.displayNames.push(displayName);
      note.basename = newBasename;
      return 'renamed';
    },
  };
  return { note, io };
}

const OPTS = { sourceName: 'Radicale' };

function setup(
  opts: { server?: string; href?: string; base?: string; local?: Record<string, unknown>; ctx?: RelationContext } = {},
) {
  const fake = fakeAdapter();
  const serverEtag = opts.server !== undefined ? fake.put(opts.href ?? HREF, opts.server) : undefined;
  const { state, entries, sets } = memoryState(
    opts.base !== undefined ? { [UID]: { raw: opts.base, etag: 'old', href: opts.href ?? HREF } } : {},
  );
  const { note, io } = memoryNote(opts.local ?? friendlyOf(V1));
  const notices: string[] = [];
  const deps: SyncDeps = {
    adapter: fake.adapter,
    state,
    rows: DEFAULT_MAPPING,
    ctx: opts.ctx ?? ctx,
    readOnlyCtx: opts.ctx ?? ctx,
    notify: (msg) => notices.push(msg),
  };
  const prepare = () => prepareSync(io, deps, { sourceId: 'radicale' });
  /** Prepare, then (when there is a review) apply with the preselections plus the given choices. */
  async function sync(choices: Record<string, Choice> = {}, applyOpts: { rename?: string; sourceName: string } = OPTS) {
    const prepared = await prepare();
    if (prepared.kind !== 'review') return prepared;
    return apply(prepared.prepared, choices, applyOpts);
  }
  function apply(prepared: PreparedSync, choices: Record<string, Choice> = {}, applyOpts: { rename?: string; sourceName: string } = OPTS) {
    const map = new Map(Object.entries(choices));
    expect(canApply(prepared.rows, map)).toBe(true);
    const R = resultProps(prepared.rows, map, prepared.server?.friendly.props ?? {});
    return applySync(prepared, R, io, deps, applyOpts);
  }
  return { ...fake, entries, sets, note, io, notices, deps, serverEtag, prepare, apply, sync };
}

async function reviewOf(t: ReturnType<typeof setup>): Promise<PreparedSync> {
  const result = await t.prepare();
  if (result.kind !== 'review') throw new Error(`expected a review, got ${JSON.stringify(result)}`);
  return result.prepared;
}

const changedRows = (prepared: PreparedSync) =>
  prepared.rows.filter((r) => r.changed).map((r) => [r.property, r.preselect]);

describe('prepareSync', () => {
  it('unchanged on both sides is up to date and writes nothing', async () => {
    const t = setup({ server: V1, base: V1 });
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);
    expect(t.notices).toEqual([]);
    expect(t.sets).toEqual([]);
    expect(t.entries.get(UID)).toEqual({ raw: V1, etag: 'old', href: HREF });
  });

  it('no base and equal stores the base only', async () => {
    const t = setup({ server: V1 });
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
    expect(t.entries.get(UID)).toEqual({ raw: V1, etag: t.serverEtag, href: HREF, reader: 2 });
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);
    expect(t.cards.get(HREF)!.raw).toBe(V1);
  });

  describe('a base stored by an older reader', () => {
    // What DAVx5 writes in a 3.0 card for a relationship and an anniversary entered on the phone.
    const PHONE = edit(
      V1,
      'TITLE:Baker\r\n',
      'TITLE:Baker\r\nitem7.X-ABRELATEDNAMES:Ger Verhallen\r\nitem7.X-ABLabel:_$!<Father>!$_\r\n' +
        'item8.X-ABDATE:2012-06-21\r\nitem8.X-ABLabel:_$!<Anniversary>!$_\r\n',
    );
    // The note as the older reader made it: the phone's lines were not read.
    const oldNote = () => toFriendly(parseCard(PHONE), DEFAULT_MAPPING, ctx, { reader: 1 }).props;

    it('old base with phone relationships preselects the server', async () => {
      const t = setup({ server: PHONE, base: PHONE, local: oldNote() });
      expect(changedRows(await reviewOf(t))).toEqual([
        ['anniversary', 'server'],
        ['parents', 'server'],
      ]);
    });

    it('Apply puts them into the note, leaves the card alone and records reader 2', async () => {
      const t = setup({ server: PHONE, base: PHONE, local: oldNote() });
      expect(await t.sync()).toEqual({ kind: 'done', outcome: 'pulled' });
      expect(t.pushes).toEqual([]);
      expect(t.note.frontmatter).toMatchObject({ parents: ['[[Ger Verhallen]]'], anniversary: '2012-06-21' });
      expect(t.entries.get(UID)).toEqual({ raw: PHONE, etag: t.serverEtag, href: HREF, reader: 2 });
      expect(await t.prepare()).toEqual({ kind: 'upToDate' });
    });

    it('the same base stored by the current reader would mean they were removed in the note', async () => {
      const t = setup({ server: PHONE, local: oldNote() });
      t.entries.set(UID, { raw: PHONE, etag: 'old', href: HREF, reader: 2 });
      expect(changedRows(await reviewOf(t))).toEqual([
        ['anniversary', 'local'],
        ['parents', 'local'],
      ]);
    });

    it('new base records reader 2', async () => {
      const t = setup({ server: PHONE, local: toFriendly(parseCard(PHONE), DEFAULT_MAPPING, ctx).props });
      expect(await t.prepare()).toEqual({ kind: 'upToDate' });
      expect(t.entries.get(UID)?.reader).toBe(2);
    });
  });

  it('no base and different makes conflicts', async () => {
    const t = setup({ server: V1, local: { ...friendlyOf(V1), title: 'Chef', role: 'Owner' } });
    const prepared = await reviewOf(t);
    expect(changedRows(prepared)).toEqual([
      ['title', undefined],
      ['role', undefined],
    ]);
    expect(canApply(prepared.rows, new Map())).toBe(false);
    // Nothing is written before Apply, not even a base.
    expect(t.entries.size).toBe(0);
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);

    // Without a base the user decides, and a PUT is allowed (with If-Match).
    const result = await t.apply(prepared, { title: 'local', role: 'server' });
    expect(result).toEqual({ kind: 'done', outcome: 'both' });
    expect(t.pushes).toHaveLength(1);
    expect(t.pushes[0].opts).toEqual({ href: HREF, ifMatch: t.serverEtag });
    expect(friendlyOf(t.cards.get(HREF)!.raw)).toMatchObject({ title: 'Chef' });
    expect(friendlyOf(t.cards.get(HREF)!.raw).role).toBeUndefined();
    expect(t.note.frontmatter.role).toBeUndefined();
    expect(t.note.frontmatter.title).toBe('Chef');
  });

  it('cancel path writes nothing', async () => {
    const v2 = edit(V1, 'TITLE:Baker', 'TITLE:Master baker');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl' } });
    const prepared = await reviewOf(t);
    expect(changedRows(prepared)).toEqual([
      ['email', 'local'],
      ['title', 'server'],
    ]);
    // Cancel = prepare without apply.
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);
    expect(t.sets).toEqual([]);
    expect(t.cards.get(HREF)!.raw).toBe(v2);
  });

  it('both sides changed is a conflict row', async () => {
    const v2 = edit(V1, 'type=pref:06-12345678', 'type=pref:06-11111111');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), mobile: '06-22222222' } });
    const prepared = await reviewOf(t);
    expect(prepared.rows.filter((r) => r.changed)).toEqual([
      { property: 'mobile', server: '06-11111111', local: '06-22222222', preselect: undefined, kind: 'text', changed: true },
    ]);
    expect(prepared.uid).toBe(UID);
    expect(prepared.target).toEqual({ sourceId: 'radicale' });
    expect(prepared.server?.href).toBe(HREF);
    expect(prepared.server?.etag).toBe(t.serverEtag);
  });

  it('a new note without uid gets no uid written before Apply', async () => {
    const t = setup({ local: { name: 'Sem Jansen' } });
    const prepared = await reviewOf(t);
    expect(prepared.uid).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(prepared.server).toBeUndefined();
    expect(prepared.rows.filter((r) => r.changed).every((r) => r.preselect === 'local')).toBe(true);
    // The UID is forced at Apply; it is no choice for the user.
    expect(prepared.rows.map((r) => r.property)).toEqual(['name']);
    expect(t.note.writes).toEqual([]);
    expect(t.pushes).toEqual([]);
    expect(t.entries.size).toBe(0);
  });

  it('prepare never writes to other notes', async () => {
    // A linked contact note without a UID: the writing context gives it one (a write to that note).
    const linked = new Map<string, string | undefined>([['Sem de Vries', undefined]]);
    const assigned: string[] = [];
    const lookups = (writes: boolean): RelationContext => ({
      uidToName: (uid) => [...linked].find(([, u]) => u === uid)?.[0],
      displayName: (uid) => [...linked].find(([, u]) => u === uid)?.[0],
      resolveLink: (name) => {
        if (!linked.has(name)) return { text: name };
        if (linked.get(name) === undefined) {
          if (!writes) return { text: name };
          linked.set(name, 'sem-new');
          assigned.push(name);
        }
        return { uid: linked.get(name)! };
      },
    });
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), children: ['[[Sem de Vries]]'] } });
    t.deps.ctx = lookups(true);
    t.deps.readOnlyCtx = lookups(false);

    const prepared = await reviewOf(t);
    expect(changedRows(prepared)).toEqual([['children', 'local']]);
    expect(assigned).toEqual([]);

    // Apply builds the card and may give the linked note its UID, as before.
    expect(await t.apply(prepared)).toMatchObject({ kind: 'done' });
    expect(assigned).toEqual(['Sem de Vries']);
    // A vCard 3.0 card: the relationship is a labelled name with the UID as a hint.
    expect(lineTexts(t.cards.get(HREF)!.raw)).toEqual(
      expect.arrayContaining(['item3.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-new:Sem de Vries', 'item3.X-ABLabel:_$!<Child>!$_']),
    );
  });

  it('a urn:uuid uid in the note matches a plain server UID', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), uid: `urn:uuid:${UID}` } });
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
    expect(t.pushes).toEqual([]);
  });

  it('numbered component and list-relation keys are no difference', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), 'street-2': 'Elders 2', 'children-2': ['[[X]]'] } });
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
  });

  it('a legacy note with the apple placeholder year is up to date', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), birthday: '1604-03-12' } });
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
    expect(t.note.writes).toEqual([]);
  });

  it('a relation written as a path is no difference', async () => {
    const sem: RelationContext = {
      uidToName: (uid) => (uid === 'sem-uid' ? 'Sem de Vries' : undefined),
      displayName: (uid) => (uid === 'sem-uid' ? 'Sem de Vries' : undefined),
      resolveLink: (name) => (name === 'Sem de Vries' || name === '06 People/Sem de Vries' ? { uid: 'sem-uid' } : { text: name }),
    };
    const server = edit(
      edit(V1, 'VERSION:3.0', 'VERSION:4.0'), // on a 3.0 card this line would open the review for its rewrite
      'TITLE:Baker\r\n',
      'TITLE:Baker\r\nRELATED;TYPE=spouse:urn:uuid:sem-uid\r\n',
    );
    const t = setup({ server, base: server, local: { ...friendlyOf(server), spouse: '[[06 People/Sem de Vries|Sem]]' }, ctx: sem });
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
  });

  it('a relation with a fixed-name note path and an alias is no difference', async () => {
    // What ObsidianRelationContext gives for a contact whose note is `Contacts/Sem/index.md` (see relationLinks.spec.ts).
    const sem: RelationContext = {
      uidToName: (uid) => (uid === 'sem-uid' ? 'Contacts/Sem/index|Sem' : undefined),
      displayName: (uid) => (uid === 'sem-uid' ? 'Sem' : undefined),
      resolveLink: (name) => (name === 'Contacts/Sem/index' || name === 'Sem' ? { uid: 'sem-uid' } : { text: name }),
    };
    const server = edit(
      edit(V1, 'VERSION:3.0', 'VERSION:4.0'), // on a 3.0 card this line would open the review for its rewrite
      'TITLE:Baker\r\n',
      'TITLE:Baker\r\nRELATED;TYPE=spouse:urn:uuid:sem-uid\r\n',
    );
    for (const spouse of ['[[Contacts/Sem/index|Sem]]', '[[Contacts/Sem/index]]', '[[Contacts/Sem/index|Sem Jr]]']) {
      const t = setup({ server, base: server, local: { ...friendlyOf(server), spouse }, ctx: sem });
      expect(await t.prepare()).toEqual({ kind: 'upToDate' });
    }
  });

  it('note coercion warnings are notified', async () => {
    // The note's list is read as its first item, which equals the server value.
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: ['Baker', 'Chef'] } });
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
    expect(t.notices).toEqual([expect.stringContaining('title')]);
  });

  it('does not create when a base exists but the card is gone', async () => {
    const t = setup({ base: V1 });
    expect(await t.prepare()).toEqual({ kind: 'failed', message: expect.stringContaining('Jan de Vries was not found on the server') });
    const nameless = setup({ base: V1, local: { uid: UID, mobile: '06-1' } });
    expect(await nameless.prepare()).toEqual({ kind: 'failed', message: expect.stringContaining(`${UID} was not found on the server`) });
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);
  });

  it('lookup, pull and unexpected errors fail without writing', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: 'Chef' } });
    t.options.metaError = { status: 401, data: '', headers: {}, errorMessage: '401 Unauthorized' };
    expect(await t.prepare()).toEqual({ kind: 'failed', message: expect.stringContaining('401 Unauthorized') });

    const p = setup({ server: V1, base: V1 });
    p.options.pullError = { status: 500, data: '', headers: {}, errorMessage: '500 Internal Server Error' };
    expect(await p.prepare()).toEqual({ kind: 'failed', message: expect.stringContaining('500 Internal Server Error') });

    const u = setup({ server: V1, base: V1 });
    u.options.metaThrows = new Error('boom');
    expect(await u.prepare()).toEqual({ kind: 'failed', message: expect.stringContaining('boom') });

    const w = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: 'Chef' } });
    w.options.pullResult = { uid: undefined, raw: '', etag: 'x', href: HREF };
    expect(await w.prepare()).toEqual({ kind: 'failed', message: expect.stringContaining('not the card with UID') });

    for (const x of [t, p, u, w]) {
      expect(x.pushes).toEqual([]);
      expect(x.note.writes).toEqual([]);
      expect(x.entries.get(UID)?.etag).toBe('old');
    }
  });

  it('a card found under a different UID is a new card', async () => {
    const other = edit(V1, `UID:${UID}`, `UID:${UID}-other`);
    const t = setup({ server: other, href: '/frank/contacts/other.vcf' });
    const prepared = await reviewOf(t);
    expect(prepared.server).toBeUndefined();
    expect(await t.apply(prepared)).toEqual({ kind: 'done', outcome: 'created' });
    expect(t.cards.get('/frank/contacts/other.vcf')!.raw).toBe(other);
    expect(t.pushes[0].opts).toEqual({ ifNoneMatch: true });
  });
});

describe('prepareSync with the frontmatter already read', () => {
  it('works from the given frontmatter without reading the note; Apply sees a later change as stale', async () => {
    const v2 = edit(V1, 'TITLE:Baker', 'TITLE:Master baker');
    const t = setup({ server: v2, base: V1 });
    const given = { ...t.note.frontmatter };
    t.note.frontmatter.source = 'Family'; // changed after the book was chosen
    const prepared = await prepareSync(t.io, t.deps, { sourceId: 'radicale', frontmatter: given });
    expect(t.note.log).toEqual([]);
    if (prepared.kind !== 'review') throw new Error(`expected a review, got ${prepared.kind}`);
    expect(await t.apply(prepared.prepared)).toEqual({ kind: 'stale', reason: 'note' });
    expect(t.note.writes).toEqual([]);
    expect(t.note.frontmatter.source).toBe('Family');
  });
});

describe('applySync', () => {
  it('server-only change is pulled with the source written', async () => {
    const v2 = edit(V1, 'item1.TEL;type=CELL;type=VOICE;type=pref:06-12345678', 'item1.TEL;type=CELL;type=VOICE;type=pref:06-99999999');
    const t = setup({ server: v2, base: V1 });
    expect(changedRows(await reviewOf(t))).toEqual([['mobile', 'server']]);
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'pulled' });
    expect(t.note.writes).toEqual([{ set: { mobile: '06-99999999', source: 'Radicale' }, remove: [] }]);
    expect(t.pushes).toEqual([]);
    expect(t.entries.get(UID)).toEqual({ raw: v2, etag: t.serverEtag, href: HREF, reader: 2 });
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
  });

  it('server-side removal removes the note property', async () => {
    const v2 = edit(V1, 'TITLE:Baker\r\n', '');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), source: 'Radicale' } });
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'pulled' });
    expect(t.note.writes).toEqual([{ set: {}, remove: ['title'] }]);
    expect(t.pushes).toEqual([]);
  });

  it('local-only change is pushed with If-Match and untouched lines stay byte-identical', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl', source: 'Radicale' } });
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'pushed' });
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
    expect(put.vcard.raw).toBe(serializeCard(parseCard(put.vcard.raw)));
    expect(t.note.writes).toEqual([]);
    const stored = t.cards.get(HREF)!;
    expect(stored.raw).toBe(put.vcard.raw);
    expect(t.entries.get(UID)).toEqual({ raw: put.vcard.raw, etag: stored.etag, href: HREF, reader: 2 });
  });

  it('local and server changes on different properties give both', async () => {
    const v2 = edit(V1, 'TITLE:Baker', 'TITLE:Master baker');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl', source: 'Radicale' } });
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'both' });
    expect(t.note.writes).toEqual([{ set: { title: 'Master baker' }, remove: [] }]);
    const server = friendlyOf(t.cards.get(HREF)!.raw);
    expect(server.title).toBe('Master baker');
    expect(server.email).toBe('jan@new.nl');
  });

  it('puts to the existing href, not uid.vcf', async () => {
    const href = '/frank/contacts/ABC-DEF.vcf';
    const t = setup({ server: V1, base: V1, href, local: { ...friendlyOf(V1), title: 'Chef' } });
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'pushed' });
    expect(t.pushes).toHaveLength(1);
    expect(t.pushes[0].opts?.href).toBe(href);
    expect(t.cards.has(HREF)).toBe(false);
    expect(t.entries.get(UID)?.href).toBe(href);
  });

  it('a conflict goes the way the user chose', async () => {
    const v2 = edit(V1, 'type=pref:06-12345678', 'type=pref:06-11111111');
    const local = { ...friendlyOf(V1), mobile: '06-22222222', source: 'Radicale' };

    const server = setup({ server: v2, base: V1, local });
    expect(await server.sync({ mobile: 'server' })).toEqual({ kind: 'done', outcome: 'pulled' });
    expect(server.note.frontmatter.mobile).toBe('06-11111111');
    expect(server.pushes).toEqual([]);

    const mine = setup({ server: v2, base: V1, local });
    expect(await mine.sync({ mobile: 'local' })).toEqual({ kind: 'done', outcome: 'pushed' });
    expect(friendlyOf(mine.cards.get(HREF)!.raw).mobile).toBe('06-22222222');
    expect(mine.note.writes).toEqual([]);

    const custom = setup({ server: v2, base: V1, local });
    expect(await custom.sync({ mobile: { custom: '06-33333333' } })).toEqual({ kind: 'done', outcome: 'both' });
    expect(friendlyOf(custom.cards.get(HREF)!.raw).mobile).toBe('06-33333333');
    expect(custom.note.frontmatter.mobile).toBe('06-33333333');
  });

  it('apply aborts when the note changed', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl' } });
    const prepared = await reviewOf(t);
    t.note.frontmatter.title = 'Typed meanwhile';
    expect(await t.apply(prepared)).toEqual({ kind: 'stale', reason: 'note' });
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);
    expect(t.entries.get(UID)?.etag).toBe('old');

    // A changed source counts too.
    const s = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl' } });
    const again = await reviewOf(s);
    s.note.frontmatter.source = 'Family';
    expect(await s.apply(again)).toEqual({ kind: 'stale', reason: 'note' });
    expect(s.pushes).toEqual([]);
  });

  it('apply reopens on 412 and writes nothing', async () => {
    const v2 = edit(V1, 'TITLE:Baker', 'TITLE:Master baker');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl' } });
    const prepared = await reviewOf(t);
    // Another client edits the card while the screen is open.
    const other = edit(V1, 'TITLE:Baker', 'TITLE:Head baker');
    t.put(HREF, other);
    expect(await t.apply(prepared)).toEqual({ kind: 'stale', reason: 'server' });
    expect(t.pushes.map((p) => p.status)).toEqual([412]);
    expect(t.note.writes).toEqual([]);
    expect(t.entries.get(UID)).toEqual({ raw: V1, etag: 'old', href: HREF });
    expect(t.cards.get(HREF)!.raw).toBe(other);
  });

  it('a 412 on create is stale', async () => {
    const t = setup({ local: { ...friendlyOf(V1), title: 'Chef' } });
    const prepared = await reviewOf(t);
    t.put(HREF, V1); // another client creates the card meanwhile
    expect(await t.apply(prepared)).toEqual({ kind: 'stale', reason: 'server' });
    expect(t.pushes[0].opts).toEqual({ ifNoneMatch: true });
    expect(t.note.writes).toEqual([]);
    expect(t.entries.size).toBe(0);
    expect(t.cards.get(HREF)!.raw).toBe(V1);
  });

  it('never PUTs without If-Match when no etag is known', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: 'Chef' } });
    t.options.noEtags = true;
    expect(await t.sync()).toEqual({ kind: 'failed', message: expect.stringContaining('ETag') });
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);
    expect(t.entries.get(UID)?.etag).toBe('old');
  });

  it('a PUT without etag stores the sent card with an empty etag', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: 'Chef' } });
    t.options.etagOnPut = false;
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'pushed' });
    expect(t.entries.get(UID)).toEqual({ raw: t.pushes[0].vcard.raw, etag: '', href: HREF, reader: 2 });
  });

  it('a failed PUT fails without writing the note or the base', async () => {
    for (const forced of [
      { status: 403, data: '', headers: {}, errorMessage: '403 Forbidden' },
      { status: 409, data: '', headers: {}, errorMessage: '' },
    ]) {
      const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl' } });
      t.options.beforePut = () => forced;
      expect(await t.sync()).toEqual({ kind: 'failed', message: expect.stringContaining(String(forced.status)) });
      expect(t.note.writes).toEqual([]);
      expect(t.entries.get(UID)?.etag).toBe('old');
    }
  });

  it('new contact is created with If-None-Match', async () => {
    const t = setup({ local: { name: 'Sem Jansen', uid: 'urn:uuid:sem-0001', mobile: '06-55555555' } });
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'created' });
    expect(t.pushes).toHaveLength(1);
    const [put] = t.pushes;
    expect(put.opts).toEqual({ ifNoneMatch: true });
    expect(put.vcard.uid).toBe('sem-0001');
    const href = '/frank/contacts/sem-0001.vcf';
    const card = t.cards.get(href)!;
    expect(friendlyOf(card.raw)).toMatchObject({ name: 'Sem Jansen', uid: 'urn:uuid:sem-0001', mobile: '06-55555555' });
    expect(t.entries.get('sem-0001')).toEqual({ raw: put.vcard.raw, etag: card.etag, href, reader: 2 });
    expect(t.note.writes).toEqual([{ set: { source: 'Radicale' }, remove: [] }]);
  });

  it("create picks the book's version", async () => {
    for (const version of ['3.0', '4.0'] as const) {
      const t = setup({ local: { name: 'Sem Jansen', uid: 'sem-0001', birthday: '--03-15' } });
      let asked = 0;
      t.deps.newCardVersion = async () => {
        asked++;
        return version;
      };
      expect(await t.sync()).toEqual({ kind: 'done', outcome: 'created' });
      expect(asked).toBe(1);
      const raw = t.pushes[0].vcard.raw;
      expect(lineTexts(raw)).toContain(`VERSION:${version}`);
      expect(lineTexts(raw)).toContain(version === '3.0' ? 'BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-15' : 'BDAY:--0315');
      expect(t.note.frontmatter.birthday).toBe('--03-15');
    }
  });

  it('an existing card never asks for the version of new cards', async () => {
    const t = setup({ server: V1, local: { ...friendlyOf(V1), title: 'Chef' } });
    t.deps.newCardVersion = async () => {
      throw new Error('asked');
    };
    expect(await t.sync({ title: 'local' })).toMatchObject({ kind: 'done' });
    expect(lineTexts(t.pushes[0].vcard.raw)).toContain('VERSION:3.0');
  });

  it('new contact without uid gets it written at Apply', async () => {
    const t = setup({ local: { name: 'Sem Jansen' } });
    const prepared = await reviewOf(t);
    expect(await t.apply(prepared)).toEqual({ kind: 'done', outcome: 'created' });
    expect(t.note.writes).toHaveLength(1);
    expect(t.note.writes[0]).toEqual({ set: { uid: prepared.uid, source: 'Radicale' }, remove: [] });
    expect(friendlyOf(t.pushes[0].vcard.raw).uid).toBe(prepared.uid);
    expect(t.entries.get(cleanUid(prepared.uid))?.href).toBe(`/frank/contacts/${cleanUid(prepared.uid)}.vcf`);
  });

  it('created card falls back to <uid>.vcf when the lookup after create fails', async () => {
    const t = setup({ local: { name: 'Sem Jansen', uid: 'sem-0001' } });
    t.options.metaAfterCreate = false;
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'created' });
    expect(t.entries.get('sem-0001')?.href).toBe('sem-0001.vcf');
  });

  it('a created card settles the note too', async () => {
    const t = setup({ local: { name: 'Sem Jansen', uid: 'sem-0001', 'mobile-2': '06-55555555' } });
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'created' });
    expect(t.note.frontmatter.mobile).toBe('06-55555555');
    expect(t.note.frontmatter).not.toHaveProperty('mobile-2');
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
    expect(t.pushes).toHaveLength(1);
  });

  it('local-only properties and the body never reach the server', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl', 'met-via': 'Conference' } });
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'pushed' });
    expect(t.pushes[0].vcard.raw).not.toMatch(/MET-VIA/i);
    expect(t.pushes[0].vcard.raw).not.toContain('Conference');
    expect(t.note.frontmatter['met-via']).toBe('Conference');

    const created = setup({ local: { name: 'Sem', uid: 'sem-0001', 'met-via': 'Conference' } });
    expect(await created.sync()).toEqual({ kind: 'done', outcome: 'created' });
    expect(created.pushes[0].vcard.raw).not.toMatch(/MET-VIA/i);
    expect(created.note.frontmatter['met-via']).toBe('Conference');
  });

  it('patch and newCard warnings are notified', async () => {
    const ambiguous: RelationContext = { ...ctx, resolveLink: () => ({ ambiguous: true }) };
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), friends: ['[[Piet]]'] }, ctx: ambiguous });
    expect(await t.sync()).toMatchObject({ kind: 'done' });
    expect(t.notices).toEqual([expect.stringContaining('"Piet" matches more than one contact')]);
    expect(lineTexts(t.pushes[0].vcard.raw)).toEqual(
      expect.arrayContaining(['item3.X-ABRELATEDNAMES:Piet', 'item3.X-ABLabel:_$!<Friend>!$_']),
    );

    const n = setup({ local: { name: 'Sem', uid: 'sem-0001', spouse: '[[Piet]]' }, ctx: ambiguous });
    expect(await n.sync()).toEqual({ kind: 'done', outcome: 'created' });
    expect(n.notices).toEqual([expect.stringContaining('"Piet" matches more than one contact')]);
  });

  it('a urn:uuid uid in the note is not rewritten and the card keeps its UID spelling', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), uid: `urn:uuid:${UID}`, title: 'Chef', source: 'Radicale' } });
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'pushed' });
    expect(lineTexts(t.cards.get(HREF)!.raw)).toContain(`UID:${UID}`);
    expect(t.note.writes).toEqual([]);
    expect(t.note.frontmatter.uid).toBe(`urn:uuid:${UID}`);
  });

  it('numbered component and list-relation keys are left alone in the note', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), title: 'Chef', 'street-2': 'Elders 2', 'children-2': ['[[X]]'] } });
    expect(await t.sync()).toMatchObject({ kind: 'done' });
    expect(t.note.frontmatter['street-2']).toBe('Elders 2');
    expect(t.note.frontmatter['children-2']).toEqual(['[[X]]']);
    expect(t.pushes[0].vcard.raw).not.toContain('Elders 2');
  });

  it('a legacy apple placeholder date takes a server change and settles to --MM-DD', async () => {
    const v2 = edit(V1, 'BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-12', 'BDAY;X-APPLE-OMIT-YEAR=1604:1604-04-01');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), birthday: '1604-03-12' } });
    expect(changedRows(await reviewOf(t))).toEqual([['birthday', 'server']]);
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'pulled' });
    expect(t.pushes).toEqual([]);
    expect(t.notices).toEqual([]);
    expect(t.note.frontmatter.birthday).toBe('--04-01');
  });

  it('a legacy apple placeholder date with another change pushes only that change', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), birthday: '1604-03-12', title: 'Chef' } });
    expect(changedRows(await reviewOf(t))).toEqual([['title', 'local']]);
    expect(await t.sync()).toMatchObject({ kind: 'done' });
    expect(lineTexts(t.pushes[0].vcard.raw)).toContain('BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-12');
    expect(t.note.frontmatter.birthday).toBe('--03-12');
  });

  it('a category added on the server reaches the note as a list', async () => {
    const v2 = edit(V1, 'TITLE:Baker\r\n', 'TITLE:Baker\r\nCATEGORIES:family,bakers\r\n');
    const t = setup({ server: v2, base: V1, local: { ...friendlyOf(V1), source: 'Radicale' } });
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'pulled' });
    expect(t.note.writes).toEqual([{ set: { categories: ['family', 'bakers'] }, remove: [] }]);
  });

  it('deleting mobile but keeping mobile-2 settles: the note is renumbered and the Apple label stays', async () => {
    const v1 = edit(V1, 'TEL;type=WORK;type=VOICE', 'item3.TEL;type=CELL:06-22222222\r\nitem3.X-ABLabel:Werk mobiel\r\nTEL;type=WORK;type=VOICE');
    const local: Record<string, unknown> = { ...friendlyOf(v1), source: 'Radicale' };
    expect(local).toMatchObject({ mobile: '06-12345678', 'mobile-2': '06-22222222' });
    delete local.mobile;
    const t = setup({ server: v1, base: v1, local });

    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'both' });
    expect(t.pushes).toHaveLength(1);
    expect(t.note.frontmatter.mobile).toBe('06-22222222');
    expect(t.note.frontmatter).not.toHaveProperty('mobile-2');
    const card = lineTexts(t.cards.get(HREF)!.raw);
    expect(card).toContain('item3.TEL;type=CELL:06-22222222');
    expect(card).toContain('item3.X-ABLabel:Werk mobiel');
    expect(card.join('\n')).not.toContain('06-12345678');

    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
    expect(t.pushes).toHaveLength(1);
  });

  it('a relation written as a path settles to the canonical link text', async () => {
    const sem: RelationContext = {
      uidToName: (uid) => (uid === 'sem-uid' ? 'Sem de Vries' : undefined),
      displayName: (uid) => (uid === 'sem-uid' ? 'Sem de Vries' : undefined),
      resolveLink: (name) => (name === 'Sem de Vries' || name === '06 People/Sem de Vries' ? { uid: 'sem-uid' } : { text: name }),
    };
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), children: ['[[06 People/Sem de Vries]]'], source: 'Radicale' }, ctx: sem });
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'both' });
    expect(lineTexts(t.cards.get(HREF)!.raw)).toContain('item3.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries');
    expect(t.note.frontmatter.children).toEqual(['[[Sem de Vries]]']);
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
    expect(t.pushes).toHaveLength(1);
  });

  it('first Sync of a converted upstream note: the user decides every difference', async () => {
    // Shaped like upstream output: it kept only the last TYPE (TEL[pref], TEL[VOICE], EMAIL[pref], ADR[pref]).
    const upstream: Record<string, unknown> = {
      'N.FN': 'de Vries',
      'N.GN': 'Jan',
      FN: 'Jan de Vries',
      'TEL[pref]': '06-12345678',
      'TEL[VOICE]': '030-1234567',
      'EMAIL[pref]': 'jan@example.nl',
      'ADR[pref].STREET': 'Dorpsstraat 1',
      'ADR[pref].LOCALITY': 'Utrecht',
      'ADR[pref].POSTAL': '1234 AB',
      'ADR[pref].COUNTRY': 'Nederland',
      UID,
      'X-CREATED': '2019-04-02T10:11:12Z',
      'met-via': '[[Piet]]',
    };
    const converted = convertFrontmatter(upstream, DEFAULT_MAPPING);
    const fm: Record<string, unknown> = { ...upstream };
    for (const key of converted.remove) delete fm[key];
    Object.assign(fm, converted.set);

    const t = setup({ server: V1, local: fm });
    const prepared = await reviewOf(t);
    expect(prepared.rows.filter((r) => r.changed).every((r) => r.preselect === undefined)).toBe(true);
    expect(prepared.rows.find((r) => r.property === 'phone')).toMatchObject({ local: '06-12345678', server: undefined, changed: true });

    const all = Object.fromEntries(prepared.rows.filter((r) => r.changed).map((r) => [r.property, 'server' as Choice]));
    expect(await t.apply(prepared, all)).toEqual({ kind: 'done', outcome: 'pulled' });
    expect(t.pushes).toEqual([]);
    expect(t.cards.get(HREF)!.raw).toBe(V1);
    const mapped = Object.fromEntries(Object.entries(t.note.frontmatter).filter(([k]) => isMappedProperty(k, DEFAULT_MAPPING)));
    expect(mapped).toEqual(friendlyOf(V1));
    expect(t.note.frontmatter['met-via']).toBe('[[Piet]]');
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
  });

  it('renames the note when asked, and skips with a warning when the name is taken', async () => {
    const v2 = edit(V1, 'TITLE:Baker', 'TITLE:Master baker');
    const t = setup({ server: v2, base: V1 });
    expect(await t.sync({}, { sourceName: 'Radicale', rename: 'Jan Bakker' })).toMatchObject({ kind: 'done' });
    expect(t.note.renames).toEqual(['Jan Bakker']);
    // Renamed before the properties are written: the relationship mirror sees the write under the final path.
    expect(t.note.log.filter((e) => e !== 'read')).toEqual(['rename:Jan Bakker', 'write:Jan Bakker']);

    const taken = setup({ server: v2, base: V1 });
    taken.note.taken.add('Jan Bakker');
    expect(await taken.sync({}, { sourceName: 'Radicale', rename: 'Jan Bakker' })).toMatchObject({ kind: 'done' });
    expect(taken.note.renames).toEqual([]);
    expect(taken.note.log.filter((e) => e !== 'read')).toEqual(['write:Jan de Vries']);
    expect(taken.notices).toEqual(['Not renamed: "Jan Bakker" already exists.']);
    expect(taken.note.frontmatter.title).toBe('Master baker');
    expect(taken.entries.get(UID)?.raw).toBe(v2);
  });

  it('server rename refreshes aliases: the rename gets the new name before the note has it', async () => {
    // The name changed on the server: the note is renamed before its `name` is written, so links to it must get the
    // new name from Sync, not from the note.
    const v2 = edit(edit(V1, 'FN:Jan de Vries', 'FN:Johan de Vries'), 'N:de Vries;Jan;;;', 'N:de Vries;Johan;;;');
    const t = setup({ server: v2, base: V1 });
    expect(await t.sync({}, { sourceName: 'Radicale', rename: 'Johan de Vries' })).toMatchObject({ kind: 'done' });
    expect(t.note.renames).toEqual(['Johan de Vries']);
    expect(t.note.displayNames).toEqual(['Johan de Vries']);
    expect(t.note.frontmatter.name).toBe('Johan de Vries');
  });
});

describe('old relationship lines on a 3.0 card', () => {
  const SEM = 'sem-uid';
  const people: RelationContext = {
    uidToName: (uid) => (cleanUid(uid) === SEM ? 'Sem' : undefined),
    displayName: (uid) => (cleanUid(uid) === SEM ? 'Sem de Vries' : undefined),
    resolveLink: (name) => (name === 'Sem' ? { uid: SEM } : { text: name }),
  };
  const LEGACY = edit(V1, 'TITLE:Baker\r\n', `TITLE:Baker\r\nRELATED;TYPE=child:urn:uuid:${SEM}\r\n`);
  const V4 = edit(edit(LEGACY, 'VERSION:3.0', 'VERSION:4.0'), 'item1.X-ABLabel:_$!<Mobile>!$_\r\n', '');
  const local = (raw: string) => toFriendly(parseCard(raw), DEFAULT_MAPPING, people).props;
  const rewritten = (raw: string) => lineTexts(raw).filter((l) => /RELATED|ABLabel:_\$!<Child>/.test(l));

  it('the only difference: the review opens with no rows, and is not up to date', async () => {
    const t = setup({ server: LEGACY, base: LEGACY, local: local(LEGACY), ctx: people });
    expect(local(LEGACY).children).toEqual(['[[Sem]]']);
    const prepared = await reviewOf(t);
    expect(prepared.rewriteRelations).toBe(true);
    expect(changedRows(prepared)).toEqual([]);
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);
  });

  it('Apply replaces the line by the 3.0 form, with If-Match, and the next Sync is up to date', async () => {
    const t = setup({ server: LEGACY, base: LEGACY, local: local(LEGACY), ctx: people });
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'pushed' });
    expect(t.pushes).toHaveLength(1);
    expect(t.pushes[0].opts).toEqual({ href: HREF, ifMatch: t.serverEtag });
    const raw = t.cards.get(HREF)!.raw;
    expect(rewritten(raw)).toEqual([`item3.X-ABRELATEDNAMES;X-FRIENDLY-UID=${SEM}:Sem de Vries`, 'item3.X-ABLabel:_$!<Child>!$_']);
    expect(raw).not.toContain('urn:uuid');
    expect(raw).toContain('VERSION:3.0');
    expect(t.entries.get(UID)?.raw).toBe(raw);
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
  });

  it('together with other differences: both rows and the rewrite', async () => {
    const t = setup({ server: LEGACY, base: LEGACY, local: { ...local(LEGACY), title: 'Chef' }, ctx: people });
    const prepared = await reviewOf(t);
    expect(prepared.rewriteRelations).toBe(true);
    expect(changedRows(prepared)).toEqual([['title', 'local']]);
    expect(await t.apply(prepared)).toEqual({ kind: 'done', outcome: 'pushed' });
    const raw = t.cards.get(HREF)!.raw;
    expect(raw).toContain('TITLE:Chef');
    expect(rewritten(raw)).toHaveLength(2);
    expect(raw).not.toContain('urn:uuid');
  });

  it('taking the card\'s side everywhere still rewrites', async () => {
    const server = edit(LEGACY, 'TITLE:Baker', 'TITLE:Master baker');
    const t = setup({ server, base: LEGACY, local: local(LEGACY), ctx: people });
    expect(changedRows(await reviewOf(t))).toEqual([['title', 'server']]);
    expect(await t.sync()).toEqual({ kind: 'done', outcome: 'both' });
    const raw = t.cards.get(HREF)!.raw;
    expect(raw).toContain('TITLE:Master baker');
    expect(raw).not.toContain('urn:uuid');
    expect(t.note.frontmatter.title).toBe('Master baker');
  });

  it('Cancel (prepare without Apply) writes nothing', async () => {
    const t = setup({ server: LEGACY, base: LEGACY, local: local(LEGACY), ctx: people });
    await reviewOf(t);
    expect(t.pushes).toEqual([]);
    expect(t.note.writes).toEqual([]);
    expect(t.sets).toEqual([]);
    expect(t.cards.get(HREF)!.raw).toBe(LEGACY);
  });

  it('a 4.0 card never needs the rewrite', async () => {
    const t = setup({ server: V4, base: V4, local: local(V4), ctx: people });
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
    const changed = setup({ server: V4, base: V4, local: { ...local(V4), title: 'Chef' }, ctx: people });
    expect((await reviewOf(changed)).rewriteRelations).toBe(false);
    await changed.sync();
    expect(changed.cards.get(HREF)!.raw).toContain('RELATED;TYPE=child:urn:uuid:sem-uid');
  });

  it('a RELATED line that cannot be rewritten does not ask for a review', async () => {
    const t = setup({ server: LEGACY, base: LEGACY, local: friendlyOf(LEGACY) }); // nobody knows sem-uid
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
  });

  it('a card without RELATED lines is unaffected', async () => {
    const t = setup({ server: V1, base: V1, local: friendlyOf(V1), ctx: people });
    expect(await t.prepare()).toEqual({ kind: 'upToDate' });
  });
});

describe('source is a note-only property', () => {
  it('source is never sent to a created card and is written as the target name', async () => {
    const t = setup({ local: { ...friendlyOf(V1), source: 'Family' } });
    expect(await t.sync({}, { sourceName: 'Family' })).toEqual({ kind: 'done', outcome: 'created' });
    expect(t.pushes).toHaveLength(1);
    expect(t.pushes[0].vcard.raw).not.toMatch(/Family/);
    expect(t.note.frontmatter.source).toBe('Family');
  });

  it('source is never sent on a push', async () => {
    const t = setup({ server: V1, base: V1, local: { ...friendlyOf(V1), email: 'jan@new.nl', source: 'Family' } });
    expect(await t.sync({}, { sourceName: 'Family' })).toEqual({ kind: 'done', outcome: 'pushed' });
    expect(t.pushes[0].vcard.raw).not.toMatch(/Family/);
    expect(t.note.frontmatter.source).toBe('Family');
  });
});

describe('moving between address books', () => {
  function moveSetup(local: Record<string, unknown>) {
    const from = fakeAdapter('/frank/contacts/');
    const etag = from.put(HREF, V1);
    const fromState = memoryState({ [UID]: { raw: V1, etag, href: HREF } });
    const to = fakeAdapter('/frank/family/');
    const toState = memoryState();
    const { note, io } = memoryNote({ ...local, source: 'Family' });
    const notices: string[] = [];
    const deps: SyncDeps = { adapter: to.adapter, state: toState.state, rows: DEFAULT_MAPPING, ctx, readOnlyCtx: ctx, notify: (m) => notices.push(m) };
    const where = { sourceId: 'family', move: { from: { sourceId: 'radicale', href: HREF, etag }, adapter: from.adapter, state: fromState.state } };
    return { from, to, fromState, toState, note, io, deps, where, notices, etag };
  }

  it('move writes the reviewed card to the new book and deletes the old', async () => {
    const m = moveSetup({ ...friendlyOf(V1), mobile: '06-77777777' });
    const result = await prepareSync(m.io, m.deps, m.where);
    if (result.kind !== 'review') throw new Error(result.kind);
    expect(result.prepared.move?.from).toEqual({ sourceId: 'radicale', href: HREF, etag: m.etag });
    expect(result.prepared.target).toEqual({ sourceId: 'family' });
    expect(changedRows(result.prepared)).toEqual([['mobile', 'local']]);
    // Nothing yet.
    expect(m.to.pushes).toEqual([]);
    expect(m.from.deletes).toEqual([]);

    const R = resultProps(result.prepared.rows, new Map(), result.prepared.server!.friendly.props);
    expect(await applySync(result.prepared, R, m.io, m.deps, { sourceName: 'Family' })).toMatchObject({ kind: 'done', oldKept: false });
    expect(m.from.pushes).toEqual([]);
    expect(m.to.pushes).toHaveLength(1);
    expect(m.to.pushes[0].opts).toEqual({ ifNoneMatch: true });
    const moved = [...m.to.cards.values()][0];
    expect(friendlyOf(moved.raw).mobile).toBe('06-77777777');
    const changed = lineTexts(moved.raw).filter((l) => !lineTexts(V1).includes(l));
    expect(changed.map((l) => l.split(/[;:]/)[0]).sort()).toEqual(['REV', 'item1.TEL']);
    expect(m.from.cards.size).toBe(0);
    expect(m.fromState.entries.size).toBe(0);
    expect(m.toState.entries.get(UID)?.raw).toBe(moved.raw);
    expect(m.note.frontmatter.source).toBe('Family');
  });

  it('a move stores the base after the note is written', async () => {
    const m = moveSetup({ ...friendlyOf(V1), mobile: '06-77777777' });
    const result = await prepareSync(m.io, m.deps, m.where);
    if (result.kind !== 'review') throw new Error(result.kind);
    m.io.writeProps = async () => {
      throw new Error('note is read-only');
    };
    const R = resultProps(result.prepared.rows, new Map(), result.prepared.server!.friendly.props);
    // Another source name than the note holds, so the note must be written.
    expect(await applySync(result.prepared, R, m.io, m.deps, { sourceName: 'Family book' })).toEqual({
      kind: 'failed',
      message: 'note is read-only',
    });
    expect(m.to.cards.size).toBe(1);
    expect(m.toState.sets).toEqual([]);
    expect(m.fromState.entries.size).toBe(1);
  });

  it('a move without differences still opens the review', async () => {
    const m = moveSetup(friendlyOf(V1));
    const result = await prepareSync(m.io, m.deps, m.where);
    expect(result.kind).toBe('review');
    expect(m.fromState.sets).toEqual([]);
    expect(m.toState.sets).toEqual([]);
  });

  it('a move whose old card changed meanwhile is stale and writes nothing', async () => {
    const m = moveSetup({ ...friendlyOf(V1), mobile: '06-77777777' });
    const result = await prepareSync(m.io, m.deps, m.where);
    if (result.kind !== 'review') throw new Error(result.kind);
    m.from.put(HREF, edit(V1, 'TITLE:Baker', 'TITLE:Head baker'));
    const R = resultProps(result.prepared.rows, new Map(), result.prepared.server!.friendly.props);
    expect(await applySync(result.prepared, R, m.io, m.deps, { sourceName: 'Family' })).toEqual({ kind: 'stale', reason: 'server' });
    expect(m.to.pushes).toEqual([]);
    expect(m.from.deletes).toEqual([]);
    expect(m.note.writes).toEqual([]);
    expect(m.fromState.entries.size).toBe(1);
  });
});

describe('locateCard', () => {
  it('finds the card by exact UID in every source and reports lookup errors', async () => {
    const a = fakeAdapter();
    const b = fakeAdapter();
    const c = fakeAdapter();
    const d = fakeAdapter();
    const etag = a.put(HREF, V1);
    // b's server answers with a card whose UID merely contains ours: not this contact's card.
    b.adapter.getMetaByUid = async () => ({ href: '/b/other.vcf', etag: 'x', lastModified: new Date(), uid: `${UID}-X`, fn: undefined, n: undefined });
    c.options.metaError = { status: 500, data: '', headers: {}, errorMessage: 'HTTP 500' };
    d.options.metaThrows = new Error('offline');

    const result = await locateCard(
      [
        { sourceId: 'a', adapter: a.adapter },
        { sourceId: 'b', adapter: b.adapter },
        { sourceId: 'c', adapter: c.adapter },
        { sourceId: 'd', adapter: d.adapter },
      ],
      `urn:uuid:${UID}`,
    );

    expect(result.found).toEqual([{ sourceId: 'a', href: HREF, etag }]);
    expect(result.failed).toEqual([
      { sourceId: 'c', message: 'HTTP 500' },
      { sourceId: 'd', message: 'offline' },
    ]);
  });
});
