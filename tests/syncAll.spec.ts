import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { RelationContext } from 'src/contacts/friendly/relations';
import { FriendlyValue } from 'src/contacts/friendly/translate';
import { ReviewRow } from 'src/sync/review';
import { badgesOf, CHANGED_SINCE_SCAN, listedAdapter, sameReview, SyncAll, SyncAllDeps } from 'src/sync/syncAll';
import { prepareRound, REWRITE_LINE, ReviewRequest, SyncFlowDeps } from 'src/sync/syncFlow';
import { PreparedSync } from 'src/sync/syncContact';
import { Book, card, fakeBook, JAN, UID } from 'tests/fakes/syncBooks';
import { describe, expect, it, vi } from 'vitest';

const row = (property: string, preselect: ReviewRow['preselect'], changed = true): ReviewRow => ({
  property,
  server: 's',
  local: 'l',
  preselect,
  kind: 'text',
  changed,
});

/** A review request with just what `badgesOf` reads. */
function request(opts: { server?: boolean; rows?: ReviewRow[]; prepared?: Partial<PreparedSync>; extra?: Partial<ReviewRequest> } = {}): ReviewRequest {
  const prepared = {
    rows: opts.rows ?? [],
    rewriteRelations: false,
    rewriteLinks: false,
    damagedNotePhoto: false,
    server: opts.server === false ? undefined : ({} as PreparedSync['server']),
    ...opts.prepared,
  } as PreparedSync;
  return { title: 'Jan de Vries', serverName: 'Radicale', warnings: [], prepared, also: () => [], rename: () => undefined, ...opts.extra };
}

describe('badgesOf', () => {
  it('a new card is only newCard', () => {
    expect(badgesOf(request({ server: false, rows: [row('mobile', 'local')] }))).toEqual(['newCard']);
  });

  it('a conflict plus a row preselected from the server: conflict, server', () => {
    expect(badgesOf(request({ rows: [row('mobile', 'server'), row('email', undefined), row('name', 'local', false)] }))).toEqual([
      'conflict',
      'server',
    ]);
  });

  it('only a rewrite line: obsidian', () => {
    expect(badgesOf(request({ prepared: { rewriteRelations: true }, extra: { rewriteLine: REWRITE_LINE } }))).toEqual(['obsidian']);
  });

  it('only a damaged photo in the note: server', () => {
    expect(badgesOf(request({ prepared: { damagedNotePhoto: true } }))).toEqual(['server']);
  });

  it('a move or a row preselected from the note: obsidian', () => {
    expect(badgesOf(request({ extra: { moveLine: 'Address book: Radicale -> Family' } }))).toEqual(['obsidian']);
    expect(badgesOf(request({ rows: [row('mobile', 'local')] }))).toEqual(['obsidian']);
  });
});

describe('listedAdapter', () => {
  it('answers every lookup from one listing', async () => {
    const book = fakeBook('radicale', 'Radicale');
    const href = book.seed(card());
    const listed = listedAdapter(book.adapter);
    expect(await listed.getMetaByUid(UID)).toMatchObject({ href, uid: UID });
    expect(await listed.getMetaByUid(`urn:uuid:${UID}`)).toMatchObject({ href });
    expect(await listed.getMetaByUid('someone-else')).toBeUndefined();
    expect(book.calls).toEqual({ getMetaList: 1, getMetaByUid: 0 });
  });

  it('a listing that fails is that error for every lookup', async () => {
    const book = fakeBook('radicale', 'Radicale');
    book.seed(card());
    book.options.listFails = true;
    const listed = listedAdapter(book.adapter);
    expect(await listed.getMetaByUid(UID)).toMatchObject({ status: 503, errorMessage: 'HTTP 503' });
    expect(await listed.getMetaByUid(UID)).toMatchObject({ status: 503 });
    expect(book.calls).toEqual({ getMetaList: 1, getMetaByUid: 0 });
  });

  it('an empty uid finds nothing, and a card without a uid is never found', async () => {
    const book = fakeBook('radicale', 'Radicale');
    const href = book.seed(card());
    const listed = listedAdapter({
      ...book.adapter,
      getMetaList: async () => [{ href: '/radicale/no-uid.vcf', etag: 'e', lastModified: new Date(), uid: undefined, fn: undefined, n: undefined }],
    });
    expect(await listed.getMetaByUid('')).toBeUndefined();
    expect(await listed.getMetaByUid('  urn:uuid: ')).toBeUndefined();
    expect(href).toBeDefined();
  });

  it('passes the other methods through', async () => {
    const book = fakeBook('radicale', 'Radicale');
    const href = book.seed(card());
    const listed = listedAdapter(book.adapter);
    expect(await listed.pull(href)).toMatchObject({ href, raw: card() });
    expect(await listed.getMetaList()).toHaveLength(1);
    expect(book.calls.getMetaList).toBe(1);
  });
});

const PIET_UID = '1234ABCD-0000-4000-8000-000000000002';
const PIET = { name: 'Piet Jansen', firstname: 'Piet', lastname: 'Jansen', mobile: '06-9', uid: PIET_UID };
const pietCard = (mobile = '06-9') =>
  ['BEGIN:VCARD', 'VERSION:4.0', `UID:${PIET_UID}`, 'FN:Piet Jansen', 'N:Jansen;Piet;;;', `TEL;TYPE=CELL:${mobile}`, 'END:VCARD', ''].join(
    '\r\n',
  );

const noRelations: RelationContext = {
  uidToName: () => undefined,
  displayName: () => undefined,
  resolveLink: (name) => ({ text: name }),
};

const CONVERT = 'Kees Bakker still has vCard properties; run Convert first';

/** Four notes over one book: Jan changed on the server, Piet up to date, Nieuw without card, Kees needing Convert. */
function setup(opts: { books?: Book[] } = {}) {
  const radicale = fakeBook('radicale', 'Radicale');
  const books = opts.books ?? [radicale];
  const notes: Record<string, { name: string; frontmatter: Record<string, unknown> }> = {
    'People/Jan de Vries.md': { name: 'Jan de Vries', frontmatter: { ...JAN } },
    'People/Piet Jansen.md': { name: 'Piet Jansen', frontmatter: { ...PIET } },
    'People/Nieuw.md': { name: 'Nieuw', frontmatter: { name: 'Nieuw', mobile: '06-5' } },
    'People/Kees Bakker.md': { name: 'Kees Bakker', frontmatter: { FN: 'Kees Bakker' } },
  };
  const writes: string[] = [];
  const reviews: string[] = [];
  const locks = { taken: 0, released: 0 };
  const deps: SyncAllDeps = {
    notes: () => Object.entries(notes).map(([path, { name }]) => ({ path, name })),
    flowDeps: async (path, over) => {
      const { name, frontmatter } = notes[path];
      if ('FN' in frontmatter) return { refused: CONVERT };
      const flow: SyncFlowDeps = {
        note: {
          readFrontmatter: async () => ({ ...frontmatter }),
          writeProps: async (set: Record<string, FriendlyValue>, remove: string[]) => {
            writes.push(`${path} ${Object.keys(set).join(',')}`);
            Object.assign(frontmatter, set);
            for (const key of remove) delete frontmatter[key];
          },
          rename: async (to) => {
            writes.push(`${path} -> ${to}`);
            return 'renamed';
          },
        },
        path,
        name,
        rows: DEFAULT_MAPPING,
        sources: books.map((b) => b.source),
        active: books.map((b) => b.source),
        defaultSource: books[0].id,
        adapterFor: (source) => books.find((b) => b.id === source.id)!.adapter,
        stateFor: (id) => books.find((b) => b.id === id)!.state,
        contexts: async () => ({ ctx: noRelations, readOnlyCtx: noRelations, settle: async () => {} }),
        review: async () => {
          reviews.push(path);
          return { kind: 'cancel' };
        },
        notify: over.notify,
        renameBlocked: () => undefined,
      };
      return flow;
    },
    lock: () => {
      locks.taken++;
      let released = false;
      return () => {
        if (!released) locks.released++;
        released = true;
      };
    },
  };
  radicale.seed(card('06-2'), false);
  radicale.entries.set(UID, { raw: card(), etag: 'old', href: `/radicale/${UID}.vcf` });
  radicale.seed(pietCard(), true, PIET_UID);
  return { radicale, books, notes, writes, reviews, locks, deps };
}

const kinds = (all: SyncAll) => all.state.items.map((i) => [i.name, i.kind]);

describe('SyncAll.scan', () => {
  it('lists every note by name with what a Sync would do, and writes nothing', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    expect(kinds(all)).toEqual([
      ['Jan de Vries', 'review'],
      ['Kees Bakker', 'blocked'],
      ['Nieuw', 'review'],
      ['Piet Jansen', 'upToDate'],
    ]);
    const [jan, kees, nieuw] = all.state.items;
    expect(jan).toMatchObject({ kind: 'review', badges: ['server'], rename: true });
    expect(jan.kind === 'review' && jan.choices.size).toBe(0);
    expect(jan.kind === 'review' && jan.request.prepared.rows.find((r) => r.changed)?.property).toBe('mobile');
    expect(kees).toEqual({ path: 'People/Kees Bakker.md', name: 'Kees Bakker', kind: 'blocked', reason: CONVERT });
    expect(nieuw).toMatchObject({ kind: 'review', badges: ['newCard'] });
    expect(all.state).toMatchObject({ scanned: 4, total: 4 });
    expect(all.state.busy).toBeUndefined();
    expect(t.radicale.pushes).toEqual([]);
    expect(t.writes).toEqual([]);
    expect(t.reviews).toEqual([]);
  });

  it('lists each book once for the whole scan', async () => {
    const t = setup();
    await new SyncAll(t.deps).scan();
    expect(t.radicale.calls).toEqual({ getMetaList: 1, getMetaByUid: 0 });
  });

  it('a rescan reads a fresh listing', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    t.radicale.seed(card(), true);
    await all.scan();
    expect(t.radicale.calls.getMetaList).toBe(2);
    expect(kinds(all)).toContainEqual(['Jan de Vries', 'upToDate']);
  });

  it('a book that cannot be listed blocks a note with a UID instead of offering a new card', async () => {
    const t = setup();
    t.radicale.options.listFails = true;
    const all = new SyncAll(t.deps);
    await all.scan();
    const jan = all.state.items.find((i) => i.name === 'Jan de Vries')!;
    expect(jan.kind).toBe('blocked');
    expect(jan.kind === 'blocked' && jan.reason).toMatch(/^could not search/);
    expect(jan.kind === 'blocked' && jan.reason).toBe('could not search Radicale (HTTP 503), and the card could be there');
  });

  it('a note whose Sync is open, or whose deps throw, is blocked; every lock taken is released', async () => {
    const t = setup();
    const { lock, flowDeps } = t.deps;
    t.deps.lock = (path) => (path === 'People/Jan de Vries.md' ? undefined : lock(path));
    t.deps.flowDeps = async (path, over) => {
      if (path === 'People/Piet Jansen.md') throw new Error('the vault is gone');
      return flowDeps(path, over);
    };
    const all = new SyncAll(t.deps);
    await all.scan();
    expect(all.state.items.find((i) => i.name === 'Jan de Vries')).toMatchObject({
      kind: 'blocked',
      reason: 'A Sync of this contact is already open.',
    });
    expect(all.state.items.find((i) => i.name === 'Piet Jansen')).toMatchObject({ kind: 'blocked', reason: 'the vault is gone' });
    expect(t.locks).toEqual({ taken: 3, released: 3 });
    expect(all.state).toMatchObject({ scanned: 4, total: 4 });
  });

  it('collects the notices of a note on its row', async () => {
    const t = setup();
    const { flowDeps } = t.deps;
    t.deps.flowDeps = async (path, over) => {
      const flow = await flowDeps(path, over);
      if ('refused' in flow || path !== 'People/Jan de Vries.md') return flow;
      return { ...flow, contexts: async () => (over.notify('Could not give Piet a UID.'), flow.contexts()) };
    };
    const all = new SyncAll(t.deps);
    await all.scan();
    expect(all.state.items[0]).toMatchObject({ name: 'Jan de Vries', kind: 'review', messages: ['Could not give Piet a UID.'] });
  });

  it('a new state object on every change, a listener call per result, and no second scan while one runs', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    const seen: unknown[] = [];
    const stop = all.subscribe(() => seen.push(all.state));
    const first = all.scan();
    expect(all.state).toMatchObject({ busy: 'scan', total: 4, scanned: 0 });
    await all.scan();
    await first;
    stop();
    // start, four results, done
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    // a new list at the start and per result; the end only clears `busy`
    expect(new Set(seen.map((s) => (s as { items: unknown }).items)).size).toBe(5);
    expect(t.radicale.calls.getMetaList).toBe(1);
  });

  it('prepares at most `concurrency` notes at once', async () => {
    const t = setup();
    const { flowDeps } = t.deps;
    let open = 0;
    let most = 0;
    t.deps.concurrency = 2;
    t.deps.flowDeps = async (path, over) => {
      open++;
      most = Math.max(most, open);
      await new Promise((resolve) => setTimeout(resolve, 5));
      open--;
      return flowDeps(path, over);
    };
    await new SyncAll(t.deps).scan();
    expect(most).toBe(2);
  });
});

describe('SyncAll listeners', () => {
  it('a listener that throws does not break a scan', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    all.subscribe(() => {
      calls++;
      throw new Error('render failed');
    });
    await all.scan();
    expect(all.state).toMatchObject({ scanned: 4, total: 4 });
    expect(all.state.busy).toBeUndefined();
    expect(calls).toBe(6);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

const JAN_PATH = 'People/Jan de Vries.md';
const PIET_PATH = 'People/Piet Jansen.md';
const NIEUW_PATH = 'People/Nieuw.md';
const ANNA_PATH = 'People/Anna Smit.md';
const ANNA_UID = '1234ABCD-0000-4000-8000-000000000003';
const annaCard = (mobile: string) =>
  ['BEGIN:VCARD', 'VERSION:4.0', `UID:${ANNA_UID}`, 'FN:Anna Smit', 'N:Smit;Anna;;;', `TEL;TYPE=CELL:${mobile}`, 'END:VCARD', ''].join('\r\n');

const itemOf = (all: SyncAll, path: string) => all.state.items.find((i) => i.path === path)!;

/** The flow deps of the setup, for preparing a note directly. */
async function flowOf(t: ReturnType<typeof setup>, path: string): Promise<SyncFlowDeps> {
  const deps = await t.deps.flowDeps(path, { notify: () => {} });
  if ('refused' in deps) throw new Error(deps.refused);
  return deps;
}

async function requestOf(t: ReturnType<typeof setup>, path: string): Promise<ReviewRequest> {
  const round = await prepareRound(await flowOf(t, path));
  if (round.kind !== 'review') throw new Error(`no review for ${path}`);
  await round.discard();
  return round.request;
}

describe('sameReview', () => {
  it('two prepares of an unchanged note are the same, also for a new card', async () => {
    const t = setup();
    expect(sameReview(await requestOf(t, JAN_PATH), await requestOf(t, JAN_PATH))).toBe(true);
    expect(sameReview(await requestOf(t, NIEUW_PATH), await requestOf(t, NIEUW_PATH))).toBe(true);
  });

  it('differs after the note changes', async () => {
    const t = setup();
    const before = await requestOf(t, JAN_PATH);
    t.notes[JAN_PATH].frontmatter.mobile = '06-7';
    expect(sameReview(before, await requestOf(t, JAN_PATH))).toBe(false);
  });
});

describe('SyncAll.apply', () => {
  it('applies the preselections: the note gets the server value, the item is done with the outcome Notice', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    await all.apply(JAN_PATH);
    expect(t.notes[JAN_PATH].frontmatter.mobile).toBe('06-2');
    const jan = itemOf(all, JAN_PATH);
    expect(jan.kind).toBe('done');
    expect(jan.kind === 'done' && jan.messages).toContain('Jan de Vries: updated from the server.');
    expect(t.locks.taken).toBe(t.locks.released);
    expect(all.state.busy).toBeUndefined();
  });

  it('applies the choices made: the server keeps the note value', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    all.setChoices(JAN_PATH, new Map([['mobile', 'local']]));
    await all.apply(JAN_PATH);
    expect(t.notes[JAN_PATH].frontmatter.mobile).toBe('06-1');
    expect(t.radicale.cards.get(`/radicale/${UID}.vcf`)!.raw).toContain('TEL;TYPE=CELL:06-1');
    expect(itemOf(all, JAN_PATH).kind).toBe('done');
  });

  it('a note edited after the scan is shown again with fresh data, choices reset; nothing written', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    all.setChoices(JAN_PATH, new Map([['mobile', 'server']]));
    all.setRename(JAN_PATH, false);
    t.notes[JAN_PATH].frontmatter.mobile = '06-7';
    await all.apply(JAN_PATH);
    const jan = itemOf(all, JAN_PATH);
    expect(jan.kind).toBe('review');
    if (jan.kind !== 'review') return;
    expect(jan.messages).toContain(CHANGED_SINCE_SCAN);
    expect(jan.choices.size).toBe(0);
    expect(jan.rename).toBe(true);
    expect(jan.request.prepared.rows.find((r) => r.property === 'mobile')).toMatchObject({ local: '06-7' });
    expect(t.radicale.pushes).toEqual([]);
    expect(t.writes).toEqual([]);
  });

  it('a card changed on the server after the scan is shown again; nothing written', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    t.radicale.put(`/radicale/${UID}.vcf`, card('06-3'));
    await all.apply(JAN_PATH);
    const jan = itemOf(all, JAN_PATH);
    expect(jan.kind === 'review' && jan.messages).toContain(CHANGED_SINCE_SCAN);
    expect(jan.kind === 'review' && jan.request.prepared.server?.raw).toContain('06-3');
    expect(t.radicale.pushes).toEqual([]);
    expect(t.writes).toEqual([]);
  });

  it('a note that changes between the check and the write is prepared again', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    const { flowDeps } = t.deps;
    t.deps.flowDeps = async (path, over) => {
      const flow = await flowDeps(path, over);
      if ('refused' in flow) return flow;
      const read = flow.note.readFrontmatter;
      let reads = 0;
      const readFrontmatter = async () => {
        const fm = await read();
        if (++reads === 1) t.notes[JAN_PATH].frontmatter.mobile = '06-7';
        return fm;
      };
      t.deps.flowDeps = flowDeps;
      return { ...flow, note: { ...flow.note, readFrontmatter } };
    };
    await all.apply(JAN_PATH);
    const jan = itemOf(all, JAN_PATH);
    expect(jan.kind === 'review' && jan.messages).toContain(CHANGED_SINCE_SCAN);
    expect(jan.kind === 'review' && jan.request.prepared.rows.find((r) => r.property === 'mobile')?.local).toBe('06-7');
    expect(t.writes).toEqual([]);
    expect(t.locks.taken).toBe(t.locks.released);
  });

  it('a note already in sync becomes done', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    t.notes[JAN_PATH].frontmatter.mobile = '06-2';
    t.radicale.entries.set(UID, { raw: card('06-2'), etag: t.radicale.cards.get(`/radicale/${UID}.vcf`)!.etag, href: `/radicale/${UID}.vcf` });
    await all.apply(JAN_PATH);
    expect(itemOf(all, JAN_PATH)).toMatchObject({ kind: 'done', messages: ['Already in sync.'] });
  });

  it('a prepare that throws blocks the item and releases the lock', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    const { flowDeps } = t.deps;
    t.deps.flowDeps = async (path, over) => {
      const flow = await flowDeps(path, over);
      if ('refused' in flow) return flow;
      return {
        ...flow,
        contexts: async () => {
          throw new Error('lookups failed');
        },
      };
    };
    await all.apply(JAN_PATH);
    expect(itemOf(all, JAN_PATH)).toMatchObject({ kind: 'blocked', reason: 'lookups failed' });
    expect(t.locks.taken).toBe(t.locks.released);
  });

  it('a note whose Sync is open keeps its item with a message', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    t.deps.lock = () => undefined;
    await all.apply(JAN_PATH);
    const jan = itemOf(all, JAN_PATH);
    expect(jan.kind === 'review' && jan.messages).toContain('A Sync of this contact is already open.');
    expect(t.writes).toEqual([]);
  });

  it('a new card applied on its own is created and done', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    const cards = t.radicale.cards.size;
    await all.apply(NIEUW_PATH);
    expect(itemOf(all, NIEUW_PATH)).toMatchObject({ kind: 'done', messages: ['Nieuw: created on the server.'] });
    expect(t.radicale.cards.size).toBe(cards + 1);
  });

  it('is busy while it runs; a scan then does nothing', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    const applying = all.apply(JAN_PATH);
    expect(all.state.busy).toBe('apply');
    await all.scan();
    await all.apply(JAN_PATH);
    expect(all.state.busy).toBe('apply');
    await applying;
    expect(all.state.busy).toBeUndefined();
    expect(t.radicale.calls.getMetaList).toBe(1);
    expect(itemOf(all, JAN_PATH).kind).toBe('done');
  });
});

describe('SyncAll.refresh', () => {
  it('prepares the note again and replaces its item', async () => {
    const t = setup();
    const all = new SyncAll(t.deps);
    await all.scan();
    all.setChoices(JAN_PATH, new Map([['mobile', 'local']]));
    t.radicale.put(`/radicale/${UID}.vcf`, card('06-3'));
    await all.refresh(JAN_PATH);
    const jan = itemOf(all, JAN_PATH);
    expect(jan.kind).toBe('review');
    if (jan.kind !== 'review') return;
    expect(jan.request.prepared.server?.raw).toContain('06-3');
    expect(jan.choices.size).toBe(0);
    expect(jan.messages).not.toContain(CHANGED_SINCE_SCAN);
    expect(t.writes).toEqual([]);
  });
});

describe('SyncAll.applyAllReady', () => {
  it('applies only the contacts that are ready, one after another', async () => {
    const t = setup();
    t.notes[ANNA_PATH] = {
      name: 'Anna Smit',
      frontmatter: { name: 'Anna Smit', firstname: 'Anna', lastname: 'Smit', mobile: '06-A1', uid: ANNA_UID },
    };
    t.radicale.seed(annaCard('06-A0'), true, ANNA_UID);
    t.radicale.put(`/radicale/${ANNA_UID}.vcf`, annaCard('06-A2'));
    t.radicale.put(`/radicale/${PIET_UID}.vcf`, pietCard('06-8'));
    const all = new SyncAll(t.deps);
    await all.scan();
    expect(itemOf(all, ANNA_PATH)).toMatchObject({ kind: 'review', badges: ['conflict'] });
    expect(all.readyPaths()).toEqual([JAN_PATH, PIET_PATH]);
    t.notes[PIET_PATH].frontmatter.mobile = '06-7';
    const cards = t.radicale.cards.size;
    expect(await all.applyAllReady()).toEqual({ applied: 1, changed: 1, failed: 0 });
    expect(itemOf(all, JAN_PATH).kind).toBe('done');
    const piet = itemOf(all, PIET_PATH);
    expect(piet.kind === 'review' && piet.messages).toContain(CHANGED_SINCE_SCAN);
    expect(itemOf(all, ANNA_PATH).kind).toBe('review');
    expect(itemOf(all, NIEUW_PATH).kind).toBe('review');
    expect(t.radicale.cards.size).toBe(cards);
    expect(all.state.busy).toBeUndefined();
  });
});
