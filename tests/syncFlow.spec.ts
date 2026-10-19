import { parseCard } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { RelationContext } from 'src/contacts/friendly/relations';
import { FriendlyValue } from 'src/contacts/friendly/translate';
import type { Source } from 'src/settings/settings.d';
import { PushOptions, VCardMeta, VCardRaw } from 'src/sync/adapters/adapter';
import { AdapterInterface } from 'src/sync/adapters/adapterInterface';
import { Choice } from 'src/sync/review';
import { MAX_REOPENS, REWRITE_LINE, ReviewDecision, ReviewRequest, syncFlow, SyncFlowDeps } from 'src/sync/syncFlow';
import { SyncState, SyncStateEntry } from 'src/sync/syncState';
import { AppHttpResponse } from 'src/util/platformHttpClient';
import { cleanUid } from 'src/util/vcard';
import { describe, expect, it } from 'vitest';

const UID = '1234ABCD-0000-4000-8000-000000000001';
const card = (mobile = '06-1', extra: string[] = []) =>
  [
    'BEGIN:VCARD',
    'VERSION:4.0',
    `UID:${UID}`,
    'FN:Jan de Vries',
    'N:de Vries;Jan;;;',
    `TEL;TYPE=CELL:${mobile}`,
    ...extra,
    'END:VCARD',
    '',
  ].join('\r\n');
const JAN = { name: 'Jan de Vries', firstname: 'Jan', lastname: 'de Vries', mobile: '06-1', uid: UID };

const ok = (status: number, headers: Record<string, string> = {}): AppHttpResponse => ({ status, data: '', headers, errorMessage: '' });

/** One in-memory CardDAV address book. */
function fakeBook(id: string, name: string) {
  const prefix = `/${id}/`;
  const cards = new Map<string, { raw: string; etag: string }>();
  const pushes: { vcard: VCardRaw; opts?: PushOptions; status: number }[] = [];
  const deletes: string[] = [];
  let counter = 0;
  const options = { failPut: undefined as number | undefined, searchFails: false };
  const uidOf = (raw: string) => parseCard(raw).find((l) => l.name === 'UID')?.value;
  const put = (href: string, raw: string) => {
    const etag = `${id}-${++counter}`;
    cards.set(href, { raw, etag });
    return etag;
  };
  const adapter: AdapterInterface = {
    async getMetaByUid(uid: string): Promise<VCardMeta | AppHttpResponse | undefined> {
      if (options.searchFails) return { status: 503, data: '', headers: {}, errorMessage: 'HTTP 503' };
      const found = [...cards.entries()].find(([, c]) => cleanUid(uidOf(c.raw)) === cleanUid(uid));
      if (!found) return undefined;
      const [href, c] = found;
      return { href, etag: c.etag, lastModified: new Date(), uid: cleanUid(uidOf(c.raw)), fn: undefined, n: undefined };
    },
    async pull(href: string): Promise<VCardRaw | AppHttpResponse | undefined> {
      const c = cards.get(href);
      if (!c) return { status: 404, data: '', headers: {}, errorMessage: '404 Not Found' };
      return { uid: uidOf(c.raw), raw: c.raw, etag: c.etag, href };
    },
    async push(vcard: VCardRaw, opts?: PushOptions): Promise<AppHttpResponse> {
      const href = opts?.href ?? `${prefix}${vcard.uid}.vcf`;
      const record = { vcard, opts, status: 0 };
      pushes.push(record);
      if (options.failPut !== undefined) {
        record.status = options.failPut;
        return { status: options.failPut, data: '', headers: {}, errorMessage: `HTTP ${options.failPut}` };
      }
      const current = cards.get(href);
      if ((opts?.ifMatch !== undefined && current?.etag !== opts.ifMatch) || (opts?.ifNoneMatch && current)) {
        record.status = 412;
        return ok(412);
      }
      const etag = put(href, vcard.raw);
      record.status = current ? 204 : 201;
      return ok(record.status, { etag: `"${etag}"` });
    },
    async delete(href: string, etag: string) {
      const current = cards.get(href);
      const status = !current ? 404 : current.etag !== etag ? 412 : 204;
      if (status === 204) {
        cards.delete(href);
        deletes.push(href);
      }
      return ok(status);
    },
    getMetaList: async () => [],
    checkConnectivity: async () => ok(200),
  };
  const entries = new Map<string, SyncStateEntry>();
  const state: SyncState = {
    get: async (uid) => entries.get(cleanUid(uid)),
    set: async (uid, entry) => void entries.set(cleanUid(uid), entry),
    remove: async (uid) => void entries.delete(cleanUid(uid)),
  };
  const source: Source = { id, name, addressBookUrl: `https://dav.example${prefix}`, authType: 'basic', authKey: 'k', enabled: true };
  /** Puts a card on the server and (optionally) stores it as this book's base. */
  const seed = (raw: string, withBase = true) => {
    const href = `${prefix}${UID}.vcf`;
    const etag = put(href, raw);
    if (withBase) entries.set(UID, { raw, etag, href });
    return href;
  };
  return { id, source, adapter, state, entries, cards, pushes, deletes, options, put, seed };
}

type Book = ReturnType<typeof fakeBook>;

const noRelations: RelationContext = {
  uidToName: () => undefined,
  displayName: () => undefined,
  resolveLink: (name) => ({ text: name }),
};

/** Apply with the preselections. */
const preselected = (): ReviewDecision => ({ kind: 'apply', choices: new Map(), rename: true });

/** Every changed row from one side. */
const allFrom = (request: ReviewRequest, side: 'server' | 'local'): Map<string, Choice> =>
  new Map(request.prepared.rows.filter((r) => r.changed).map((r) => [r.property, side]));

function setup(opts: { local?: Record<string, unknown>; books?: Book[]; defaultSource?: string; ctx?: RelationContext } = {}) {
  const radicale = fakeBook('radicale', 'Radicale');
  const family = fakeBook('family', 'Family');
  const books = opts.books ?? [radicale, family];
  const note = {
    frontmatter: { ...(opts.local ?? JAN) } as Record<string, unknown>,
    writes: [] as { set: Record<string, FriendlyValue>; remove: string[] }[],
    renames: [] as string[],
  };
  const notices: string[] = [];
  const requests: ReviewRequest[] = [];
  const settles: number[] = [];
  const taken = new Set<string>();
  /** What the user does in each review; the last entry repeats. */
  let script: ((request: ReviewRequest) => ReviewDecision | Promise<ReviewDecision>)[] = [() => preselected()];
  let reviews = 0;
  const deps: SyncFlowDeps = {
    note: {
      readFrontmatter: async () => ({ ...note.frontmatter }),
      writeProps: async (set, remove) => {
        note.writes.push({ set, remove });
        for (const key of remove) delete note.frontmatter[key];
        Object.assign(note.frontmatter, set);
      },
      rename: async (to) => {
        if (taken.has(to)) return 'exists';
        note.renames.push(to);
        return 'renamed';
      },
    },
    path: 'People/Jan de Vries.md',
    name: 'Jan de Vries',
    rows: DEFAULT_MAPPING,
    sources: books.map((b) => b.source),
    active: books.filter((b) => b.source.enabled).map((b) => b.source),
    defaultSource: opts.defaultSource ?? 'radicale',
    adapterFor: (source) => books.find((b) => b.id === source.id)!.adapter,
    stateFor: (id) => books.find((b) => b.id === id)!.state,
    contexts: async () => ({ ctx: opts.ctx ?? noRelations, readOnlyCtx: opts.ctx ?? noRelations, settle: async () => void settles.push(reviews) }),
    review: async (request) => {
      requests.push(request);
      const step = script[Math.min(reviews, script.length - 1)];
      reviews++;
      return step(request);
    },
    notify: (message) => void notices.push(message),
    renameBlocked: (name) => (taken.has(name) ? `A note named "${name}" already exists in this folder.` : undefined),
  };
  const setScript = (steps: typeof script) => {
    script = steps;
  };
  return { radicale, family, books, note, notices, requests, settles, taken, deps, setScript, run: () => syncFlow(deps) };
}

const pushCount = (t: ReturnType<typeof setup>) => t.books.reduce((n, b) => n + b.pushes.length, 0);

describe('syncFlow: which address book', () => {
  it('sync: the card is in the note\'s book; Apply writes the card, then the note with source:', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    const href = t.radicale.seed(card());
    const result = await t.run();
    expect(result).toMatchObject({ kind: 'done', plan: { kind: 'sync', sourceId: 'radicale' }, outcome: 'pushed' });
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].title).toBe('Jan de Vries');
    expect(t.requests[0].moveLine).toBeUndefined();
    expect(t.radicale.cards.get(href)!.raw).toContain('TEL;TYPE=CELL:06-2');
    expect(t.family.pushes).toEqual([]);
    expect(t.notices).toEqual(['Jan de Vries: sent to the server (Radicale).']);
  });

  it('adopt: a note without source: takes the one book that holds the card', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2' } });
    const href = t.family.seed(card(), false); // no base on this device: only the search finds it
    t.setScript([(r) => ({ kind: 'apply', choices: allFrom(r, 'local'), rename: true })]);
    const result = await t.run();
    expect(result).toMatchObject({ kind: 'done', plan: { kind: 'adopt', sourceId: 'family' } });
    expect(t.family.cards.get(href)!.raw).toContain('TEL;TYPE=CELL:06-2');
    expect(t.radicale.pushes).toEqual([]);
    expect(t.note.frontmatter.source).toBe('Family');
  });

  it('move: the review shows the address book line; Apply moves the reviewed card', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Family' } });
    const oldHref = t.radicale.seed(card());
    const result = await t.run();
    expect(t.requests[0].moveLine).toBe('Address book: Radicale -> Family');
    expect(result).toMatchObject({ kind: 'done', plan: { kind: 'move', to: 'family' }, oldKept: false });
    expect(t.radicale.cards.has(oldHref)).toBe(false);
    expect([...t.family.cards.values()].map((c) => c.raw).join()).toContain('TEL;TYPE=CELL:06-2');
    expect(t.family.entries.get(UID)).toBeDefined();
    expect(t.radicale.entries.get(UID)).toBeUndefined();
    expect(t.notices).toEqual(['Moved Jan de Vries to Family.']);
  });

  it('a move without property differences still opens the review', async () => {
    const t = setup({ local: { ...JAN, source: 'Family' } });
    t.radicale.seed(card());
    t.setScript([() => ({ kind: 'cancel' })]);
    expect(await t.run()).toMatchObject({ kind: 'cancelled' });
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].moveLine).toBe('Address book: Radicale -> Family');
  });

  it('refuse: the card is in two other books; nothing opens, nothing is written', async () => {
    const third = fakeBook('third', 'Third');
    const radicale = fakeBook('radicale', 'Radicale');
    const family = fakeBook('family', 'Family');
    const t = setup({ local: { ...JAN, source: 'Third' }, books: [radicale, family, third] });
    radicale.seed(card(), false);
    family.seed(card(), false);
    const result = await t.run();
    expect(result.kind).toBe('refused');
    expect(t.requests).toEqual([]);
    expect(t.notices[0]).toMatch(/^Not syncing Jan de Vries: The card is in Radicale and Family/);
    expect(pushCount(t)).toBe(0);
    expect(t.note.writes).toEqual([]);
  });

  it('refuse: an unknown source: name never falls back', async () => {
    const t = setup({ local: { ...JAN, source: 'Work' } });
    t.radicale.seed(card());
    expect(await t.run()).toEqual({ kind: 'refused', message: "Unknown address book 'Work'" });
    expect(t.notices).toEqual(["Not syncing Jan de Vries: Unknown address book 'Work'."]);
    expect(t.requests).toEqual([]);
  });

  it('a book that cannot be searched fails before anything is written', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2' } });
    t.radicale.seed(card(), false);
    t.family.options.searchFails = true;
    t.radicale.options.searchFails = true;
    expect(await t.run()).toEqual({
      kind: 'failed',
      message: 'could not search Radicale (HTTP 503), Family (HTTP 503), and the card could be there',
    });
    expect(t.notices).toEqual(['Not syncing Jan de Vries: could not search Radicale (HTTP 503), Family (HTTP 503), and the card could be there.']);
    expect(t.requests).toEqual([]);
    expect(pushCount(t)).toBe(0);
  });

  it('a new card opens the review titled with the book', async () => {
    const { uid: _uid, ...withoutUid } = JAN;
    const t = setup({ local: withoutUid });
    const result = await t.run();
    expect(t.requests[0].title).toBe('New card in Radicale');
    expect(result).toMatchObject({ kind: 'done', outcome: 'created' });
    expect(t.radicale.cards.size).toBe(1);
    expect(t.note.frontmatter.source).toBe('Radicale');
    expect(typeof t.note.frontmatter.uid).toBe('string');
  });
});

describe("syncFlow: a new card follows its book's version", () => {
  it('asks the target book for the version of the new card', async () => {
    const { uid: _uid, ...withoutUid } = JAN;
    const t = setup({ local: { ...withoutUid, source: 'Family' } });
    const asked: string[] = [];
    t.deps.newCardVersion = async (source) => {
      asked.push(source.id);
      return '3.0';
    };
    expect(await t.run()).toMatchObject({ kind: 'done', outcome: 'created' });
    expect(asked).toEqual(['family']);
    expect([...t.family.cards.values()][0].raw).toContain('VERSION:3.0');
  });
});

describe('syncFlow: review outcomes', () => {
  it('a new card never takes values from the server: choosing the server side fails and writes nothing', async () => {
    const { uid: _uid, ...withoutUid } = JAN;
    const t = setup({ local: withoutUid });
    t.setScript([(request) => ({ kind: 'apply', choices: allFrom(request, 'server'), rename: false })]);
    const result = await t.run();
    expect(result).toMatchObject({ kind: 'failed' });
    expect(t.notices).toEqual(['Jan de Vries: nothing was synced (a new card cannot take values from the address book).']);
    expect(pushCount(t)).toBe(0);
    expect(t.radicale.cards.size).toBe(0);
    expect(t.note.writes).toEqual([]);
  });

  it('up to date: a Notice, no review, nothing written', async () => {
    const t = setup({ local: { ...JAN, source: 'Radicale' } });
    t.radicale.seed(card());
    expect(await t.run()).toMatchObject({ kind: 'upToDate' });
    expect(t.notices).toEqual(['Up to date']);
    expect(t.requests).toEqual([]);
    expect(t.note.writes).toEqual([]);
    expect(pushCount(t)).toBe(0);
  });

  it('cancel writes nothing, not even source: or a base', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2' } });
    const href = t.radicale.seed(card(), false);
    t.setScript([() => ({ kind: 'cancel' })]);
    expect(await t.run()).toMatchObject({ kind: 'cancelled' });
    expect(t.note.writes).toEqual([]);
    expect(t.note.frontmatter.source).toBeUndefined();
    expect(pushCount(t)).toBe(0);
    expect(t.radicale.entries.size).toBe(0);
    expect(t.radicale.cards.get(href)!.raw).toBe(card());
    expect(t.notices).toEqual([]);
  });

  it('stale note: the note changed while reviewing -> Notice and reopen with fresh data', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    const href = t.radicale.seed(card());
    t.setScript([
      (r) => {
        t.note.frontmatter.mobile = '06-3'; // the user types in the note meanwhile
        return preselected();
      },
      () => preselected(),
    ]);
    const result = await t.run();
    expect(t.notices[0]).toBe('Jan de Vries changed while reviewing');
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1].prepared.rows.find((r) => r.property === 'mobile')?.local).toBe('06-3');
    expect(result).toMatchObject({ kind: 'done', outcome: 'pushed' });
    expect(t.radicale.pushes).toHaveLength(1);
    expect(t.radicale.cards.get(href)!.raw).toContain('TEL;TYPE=CELL:06-3');
  });

  it('412: the card changed on the server meanwhile -> nothing written to the note, Notice, reopen', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    const href = t.radicale.seed(card());
    t.setScript([
      (r) => {
        t.radicale.put(href, card('06-1', ['EMAIL:jan@server.nl'])); // another client edits the card
        return preselected();
      },
      (r) => {
        expect(t.note.writes).toEqual([]);
        return preselected();
      },
    ]);
    const result = await t.run();
    expect(t.notices[0]).toBe('Jan de Vries changed on the server meanwhile');
    expect(t.radicale.pushes.map((p) => p.status)).toEqual([412, 204]);
    expect(t.requests[1].prepared.rows.find((r) => r.property === 'email')?.preselect).toBe('server');
    expect(result).toMatchObject({ kind: 'done', outcome: 'both' });
    expect(t.note.frontmatter.email).toBe('jan@server.nl');
  });

  it(`reopens at most ${MAX_REOPENS} times, then stops with a Notice`, async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    t.radicale.seed(card());
    let n = 0;
    t.setScript([
      (r) => {
        t.note.frontmatter.note = `typing ${++n}`;
        return preselected();
      },
    ]);
    const result = await t.run();
    expect(result).toEqual({ kind: 'gaveUp' });
    expect(t.requests).toHaveLength(MAX_REOPENS + 1);
    expect(t.notices.filter((m) => m === 'Jan de Vries changed while reviewing')).toHaveLength(MAX_REOPENS + 1);
    expect(t.notices[t.notices.length - 1]).toBe('Jan de Vries keeps changing; nothing was synced. Try again later.');
    expect(pushCount(t)).toBe(0);
    expect(t.note.writes).toEqual([]);
  });

  it('move re-validated at Apply: a card appeared in the target meanwhile -> stale, nothing written', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Family' } });
    const oldHref = t.radicale.seed(card());
    const oldBase = t.radicale.entries.get(UID);
    t.setScript([
      (r) => {
        t.family.put('/family/other-client.vcf', card('06-9')); // another device created it in Family
        return preselected();
      },
      () => ({ kind: 'cancel' }),
    ]);
    await t.run();
    expect(t.notices[0]).toBe('Jan de Vries changed on the server meanwhile');
    expect(pushCount(t)).toBe(0);
    expect(t.radicale.deletes).toEqual([]);
    expect(t.radicale.cards.get(oldHref)!.raw).toBe(card());
    expect(t.family.cards.get('/family/other-client.vcf')!.raw).toBe(card('06-9'));
    expect(t.radicale.entries.get(UID)).toEqual(oldBase);
    expect(t.family.entries.size).toBe(0);
    expect(t.note.writes).toEqual([]);
    // Fresh data: the card is in the named book now, so the second review is a plain sync there.
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1].moveLine).toBeUndefined();
  });

  it('move re-check that cannot search a book fails and writes nothing', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Family' } });
    const oldHref = t.radicale.seed(card());
    t.setScript([
      () => {
        t.family.options.searchFails = true;
        return preselected();
      },
    ]);
    expect(await t.run()).toEqual({ kind: 'failed', message: 'could not search Family (HTTP 503), and the card could be there' });
    expect(t.notices).toEqual(['Not syncing Jan de Vries: could not search Family (HTTP 503), and the card could be there.']);
    expect(t.requests).toHaveLength(1);
    expect(pushCount(t)).toBe(0);
    expect(t.radicale.cards.get(oldHref)!.raw).toBe(card());
    expect(t.note.writes).toEqual([]);
  });

  it('source: is written only after the card was written', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2' } });
    t.radicale.seed(card());
    t.radicale.options.failPut = 500;
    const result = await t.run();
    expect(result).toEqual({ kind: 'failed', message: 'HTTP 500' });
    expect(t.notices).toEqual(['Sync failed: HTTP 500']);
    expect(t.note.writes).toEqual([]);
    expect(t.note.frontmatter.source).toBeUndefined();

    t.radicale.options.failPut = undefined;
    await t.run();
    expect(t.note.frontmatter.source).toBe('Radicale');
  });

  it('Import from the review reopens it with fresh data', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    t.radicale.seed(card());
    t.setScript([() => ({ kind: 'reopen' }), () => preselected()]);
    expect(await t.run()).toMatchObject({ kind: 'done' });
    expect(t.requests).toHaveLength(2);
    expect(t.notices).toEqual(['Jan de Vries: sent to the server (Radicale).']);
  });

  it('settles the relation lookups after Apply', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    t.radicale.seed(card());
    await t.run();
    expect(t.settles).toEqual([1]);
  });
});

describe('syncFlow: the review request', () => {
  it('names the server column after the book the card is in: the target, or the book a move comes from', async () => {
    const sync = setup({ local: { ...JAN, mobile: '06-2', source: 'Family' } });
    sync.family.seed(card());
    sync.setScript([() => ({ kind: 'cancel' })]);
    await sync.run();
    expect(sync.requests[0].serverName).toBe('Family');

    const move = setup({ local: { ...JAN, mobile: '06-2', source: 'Family' } });
    move.radicale.seed(card());
    move.setScript([() => ({ kind: 'cancel' })]);
    await move.run();
    expect(move.requests[0].moveLine).toBe('Address book: Radicale -> Family');
    expect(move.requests[0].serverName).toBe('Radicale');

    const { uid: _uid, ...withoutUid } = JAN;
    const created = setup({ local: { ...withoutUid, source: 'Family' } });
    created.setScript([() => ({ kind: 'cancel' })]);
    await created.run();
    expect(created.requests[0].serverName).toBe('Family');
  });

  it('warns about address books whose contact list could not be read', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    t.radicale.seed(card());
    t.deps.contexts = async () => ({ ctx: noRelations, readOnlyCtx: noRelations, settle: async () => {}, unreadable: ['family'] });
    t.setScript([() => ({ kind: 'cancel' })]);
    await t.run();
    expect(t.requests[0].warnings).toEqual([
      'Could not read Family; relationships to people only in that address book may show as changed.',
    ]);
  });

  it('no warnings when every contact list loaded', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    t.radicale.seed(card());
    t.setScript([() => ({ kind: 'cancel' })]);
    await t.run();
    expect(t.requests[0].warnings).toEqual([]);
  });

  it('previews also changes and the rename while a conflict is still open', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    t.radicale.seed(card('06-3'), false); // no base: every difference is a conflict
    let also: string[] | undefined;
    let rename: ReturnType<ReviewRequest['rename']> = { to: 'x' };
    t.setScript([
      (r) => {
        expect(r.prepared.rows.find((row) => row.property === 'mobile')?.preselect).toBeUndefined();
        also = r.also(new Map());
        rename = r.rename(new Map());
        return { kind: 'cancel' };
      },
    ]);
    await t.run();
    expect(also).toEqual([]);
    expect(rename).toBeUndefined();
  });

  it('Apply with an undecided conflict is a bug: a Notice, and nothing is written', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    const href = t.radicale.seed(card('06-3'), false);
    t.setScript([() => preselected()]);
    const result = await t.run();
    expect(result).toMatchObject({ kind: 'failed' });
    expect(t.notices).toEqual([expect.stringMatching(/^Sync failed: .*conflict.*nothing was written/)]);
    expect(pushCount(t)).toBe(0);
    expect(t.note.writes).toEqual([]);
    expect(t.radicale.cards.get(href)!.raw).toBe(card('06-3'));
    expect(t.radicale.entries.size).toBe(0);
  });

  it('the note is read once per round: a change after the book was chosen is caught at Apply', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2' } });
    t.radicale.seed(card());
    const contexts = t.deps.contexts;
    let first = true;
    t.deps.contexts = async () => {
      // The user sets source: while the address books are being searched (after the book was chosen).
      if (first) t.note.frontmatter.source = 'Family';
      first = false;
      return contexts();
    };
    const result = await t.run();
    expect(t.notices[0]).toBe('Jan de Vries changed while reviewing');
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1].moveLine).toBe('Address book: Radicale -> Family');
    expect(result).toMatchObject({ kind: 'done', plan: { kind: 'move', to: 'family' } });
    expect(t.note.frontmatter.source).toBe('Family');
  });

  it('resolves only after a slow settle has finished', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    t.radicale.seed(card());
    let settled = false;
    t.deps.contexts = async () => ({
      ctx: noRelations,
      readOnlyCtx: noRelations,
      settle: () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve();
          }, 30),
        ),
    });
    const result = await t.run();
    expect(settled).toBe(true);
    expect(result).toMatchObject({ kind: 'done' });
  });
});

describe('syncFlow: old relationship lines on a 3.0 card', () => {
  const people: RelationContext = {
    uidToName: (uid) => (uid === 'sem-uid' ? 'Sem' : undefined),
    displayName: (uid) => (uid === 'sem-uid' ? 'Sem de Vries' : undefined),
    resolveLink: (name) => (name === 'Sem' ? { uid: 'sem-uid' } : { text: name }),
  };
  const legacy = (mobile = '06-1') =>
    card(mobile, ['RELATED;TYPE=child:urn:uuid:sem-uid']).replace('VERSION:4.0', 'VERSION:3.0');
  const local = { ...JAN, children: ['[[Sem]]'], source: 'Radicale' };

  it('the spec text', () => {
    expect(REWRITE_LINE).toBe('Relationships on this card are rewritten in the form phones understand.');
  });

  it('the only difference: not "Up to date"; the review has the info line and no changed rows; Apply rewrites', async () => {
    const t = setup({ local, ctx: people });
    const href = t.radicale.seed(legacy());
    expect(await t.run()).toMatchObject({ kind: 'done', outcome: 'pushed' });
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].rewriteLine).toBe(REWRITE_LINE);
    expect(t.requests[0].prepared.rows.filter((r) => r.changed)).toEqual([]);
    expect(t.notices).not.toContain('Up to date');
    const raw = t.radicale.cards.get(href)!.raw;
    expect(raw).toContain('item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries');
    expect(raw).toContain('item1.X-ABLabel:_$!<Child>!$_');
    expect(raw).not.toContain('urn:uuid:sem-uid');
    expect(raw).toContain('VERSION:3.0');
    expect(t.radicale.pushes[0].opts).toMatchObject({ href, ifMatch: expect.any(String) });
  });

  it('after Apply the next Sync is up to date and opens nothing', async () => {
    const t = setup({ local, ctx: people });
    t.radicale.seed(legacy());
    await t.run();
    t.requests.length = 0;
    expect(await t.run()).toMatchObject({ kind: 'upToDate' });
    expect(t.requests).toEqual([]);
  });

  it('with property rows too: one review with the line and the rows; Apply does both', async () => {
    const t = setup({ local: { ...local, mobile: '06-2' }, ctx: people });
    const href = t.radicale.seed(legacy());
    expect(await t.run()).toMatchObject({ kind: 'done', outcome: 'pushed' });
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0].rewriteLine).toBe(REWRITE_LINE);
    expect(t.requests[0].prepared.rows.filter((r) => r.changed).map((r) => r.property)).toEqual(['mobile']);
    const raw = t.radicale.cards.get(href)!.raw;
    expect(raw).toContain('TEL;TYPE=CELL:06-2');
    expect(raw).not.toContain('urn:uuid:sem-uid');
  });

  it('Cancel writes nothing', async () => {
    const t = setup({ local, ctx: people });
    const href = t.radicale.seed(legacy());
    const before = t.radicale.cards.get(href)!.raw;
    t.setScript([() => ({ kind: 'cancel' })]);
    expect(await t.run()).toMatchObject({ kind: 'cancelled' });
    expect(t.requests[0].rewriteLine).toBe(REWRITE_LINE);
    expect(pushCount(t)).toBe(0);
    expect(t.note.writes).toEqual([]);
    expect(t.radicale.cards.get(href)!.raw).toBe(before);
  });

  it('a 4.0 card with the text form has no rewrite line', async () => {
    const t = setup({ local: { ...JAN, children: ['[[Sem]]'], source: 'Radicale', mobile: '06-2' }, ctx: people });
    t.radicale.seed(card('06-1', ['RELATED;TYPE=child;VALUE=text;X-FRIENDLY-UID=sem-uid:Sem de Vries']));
    await t.run();
    expect(t.requests[0].rewriteLine).toBeUndefined();
  });

  it('a 4.0 card with a urn:uuid URI gets the rewrite line; Apply writes the name in place, and opens nothing after', async () => {
    const t = setup({ local: { ...JAN, children: ['[[Sem]]'], source: 'Radicale' }, ctx: people });
    const href = t.radicale.seed(card('06-1', ['RELATED;TYPE=child:urn:uuid:sem-uid']));
    expect(await t.run()).toMatchObject({ kind: 'done', outcome: 'pushed' });
    expect(t.requests[0].rewriteLine).toBe(REWRITE_LINE);
    const raw = t.radicale.cards.get(href)!.raw;
    expect(raw).toContain('RELATED;TYPE=child;VALUE=text;X-FRIENDLY-UID=sem-uid:Sem de Vries');
    expect(raw).not.toContain('urn:uuid:sem-uid');
    expect(raw).toContain('VERSION:4.0');
    t.requests.length = 0;
    expect(await t.run()).toMatchObject({ kind: 'upToDate' });
    expect(t.requests).toEqual([]);
  });

  it('a card moving between address books is rewritten too', async () => {
    const t = setup({ local: { ...local, source: 'Family' }, ctx: people });
    t.radicale.seed(legacy());
    expect(await t.run()).toMatchObject({ kind: 'done', plan: { kind: 'move' } });
    expect(t.requests[0].rewriteLine).toBe(REWRITE_LINE);
    expect([...t.family.cards.values()][0].raw).not.toContain('urn:uuid:sem-uid');
  });
});

describe('syncFlow: also changes and rename', () => {
  /** The card was renamed on the server (another device); the note still has the old names. */
  const renamedOnServer = (t: ReturnType<typeof setup>) => {
    const href = t.radicale.seed(card());
    t.radicale.put(href, card().replace('FN:Jan de Vries', 'FN:Jan Bakker').replace('N:de Vries;Jan;;;', 'N:Bakker;Jan;;;'));
  };

  it('offers the rename of the result and renames on Apply', async () => {
    const t = setup({ local: { ...JAN, source: 'Radicale' } });
    renamedOnServer(t);
    let offered: ReturnType<ReviewRequest['rename']>;
    let offeredLocal: ReturnType<ReviewRequest['rename']>;
    t.setScript([
      (r) => {
        offered = r.rename(new Map());
        offeredLocal = r.rename(allFrom(r, 'local'));
        return preselected();
      },
    ]);
    await t.run();
    expect(offered).toEqual({ to: 'Jan Bakker' });
    expect(offeredLocal).toBeUndefined();
    expect(t.note.renames).toEqual(['Jan Bakker']);
    expect(t.note.frontmatter.lastname).toBe('Bakker');
  });

  it('a note named after the new values by hand is not renamed', async () => {
    const t = setup({ local: { ...JAN, source: 'Radicale' } });
    t.deps.name = 'Jan Bakker';
    renamedOnServer(t);
    let offered: ReturnType<ReviewRequest['rename']> = { to: 'x' };
    t.setScript([
      (r) => {
        offered = r.rename(new Map());
        return preselected();
      },
    ]);
    await t.run();
    expect(offered).toBeUndefined();
    expect(t.note.renames).toEqual([]);
  });

  it('a taken name is offered blocked and never renamed', async () => {
    const t = setup({ local: { ...JAN, source: 'Radicale' } });
    renamedOnServer(t);
    t.taken.add('Jan Bakker');
    let offered: ReturnType<ReviewRequest['rename']>;
    t.setScript([
      (r) => {
        offered = r.rename(new Map());
        return preselected();
      },
    ]);
    await t.run();
    expect(offered).toEqual({ to: 'Jan Bakker', blocked: 'A note named "Jan Bakker" already exists in this folder.' });
    expect(t.note.renames).toEqual([]);
    expect(t.note.frontmatter.lastname).toBe('Bakker');
  });

  it('in folder layout the rename says folder and note, and why it is blocked', async () => {
    const t = setup({ local: { ...JAN, source: 'Radicale' } });
    t.deps.renamesFolder = true;
    renamedOnServer(t);
    const offered: ReturnType<ReviewRequest['rename']>[] = [];
    t.setScript([
      (r) => {
        offered.push(r.rename(new Map()));
        t.deps.renameBlocked = () => 'Contacts/Jan holds other contacts (Sem); rename it by hand.';
        offered.push(r.rename(new Map()));
        return { kind: 'cancel' };
      },
    ]);
    await t.run();
    expect(offered).toEqual([
      { to: 'Jan Bakker', folder: true },
      { to: 'Jan Bakker', folder: true, blocked: 'Contacts/Jan holds other contacts (Sem); rename it by hand.' },
    ]);
  });

  it('local name edit with a base offers the rename', async () => {
    const t = setup({ local: { ...JAN, lastname: 'Bakker', name: 'Jan Bakker', source: 'Radicale' } });
    t.radicale.seed(card());
    let offered: ReturnType<ReviewRequest['rename']>;
    t.setScript([
      (r) => {
        offered = r.rename(new Map());
        return preselected();
      },
    ]);
    await t.run();
    expect(offered).toEqual({ to: 'Jan Bakker' });
    expect(t.note.renames).toEqual(['Jan Bakker']);
  });

  it('hand-renamed note with a base and unchanged names does not', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    t.deps.name = 'Jantje';
    t.radicale.seed(card());
    let offered: ReturnType<ReviewRequest['rename']> = { to: 'x' };
    t.setScript([
      (r) => {
        offered = r.rename(new Map());
        return preselected();
      },
    ]);
    expect(await t.run()).toMatchObject({ kind: 'done', outcome: 'pushed' });
    expect(offered).toBeUndefined();
    expect(t.note.renames).toEqual([]);
  });

  it('no base compares with the note\'s values', async () => {
    const t = setup({ local: { ...JAN, mobile: '06-2', source: 'Radicale' } });
    t.deps.name = 'Jantje';
    const href = t.radicale.seed(card(), false);
    t.radicale.put(href, card().replace('FN:Jan de Vries', 'FN:Jan Bakker').replace('N:de Vries;Jan;;;', 'N:Bakker;Jan;;;'));
    let fromServer: ReturnType<ReviewRequest['rename']>;
    let fromNote: ReturnType<ReviewRequest['rename']> = { to: 'x' };
    t.setScript([
      (r) => {
        fromServer = r.rename(allFrom(r, 'server'));
        fromNote = r.rename(allFrom(r, 'local'));
        return { kind: 'cancel' };
      },
    ]);
    await t.run();
    expect(fromServer).toEqual({ to: 'Jan Bakker' });
    expect(fromNote).toBeUndefined();
  });

  it('unchecked rename keeps the file name', async () => {
    const t = setup({ local: { ...JAN, source: 'Radicale' } });
    renamedOnServer(t);
    t.setScript([() => ({ kind: 'apply', choices: new Map(), rename: false })]);
    await t.run();
    expect(t.note.renames).toEqual([]);
    expect(t.note.frontmatter.lastname).toBe('Bakker');
  });

  it('also changes follow the chosen result', async () => {
    const t = setup({ local: { ...JAN, children: ['[[Sem]]'], source: 'Radicale' } });
    t.radicale.seed(card(), false);
    t.deps.mirror = {
      resolveLink: (link) => (link === 'Sem' ? 'People/Sem.md' : undefined),
      snapshotOf: (path) => (path === 'People/Sem.md' ? { parents: ['People/Jan de Vries.md'] } : undefined),
      nameOf: (path) => path.split('/').pop()!.replace(/\.md$/, ''),
    };
    let fromObsidian: string[] = [];
    let fromRadicale: string[] = [];
    t.setScript([
      (r) => {
        fromObsidian = r.also(allFrom(r, 'local'));
        fromRadicale = r.also(allFrom(r, 'server'));
        return { kind: 'cancel' };
      },
    ]);
    await t.run();
    expect(fromObsidian).toEqual([]);
    expect(fromRadicale).toEqual(['Sem: parents loses [[Jan de Vries]]']);
  });

  it('no mirroring on this device: no also changes', async () => {
    const t = setup({ local: { ...JAN, children: ['[[Sem]]'], source: 'Radicale' } });
    t.radicale.seed(card(), false);
    let also: string[] = ['x'];
    t.setScript([
      (r) => {
        also = r.also(allFrom(r, 'server'));
        return { kind: 'cancel' };
      },
    ]);
    await t.run();
    expect(also).toEqual([]);
  });
});
