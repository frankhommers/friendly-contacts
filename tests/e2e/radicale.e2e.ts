/**
 * End-to-end: the real Sync (syncFlow -> prepareSync/applySync + CardDAV adapter + PlatformHttpClient) against a real
 * Radicale 3.8.3 started by this suite. Run with `npm run test:e2e`; see tests/scripts/radicale-e2e.md.
 *
 * The note side is in memory (frontmatter + body); the server card is checked with plain HTTP GETs,
 * the way `curl` would show it.
 */

import { ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseCard } from 'src/contacts/friendly/lines';
import { convertFrontmatter } from 'src/contacts/convertNotes';
import { insertLabelledDateRow, labelledDateRow, planDateFill } from 'src/contacts/friendly/dateLabels';
import { DEFAULT_MAPPING, isMappedProperty, MappingRow, syncRows } from 'src/contacts/friendly/mapping';
import { NoteLinkOptions, noteLinkUrl } from 'src/contacts/friendly/noteLinks';
import { RelationContext, resolveRemoteName } from 'src/contacts/friendly/relations';
import { CURRENT_READER, FriendlyValue, readerOf, toFriendly } from 'src/contacts/friendly/translate';
import { contactFileName, renderFriendlyNote } from 'src/contacts/friendlyNotes';
import { initSettings } from 'src/context/sharedSettingsContext';
import type { Source } from 'src/settings/settings.d';
import { encodeBasicAuth } from 'src/settings/carddavCredentials';
import { VCardMeta } from 'src/sync/adapters/adapter';
import { AdapterInterface } from 'src/sync/adapters/adapterInterface';
import { carddavAdapter } from 'src/sync/adapters/carddavGeneric';
import { moveCard } from 'src/sync/moveCard';
import { canApply, Choice } from 'src/sync/review';
import { importCandidates, newCardVersion, SyncPlan } from 'src/sync/sources';
import { NoteIO, SyncOutcome } from 'src/sync/syncContact';
import { FlowResult, LINKS_LINE, syncFlow, SyncFlowDeps } from 'src/sync/syncFlow';
import { CHANGED_SINCE_SCAN, SyncAll } from 'src/sync/syncAll';
import { createSyncState, FileStore, SyncState } from 'src/sync/syncState';
import { cleanUid } from 'src/util/vcard';
import { readVcfFixture } from 'tests/fixtures/fixtures';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { chromiumLikeDomParser } from './chromiumDomParser';

const PYTHON = process.env.RADICALE_PYTHON || '/tmp/radtest/v/bin/python';
const HAS_PYTHON = existsSync(PYTHON);
if (!HAS_PYTHON) {
  process.stderr.write(`Radicale e2e skipped: no python at ${PYTHON}. Set RADICALE_PYTHON to a python with radicale 3.8.3 installed.\n`);
}

const BOOK = '/frank/contacts/';
const FAMILY = '/frank/family/';
const JAN_HREF = `${BOOK}ABC-DEF.vcf`;
const JAN_UID = '1234ABCD-0000-4000-8000-000000000001';
const SEM_UID = '5E4A0000-0000-4000-8000-000000000002';
const SEM_CARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:de Vries;Sem;;;',
  'FN:Sem de Vries',
  `UID:${SEM_UID}`,
  'END:VCARD',
  '',
].join('\r\n');

let radicale: ChildProcess | undefined;
let radicaleLog = '';
let workDir = '';
let port = 0;

// --- the server, seen directly (like curl), not through the plugin ---

function request(method: string, path: string, body?: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; data: string; etag?: string }>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Authorization: `Basic ${encodeBasicAuth('frank', 'x')}`,
          ...headers,
          ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, data, etag: res.headers.etag }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function serverCard(href: string): Promise<string> {
  const res = await request('GET', href);
  expect(res.status, `GET ${href}`).toBe(200);
  return res.data;
}

async function serverEtag(href: string): Promise<string | undefined> {
  return (await request('GET', href)).etag;
}

async function putCard(href: string, raw: string): Promise<void> {
  const res = await request('PUT', href, raw, { 'Content-Type': 'text/vcard; charset=utf-8' });
  expect([201, 204], `PUT ${href}`).toContain(res.status);
}

/** The card's lines after unfolding (folding and line endings are not content). */
const unfolded = (raw: string): string[] =>
  raw
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((l) => l !== '');

/** Lines of `a` that are not in `b`, counting duplicates. */
function minus(a: string[], b: string[]): string[] {
  const rest = [...b];
  return a.filter((line) => {
    const i = rest.indexOf(line);
    if (i < 0) return true;
    rest.splice(i, 1);
    return false;
  });
}

const isRev = (line: string) => /^REV[:;]/i.test(line);

// --- Radicale lifecycle ---

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const found = (server.address() as AddressInfo).port;
  await new Promise((resolve) => server.close(resolve));
  return found;
}

async function startRadicale(): Promise<void> {
  workDir = mkdtempSync(join(tmpdir(), 'radicale-e2e-'));
  port = await freePort();
  const config = join(workDir, 'config');
  writeFileSync(
    config,
    [
      '[server]',
      `hosts = 127.0.0.1:${port}`,
      '[auth]',
      'type = none',
      '[storage]',
      `filesystem_folder = ${join(workDir, 'collections')}`,
      '[logging]',
      'level = warning',
      '',
    ].join('\n'),
  );
  radicale = spawn(PYTHON, ['-m', 'radicale', '--config', config], { stdio: ['ignore', 'pipe', 'pipe'] });
  radicale.stdout?.on('data', (d) => (radicaleLog += String(d)));
  radicale.stderr?.on('data', (d) => (radicaleLog += String(d)));

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (radicale.exitCode !== null) throw new Error(`Radicale exited (${radicale.exitCode}):\n${radicaleLog}`);
    try {
      await request('OPTIONS', '/');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Radicale did not answer on port ${port}:\n${radicaleLog}`);
}

async function createAddressBook(book = BOOK): Promise<void> {
  const res = await request(
    'MKCOL',
    book,
    `<?xml version="1.0" encoding="utf-8"?>
<D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:set><D:prop><D:resourcetype><D:collection/><C:addressbook/></D:resourcetype></D:prop></D:set>
</D:mkcol>`,
    { 'Content-Type': 'application/xml; charset=utf-8' },
  );
  expect(res.status, `MKCOL ${book}: ${res.data}`).toBe(201);
}

// --- the plugin side: in-memory note, base store and relation lookups ---

interface Note {
  frontmatter: Record<string, unknown>;
  body: string;
  io: NoteIO;
}

function memoryNote(frontmatter: Record<string, unknown>, body = 'Private: SECRET-BODY-TEXT'): Note {
  const note: Note = {
    frontmatter: { ...frontmatter },
    body,
    io: {
      readFrontmatter: async () => ({ ...note.frontmatter }),
      writeProps: async (set: Record<string, FriendlyValue>, remove: string[]) => {
        for (const key of remove) delete note.frontmatter[key];
        Object.assign(note.frontmatter, set);
      },
      rename: async () => 'renamed' as const,
    },
  };
  return note;
}

function memoryFileStore(): FileStore {
  const files = new Map<string, string>();
  return {
    read: async (path) => files.get(path),
    write: async (path, data) => void files.set(path, data),
    remove: async (path) => void files.delete(path),
    list: async (dir) => [...files.keys()].filter((path) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')),
    rename: async () => {},
  };
}

/** An address book as the plugin sees it: its source, the adapter bound to it and its own sync-state dir. */
interface Book {
  source: Source;
  adapter: AdapterInterface;
  state: SyncState;
}

/** Notes in the "vault" (link name + uid); unknown names and UIDs fall back to the server's contact list. */
async function relationContext(
  adapter: AdapterInterface,
  notes: { name: string; uid: string }[],
  paths: Map<string, string>,
): Promise<RelationContext> {
  const metas = await adapter.getMetaList();
  const remote = (Array.isArray(metas) ? metas : []).flatMap((meta: VCardMeta) => {
    const fileName = contactFileName(meta.n, meta.fn);
    return meta.uid && fileName ? [{ uid: cleanUid(meta.uid), fileName }] : [];
  });
  // The notes are named for their contacts, so a link text is also the display name.
  const nameOf = (uid: string) => {
    const id = cleanUid(uid);
    return notes.find((n) => cleanUid(n.uid) === id)?.name ?? remote.find((r) => r.uid === id)?.fileName;
  };
  return {
    uidToName: nameOf,
    displayName: nameOf,
    resolveLink(name) {
      const note = notes.find((n) => n.name === name);
      return note ? { uid: cleanUid(note.uid) } : resolveRemoteName(name, remote);
    },
    // The note named `target` (or at the path `target`), at its path in `paths` or `Contacts/<name>.md`.
    contactNote(target) {
      const bare = target.replace(/\.md$/i, '');
      const name = notes.find((n) => n.name === target)?.name ?? [...paths].find(([, path]) => path.replace(/\.md$/i, '') === bare)?.[0];
      return name === undefined ? undefined : { path: paths.get(name) ?? `Contacts/${name}.md`, name };
    },
  };
}

describe.skipIf(!HAS_PYTHON)('Sync against Radicale 3.8.3', () => {
  // The port is only known once Radicale runs, so the bound adapter is made in beforeAll.
  let bound: AdapterInterface | undefined;
  const real = () => {
    if (!bound) throw new Error('Radicale is not running yet');
    return bound;
  };
  const adapter: AdapterInterface = {
    push: (vcard, opts) => real().push(vcard, opts),
    delete: (href, ifMatch) => real().delete(href, ifMatch),
    pull: (href) => real().pull(href),
    getMetaList: () => real().getMetaList(),
    getMetaByUid: (uid) => real().getMetaByUid(uid),
    checkConnectivity: () => real().checkConnectivity(),
  };
  // One store for both books, like the vault; each book's bases live in sync-state/<source id>/.
  const store = memoryFileStore();
  const state = createSyncState(store, 'sync-state/radicale');
  let radicaleSource: Source;
  let family: Book;
  let bookList: Book[] = [];
  const pushes: string[] = [];
  const notices: string[] = [];
  /** The info line the last review showed, if any (the rewrite of old relationship lines). */
  let rewriteLine: string | undefined;
  /** The info line the last review showed about links to Obsidian notes, if any. */
  let linksLine: string | undefined;
  /** The links setting Sync reads with; a test that turns it on puts it back. */
  let noteLinks: NoteLinkOptions | undefined;
  /** The vault path of a contact's note by its name; a name not in here is at `Contacts/<name>.md`. */
  const paths = new Map<string, string>();
  let jan: Note;
  let notes: { name: string; uid: string }[] = [];
  /** The rows Sync and import read with; a test that changes the settings puts them back. */
  let mapping: MappingRow[] = DEFAULT_MAPPING;

  /** Every UID asked of a book through `getMetaByUid` (a request to the server each). */
  const uidLookups: string[] = [];
  const countedLookups = (inner: AdapterInterface): AdapterInterface => ({
    ...inner,
    getMetaByUid: (uid) => {
      uidLookups.push(uid);
      return inner.getMetaByUid(uid);
    },
  });

  /** The real adapter, counting PUTs and UID lookups. */
  const counting: AdapterInterface = {
    ...countedLookups(adapter),
    push: (vcard, opts) => {
      pushes.push(vcard.raw);
      return adapter.push(vcard, opts);
    },
  };

  /** What the user picks in the review screen: per property, or the same side for every row that needs a decision. */
  type Choices = Record<string, Choice> | 'server' | 'local';

  const bookOf = (id: string) => {
    const book = bookList.find((b) => b.source.id === id);
    if (!book) throw new Error(`no book ${id}`);
    return book;
  };

  /**
   * One Sync through the real orchestration (src/sync/syncFlow.ts): the source choice, prepare, the review and
   * Apply. The review screen is a fake that applies the preselections plus `choices`.
   */
  async function syncNote(note: Note, choices: Choices = {}): Promise<FlowResult> {
    pushes.length = 0;
    notices.length = 0;
    rewriteLine = undefined;
    linksLine = undefined;
    const sources = bookList.map((b) => b.source);
    return syncFlow(
      await flowDepsFor(note, {
        notify: (msg) => void notices.push(msg),
        review: async (request) => {
          const { rows } = request.prepared;
          rewriteLine = request.rewriteLine;
          linksLine = request.linksLine;
          // The server column is labelled with an address book's name, never a fixed server name.
          expect(sources.map((s) => s.name)).toContain(request.serverName);
          const picked =
            typeof choices === 'string'
              ? new Map(rows.filter((r) => r.changed && r.preselect === undefined).map((r) => [r.property, choices as Choice]))
              : new Map(Object.entries(choices));
          expect(canApply(rows, picked), `undecided: ${rows.filter((r) => r.changed && r.preselect === undefined).map((r) => r.property)}`).toBe(true);
          return { kind: 'apply', choices: picked, rename: false };
        },
      }),
    );
  }

  /** The flow deps for one note, as src/sync/sync.ts builds them; `over` is what differs per caller. */
  async function flowDepsFor(
    note: Note,
    over: { notify(message: string): void; review?: SyncFlowDeps['review'] },
  ): Promise<SyncFlowDeps> {
    const lookups = await relationContext(adapter, notes, paths);
    const sources = bookList.map((b) => b.source);
    return {
      note: note.io,
      path: `Contacts/${String(note.frontmatter.name)}.md`,
      name: String(note.frontmatter.name),
      rows: syncRows(mapping), // as src/sync/sync.ts: rows with Sync off are skipped
      sources,
      active: sources,
      defaultSource: 'radicale',
      adapterFor: (source) => (source.id === 'radicale' ? counting : countedLookups(bookOf(source.id).adapter)),
      stateFor: (id) => bookOf(id).state,
      contexts: async () => ({ ctx: lookups, readOnlyCtx: lookups, settle: async () => {} }), // these lookups never write
      review: over.review ?? (async () => ({ kind: 'cancel' })),
      ...(noteLinks ? { noteLinks } : {}),
      notify: over.notify,
      renameBlocked: () => undefined,
      // As src/sync/sync.ts: the setting, else what most cards in the book's listing are.
      newCardVersion: async (source) => {
        const metas = await bookOf(source.id).adapter.getMetaList();
        if (!Array.isArray(metas)) throw new Error(`getMetaList failed: ${metas.errorMessage}`);
        return newCardVersion(source, metas.map((meta) => meta.version));
      },
    };
  }

  /** The outcome of one Sync; 'unchanged' when the note is up to date. */
  async function sync(note: Note, choices: Choices = {}): Promise<SyncOutcome> {
    const result = await syncNote(note, choices);
    if (result.kind === 'upToDate') return 'unchanged';
    if (result.kind !== 'done') throw new Error(`sync: ${JSON.stringify(result)} ${notices.join(' / ')}`);
    return result.outcome;
  }

  /** One Sync with the book choice it made (sync, adopt, move or refuse). */
  async function syncAcrossBooks(note: Note): Promise<{ plan: SyncPlan; outcome?: SyncOutcome; oldKept?: boolean }> {
    const result = await syncNote(note);
    switch (result.kind) {
      case 'upToDate':
        return { plan: result.plan, outcome: 'unchanged' };
      case 'done':
        return { plan: result.plan, outcome: result.outcome, ...(result.oldKept === undefined ? {} : { oldKept: result.oldKept }) };
      case 'refused':
        return { plan: { kind: 'refuse', message: result.message } };
      default:
        throw new Error(`sync: ${JSON.stringify(result)} ${notices.join(' / ')}`);
    }
  }

  /** Like importRemoteCard: pull, translate to friendly properties (plus `source:`), store the pulled card as base. */
  async function importFrom(book: Book, href: string): Promise<Note> {
    const pulled = await book.adapter.pull(href);
    if (!pulled || !('raw' in pulled)) throw new Error(`pull ${href} failed`);
    const props = toFriendly(parseCard(pulled.raw), syncRows(mapping), await relationContext(adapter, notes, paths)).props;
    const uid = cleanUid(String(props.uid));
    await book.state.set(uid, { raw: pulled.raw, etag: pulled.etag ?? '', href: pulled.href ?? href, reader: CURRENT_READER });
    return memoryNote({ ...props, source: book.source.name });
  }
  const importCard = (href: string) => importFrom(bookList[0], href);

  const cardCount = async () => {
    const metas = await adapter.getMetaList();
    if (!Array.isArray(metas)) throw new Error(`getMetaList failed: ${metas.errorMessage}`);
    return metas.length;
  };

  beforeAll(async () => {
    vi.stubGlobal('DOMParser', chromiumLikeDomParser());
    await startRadicale();
    await createAddressBook();
    await createAddressBook(FAMILY);
    const bookSource = (id: string, name: string, book: string): Source => ({
      id,
      name,
      addressBookUrl: `http://127.0.0.1:${port}${book}`,
      authType: 'basic',
      authKey: encodeBasicAuth('frank', 'x'),
      enabled: true,
    });
    radicaleSource = bookSource('radicale', 'Radicale', BOOK);
    const familySource = bookSource('family', 'Family', FAMILY);
    await initSettings(
      async () => ({ sources: [radicaleSource, familySource], defaultSource: 'radicale' }),
      async () => {},
    );
    bound = carddavAdapter(radicaleSource);
    family = { source: familySource, adapter: carddavAdapter(familySource), state: createSyncState(store, 'sync-state/family') };
    bookList = [{ source: radicaleSource, adapter, state }, family];
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (radicale && radicale.exitCode === null) {
      const exited = new Promise((resolve) => radicale?.once('exit', resolve));
      radicale.kill();
      await exited;
    }
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('1. imports the Apple card from an href that is not its UID', async () => {
    await putCard(JAN_HREF, readVcfFixture('appleV3.vcf'));

    const metas = await adapter.getMetaList();
    expect(Array.isArray(metas) && metas.map((m) => ({ href: m.href, uid: m.uid, fn: m.fn, version: m.version }))).toEqual([
      { href: JAN_HREF, uid: JAN_UID, fn: 'Jan de Vries', version: '3.0' },
    ]);

    jan = await importCard(JAN_HREF);
    notes = [{ name: 'Jan de Vries', uid: JAN_UID }];

    expect(jan.frontmatter).toMatchObject({
      name: 'Jan de Vries',
      firstname: 'Jan',
      lastname: 'de Vries',
      company: 'Bakker, Zonen',
      title: 'Baker',
      mobile: '06-12345678',
      'work-phone': '030-1234567',
      email: 'jan@example.nl',
      'email-2': 'jan2@example.nl',
      'work-email': 'jan@bakker.nl',
      website: 'https://jan.example.nl',
      street: 'Dorpsstraat 1',
      city: 'Utrecht',
      postcode: '1234 AB',
      country: 'Nederland',
      'work-city': 'Utrecht',
      note: 'Met at the market\nlikes rye',
      birthday: '--03-12',
      uid: JAN_UID,
    });
    expect(Object.keys(jan.frontmatter).filter((k) => /^[A-Z]|X-/.test(k))).toEqual([]);
    expect(renderFriendlyNote(jan.frontmatter as Record<string, FriendlyValue>, '#Contact')).not.toMatch(/X-CREATED|X-ABLABEL/i);

    const base = await state.get(JAN_UID);
    expect(base?.href).toBe(JAN_HREF);
    expect(base?.raw).toBe(await serverCard(JAN_HREF));
    expect(base?.etag).toBe((await serverEtag(JAN_HREF))?.replace(/"/g, ''));
  });

  it('2. a local edit changes only the TEL value (and REV) on the server', async () => {
    const before = unfolded(await serverCard(JAN_HREF));
    jan.frontmatter.mobile = '06-99999999';

    expect(await sync(jan)).toBe('pushed');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).not.toContain('SECRET-BODY-TEXT');

    const after = unfolded(await serverCard(JAN_HREF));
    const oldTel = before.find((l) => l.includes('06-12345678'));
    expect(oldTel).toBeDefined();
    expect(minus(before, after).filter((l) => !isRev(l))).toEqual([oldTel]);
    expect(minus(after, before).filter((l) => !isRev(l))).toEqual([oldTel!.replace('06-12345678', '06-99999999')]);
    expect(after.filter(isRev)).toHaveLength(1);
    expect(after.filter(isRev)).not.toEqual(before.filter(isRev));
    expect(after).toContain('X-CREATED:2019-04-02T10:11:12Z');

    expect(await cardCount()).toBe(1);
    expect((await state.get(JAN_UID))?.href).toBe(JAN_HREF);

    // Radicale re-serialises what we PUT; that alone must not look like a change.
    expect(await sync(jan)).toBe('unchanged');
    expect(pushes).toEqual([]);
  });

  it('3. a server edit is pulled into the note without a PUT', async () => {
    const edited = (await serverCard(JAN_HREF)).replace('jan@example.nl', 'jan@server.nl');
    await putCard(JAN_HREF, edited);
    const etag = await serverEtag(JAN_HREF);

    expect(await sync(jan)).toBe('pulled');
    expect(jan.frontmatter.email).toBe('jan@server.nl');
    expect(jan.frontmatter.mobile).toBe('06-99999999');
    expect(pushes).toEqual([]);
    expect(await serverEtag(JAN_HREF)).toBe(etag);
  });

  it('4. the same field edited on both sides is decided by the user: Radicale', async () => {
    const before = await serverCard(JAN_HREF);
    await putCard(JAN_HREF, before.replace('TITLE:Baker', 'TITLE:Head baker'));
    const serverVersion = await serverCard(JAN_HREF);
    jan.frontmatter.title = 'Pastry chef';

    expect(await sync(jan, { title: 'server' })).toBe('pulled');
    expect(jan.frontmatter.title).toBe('Head baker');
    expect(jan.body).not.toContain('Pastry chef');
    expect(pushes).toEqual([]);
    expect(await serverCard(JAN_HREF)).toBe(serverVersion);
  });

  // Relies on scenario 4's server state: the card's TITLE is "Head baker" (and the base matches it) when this starts.
  it('4b. the same field edited on both sides is decided by the user: Obsidian', async () => {
    await putCard(JAN_HREF, (await serverCard(JAN_HREF)).replace('TITLE:Head baker', 'TITLE:Master baker'));
    const before = unfolded(await serverCard(JAN_HREF));
    jan.frontmatter.title = 'Pastry chef';

    expect(await sync(jan, { title: 'local' })).toBe('pushed');
    expect(jan.frontmatter.title).toBe('Pastry chef');
    expect(pushes).toHaveLength(1);

    const after = unfolded(await serverCard(JAN_HREF));
    expect(minus(before, after).filter((l) => !isRev(l))).toEqual(['TITLE:Master baker']);
    expect(minus(after, before).filter((l) => !isRev(l))).toEqual(['TITLE:Pastry chef']);
    expect(await sync(jan)).toBe('unchanged');
  });

  it('5. children: [[Sem]] becomes a labelled X-ABRELATEDNAMES with the UID hint on the 3.0 card', async () => {
    await putCard(`${BOOK}sem-card.vcf`, SEM_CARD);
    notes = [...notes, { name: 'Sem', uid: SEM_UID }];
    const before = unfolded(await serverCard(JAN_HREF));
    jan.frontmatter.children = ['[[Sem]]'];

    expect(await sync(jan)).toBe('pushed');
    const after = unfolded(await serverCard(JAN_HREF));
    const added = [`item3.X-ABRELATEDNAMES;X-FRIENDLY-UID=${SEM_UID}:Sem`, 'item3.X-ABLabel:_$!<Child>!$_'];
    expect(minus(unfolded(pushes[0]), added)).toHaveLength(unfolded(pushes[0]).length - 2);
    // Radicale stores the card normalised (properties sorted, names upper-case), so compare without order and case.
    const upper = (lines: string[]) => lines.map((l) => l.replace(/^[^:;]+/, (name) => name.toUpperCase())).sort();
    expect(upper(minus(after, before).filter((l) => !isRev(l)))).toEqual(upper(added));
    expect(minus(before, after).filter((l) => !isRev(l))).toEqual([]);

    expect(await sync(jan)).toBe('unchanged');
    expect(jan.frontmatter.children).toEqual(['[[Sem]]']);
    expect(await cardCount()).toBe(2);
  });

  it('6. met-via is a note-only relationship and never reaches the server', async () => {
    const before = await serverCard(JAN_HREF);
    jan.frontmatter['met-via'] = '[[Piet]]';

    expect(await sync(jan)).toBe('unchanged');
    expect(pushes).toEqual([]);
    const after = await serverCard(JAN_HREF);
    expect(after).toBe(before);
    expect(after).not.toMatch(/MET-VIA|Piet/i);
    expect(jan.frontmatter['met-via']).toBe('[[Piet]]');
  });

  it('7. a new note without uid creates a card and stores the base with the real href', async () => {
    const piet = memoryNote({ name: 'Piet Jansen', firstname: 'Piet', lastname: 'Jansen', mobile: '06-55555555' });

    expect(await sync(piet)).toBe('created');
    const uid = piet.frontmatter.uid;
    expect(typeof uid === 'string' && uid.startsWith('urn:uuid:')).toBe(true);
    const id = cleanUid(String(uid));

    const meta = await adapter.getMetaByUid(id);
    expect(meta && 'href' in meta).toBe(true);
    const href = (meta as VCardMeta).href;
    expect(href).toMatch(new RegExp(`^${BOOK}[^/]+\\.vcf$`));

    const card = unfolded(await serverCard(href));
    // Automatic: the book holds only vCard 3.0 cards.
    expect(card).toContain('VERSION:3.0');
    expect(card.some((l) => /^UID:/.test(l) && cleanUid(l.slice(4)) === id)).toBe(true);
    expect(card.some((l) => /^TEL\b.*:06-55555555$/.test(l))).toBe(true);

    const base = await state.get(String(uid));
    expect(base?.href).toBe(href);
    expect(base?.etag).toBe((await serverEtag(href))?.replace(/"/g, ''));
    expect(await cardCount()).toBe(3);

    expect(await sync(piet)).toBe('unchanged');
    expect(pushes).toEqual([]);
  });

  it('8. the first Sync of a converted upstream note changes nothing on the server', async () => {
    const uid = 'C0FFEE00-0000-4000-8000-000000000008';
    const href = `${BOOK}converted.vcf`;
    await putCard(href, readVcfFixture('appleV3.vcf').replace(JAN_UID, uid));
    const before = await serverCard(href);
    const etag = await serverEtag(href);

    // Upstream kept only the last TYPE of each line: TEL[pref], TEL[VOICE], EMAIL[pref], ADR[pref].
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
      UID: uid,
      'X-CREATED': '2019-04-02T10:11:12Z',
    };
    const converted = convertFrontmatter(upstream, DEFAULT_MAPPING);
    const fm: Record<string, unknown> = { ...upstream };
    for (const key of converted.remove) delete fm[key];
    Object.assign(fm, converted.set);
    const note = memoryNote(fm);

    // Without a base every difference is a decision; taking Radicale everywhere changes nothing on the server.
    expect(await sync(note, 'server')).toBe('pulled');
    expect(pushes).toEqual([]);
    expect(await serverCard(href)).toBe(before);
    expect(await serverEtag(href)).toBe(etag);

    const server = toFriendly(parseCard(before), DEFAULT_MAPPING, await relationContext(adapter, notes, paths)).props;
    const mapped = Object.fromEntries(Object.entries(note.frontmatter).filter(([k]) => isMappedProperty(k, DEFAULT_MAPPING)));
    expect(mapped).toEqual(server);

    expect(await sync(note)).toBe('unchanged');
    expect(pushes).toEqual([]);
  });

  it('9. moves a card to a second address book: create there, delete here, move the base', async () => {
    const familyAdapter = family.adapter;
    const familyState = family.state;

    const uid = 'C0FFEE00-0000-4000-8000-000000000009';
    const href = `${BOOK}to-move.vcf`;
    await putCard(href, SEM_CARD.replace(SEM_UID, uid).replace(/Sem/g, 'Mo'));
    const note = await importCard(href);
    expect(await sync(note)).toBe('unchanged');
    const base = await state.get(uid);
    expect(base?.etag).toBeTruthy();
    const location = { sourceId: 'radicale', href: base!.href, etag: base!.etag };

    // The target already has a card with this UID: refused before anything is written.
    const blocking = `${FAMILY}blocking.vcf`;
    await putCard(blocking, base!.raw);
    expect(await moveCard(base!.raw, uid, { adapter, state, location }, { adapter: familyAdapter, state: familyState })).toEqual({
      ok: false,
      message: 'The address book already has a card with this UID',
    });
    expect(await serverCard(href)).toBe(base!.raw);
    expect(await state.get(uid)).toEqual(base);
    expect((await request('DELETE', blocking)).status).toBeLessThan(300);

    expect(await moveCard(base!.raw, uid, { adapter, state, location }, { adapter: familyAdapter, state: familyState })).toEqual({
      ok: true,
      oldKept: false,
    });
    expect((await request('GET', href)).status).toBe(404);
    expect(await state.get(uid)).toBeUndefined();
    const moved = await familyState.get(uid);
    expect(moved?.href).toMatch(new RegExp(`^${FAMILY}[^/]+\\.vcf$`));
    expect(unfolded(await serverCard(moved!.href))).toEqual(unfolded(base!.raw));
    expect(moved?.etag).toBe((await serverEtag(moved!.href))?.replace(/"/g, ''));
  });

  it('10. a move whose old card changed in the meantime keeps both copies', async () => {
    const familyAdapter = family.adapter;
    const familyState = family.state;
    const uid = 'C0FFEE00-0000-4000-8000-000000000010';
    const href = `${BOOK}changed.vcf`;
    const card = SEM_CARD.replace(SEM_UID, uid).replace(/Sem/g, 'Lou');
    await putCard(href, card);
    const note = await importCard(href);
    expect(await sync(note)).toBe('unchanged');
    const base = (await state.get(uid))!;
    // Another client edits the old card after our Sync.
    await putCard(href, card.replace('FN:Lou de Vries', 'FN:Lou de Vries-Jansen'));

    const location = { sourceId: 'radicale', href: base.href, etag: base.etag };
    expect(await moveCard(base.raw, uid, { adapter, state, location }, { adapter: familyAdapter, state: familyState })).toEqual({
      ok: true,
      oldKept: true,
    });
    expect(await serverCard(href)).toContain('FN:Lou de Vries-Jansen');
    expect((await familyState.get(uid))?.href).toMatch(new RegExp(`^${FAMILY}`));
    expect(await state.get(uid)).toBeUndefined();
  });

  it('11. imports from both books: each base lands in its own source dir', async () => {
    const boUid = 'C0FFEE00-0000-4000-8000-000000000011';
    const annaUid = 'C0FFEE00-0000-4000-8000-000000000012';
    await putCard(`${BOOK}bo.vcf`, SEM_CARD.replace(SEM_UID, boUid).replace(/Sem/g, 'Bo'));
    await putCard(`${FAMILY}anna.vcf`, SEM_CARD.replace(SEM_UID, annaUid).replace(/Sem/g, 'Anna'));

    // What remoteContacts() lists: every book's cards with their source id and import file name.
    const remote = [];
    for (const book of bookList) {
      const metas = await book.adapter.getMetaList();
      if (!Array.isArray(metas)) throw new Error(`getMetaList failed: ${metas.errorMessage}`);
      for (const meta of metas) {
        const fileName = contactFileName(meta.n, meta.fn);
        if (meta.uid && fileName) remote.push({ uid: cleanUid(meta.uid), fileName, sourceId: book.source.id, href: meta.href });
      }
    }
    // Every other card already has a note.
    const noteUids = remote.map((r) => r.uid).filter((uid) => uid !== boUid && uid !== annaUid);
    const candidates = importCandidates(remote, noteUids);
    expect(candidates.map((c) => ({ fileName: c.fileName, sourceId: c.sourceId, href: c.href }))).toEqual([
      { fileName: 'Anna de Vries', sourceId: 'family', href: `${FAMILY}anna.vcf` },
      { fileName: 'Bo de Vries', sourceId: 'radicale', href: `${BOOK}bo.vcf` },
    ]);

    const imported: Record<string, Note> = {};
    for (const candidate of candidates) {
      const book = bookList.find((b) => b.source.id === candidate.sourceId)!;
      imported[candidate.uid] = await importFrom(book, candidate.href);
    }
    expect(imported[boUid].frontmatter).toMatchObject({ name: 'Bo de Vries', source: 'Radicale', uid: boUid });
    expect(imported[annaUid].frontmatter).toMatchObject({ name: 'Anna de Vries', source: 'Family', uid: annaUid });

    expect((await state.get(boUid))?.href).toBe(`${BOOK}bo.vcf`);
    expect((await family.state.get(annaUid))?.href).toBe(`${FAMILY}anna.vcf`);
    expect(await family.state.get(boUid)).toBeUndefined();
    expect(await state.get(annaUid)).toBeUndefined();
    const dirOf = async (dir: string) => (await store.list(dir)).filter((path) => path.endsWith('.vcf'));
    expect(await dirOf('sync-state/family')).toContain(`sync-state/family/${annaUid}.vcf`);
    expect(await dirOf('sync-state/family')).not.toContain(`sync-state/family/${boUid}.vcf`);
    expect(await dirOf('sync-state/radicale')).toContain(`sync-state/radicale/${boUid}.vcf`);
    expect(await dirOf('sync-state/radicale')).not.toContain(`sync-state/radicale/${annaUid}.vcf`);

    // Each note syncs with its own book.
    expect(await syncAcrossBooks(imported[annaUid])).toMatchObject({ plan: { kind: 'sync', sourceId: 'family' }, outcome: 'unchanged' });
    expect(await syncAcrossBooks(imported[boUid])).toMatchObject({ plan: { kind: 'sync', sourceId: 'radicale' }, outcome: 'unchanged' });
  });

  it('12. changing source: and Sync moves the card; only the edited line differs', async () => {
    const uid = 'C0FFEE00-0000-4000-8000-000000000013';
    const href = `${BOOK}traveller.vcf`;
    await putCard(href, readVcfFixture('appleV3.vcf').replace(JAN_UID, uid));
    const note = await importFrom(bookList[0], href);
    expect(note.frontmatter.source).toBe('Radicale');
    const before = unfolded(await serverCard(href));

    note.frontmatter.mobile = '06-77777777';
    note.frontmatter.source = 'Family';
    const result = await syncAcrossBooks(note);
    expect(result.plan).toMatchObject({ kind: 'move', to: 'family' });
    expect(result).toMatchObject({ outcome: 'pushed', oldKept: false });

    // The card is in the new book and gone from the old one.
    expect((await request('GET', href)).status).toBe(404);
    expect(await state.get(uid)).toBeUndefined();
    const moved = await family.state.get(uid);
    expect(moved?.href).toMatch(new RegExp(`^${FAMILY}[^/]+\\.vcf$`));
    expect(moved?.etag).toBe((await serverEtag(moved!.href))?.replace(/"/g, ''));
    expect(note.frontmatter.source).toBe('Family');

    // Untouched lines are byte-identical; the edit is the TEL line (and REV).
    const after = unfolded(await serverCard(moved!.href));
    const oldTel = before.find((l) => l.includes('06-12345678'))!;
    expect(minus(before, after).filter((l) => !isRev(l))).toEqual([oldTel]);
    expect(minus(after, before).filter((l) => !isRev(l))).toEqual([oldTel.replace('06-12345678', '06-77777777')]);
    expect(after).toContain('X-CREATED:2019-04-02T10:11:12Z');

    // From now on the note syncs with the new book.
    expect(await syncAcrossBooks(note)).toMatchObject({ plan: { kind: 'sync', sourceId: 'family' }, outcome: 'unchanged' });
  });

  it('13. a card that is already in the named book is not moved and the other copy stays', async () => {
    const uid = 'C0FFEE00-0000-4000-8000-000000000014';
    const card = SEM_CARD.replace(SEM_UID, uid).replace(/Sem/g, 'Twin');
    await putCard(`${BOOK}twin.vcf`, card);
    await putCard(`${FAMILY}twin.vcf`, card);
    const note = await importFrom(bookList[0], `${BOOK}twin.vcf`);
    const radicaleCopy = await serverCard(`${BOOK}twin.vcf`);
    const radicaleEtag = await serverEtag(`${BOOK}twin.vcf`);
    const radicaleBase = await state.get(uid);
    note.frontmatter.source = 'Family';

    const result = await syncAcrossBooks(note);
    expect(result.plan).toEqual({ kind: 'sync', sourceId: 'family' });
    expect(result.oldKept).toBeUndefined();
    expect(result.outcome).not.toBe('failed');
    // The other copy and its base are untouched; the named book now has a base too.
    expect(await serverCard(`${BOOK}twin.vcf`)).toBe(radicaleCopy);
    expect(await serverEtag(`${BOOK}twin.vcf`)).toBe(radicaleEtag);
    expect(await state.get(uid)).toEqual(radicaleBase);
    expect(await serverCard(`${FAMILY}twin.vcf`)).toContain(`UID:${uid}`);
    expect((await family.state.get(uid))?.href).toBe(`${FAMILY}twin.vcf`);
  });
  it("14. a new card follows its book's version: Automatic takes the majority, the setting wins", async () => {
    const book = '/frank/versions/';
    await createAddressBook(book);
    const v4 = (n: number) => SEM_CARD.replace('VERSION:3.0', 'VERSION:4.0').replace(SEM_UID, `C0FFEE00-0000-4000-8000-00000000004${n}`);
    await putCard(`${book}a.vcf`, v4(1));
    await putCard(`${book}b.vcf`, v4(2));
    await putCard(`${book}c.vcf`, SEM_CARD.replace(SEM_UID, 'C0FFEE00-0000-4000-8000-000000000043'));
    const source: Source = { ...radicaleSource, id: 'versions', name: 'Versions', addressBookUrl: radicaleSource.addressBookUrl.replace(BOOK, book) };
    const versions: Book = { source, adapter: carddavAdapter(source), state: createSyncState(store, 'sync-state/versions') };
    bookList = [...bookList, versions];

    const metas = await versions.adapter.getMetaList();
    expect(Array.isArray(metas) && metas.map((m) => m.version).sort()).toEqual(['3.0', '4.0', '4.0']);

    const created = async (name: string) => {
      const note = memoryNote({ name, firstname: name, lastname: 'Nieuw', birthday: '--03-15', source: 'Versions' });
      expect(await sync(note)).toBe('created');
      const uid = cleanUid(String(note.frontmatter.uid));
      const href = (await versions.state.get(uid))?.href ?? '';
      return unfolded(await serverCard(href));
    };
    const auto = await created('Vier');
    expect(auto).toContain('VERSION:4.0');
    expect(auto).toContain('BDAY:--0315');

    source.newCardVersion = '3.0';
    const fixed = await created('Drie');
    expect(fixed).toContain('VERSION:3.0');
    expect(fixed).toContain('BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-15');
  });

  // Radicale upper-cases property names and sorts the lines, so compare without order and case.
  const upper = (lines: string[]) => lines.map((l) => l.replace(/^[^:;]+/, (name) => name.toUpperCase())).sort();
  const changed = (lines: string[]) => lines.filter((l) => !isRev(l));

  it('15. a DAVx5 3.0 card: relationships and anniversary are read, one is added and removed with its label', async () => {
    const href = `${BOOK}davx5.vcf`;
    await putCard(href, readVcfFixture('davx5V3.vcf'));
    const frank = await importCard(href);
    notes = [...notes, { name: 'Frank Hommers', uid: String(frank.frontmatter.uid) }];

    // The custom label of two parts keeps its comma, escaped (`\,`) or not, whatever the server does with it.
    const label = unfolded(await serverCard(href)).filter((l) => /^item9\.X-ABLABEL:/i.test(l));
    expect(label).toHaveLength(1);
    expect(label[0]).toMatch(/^item9\.X-ABLABEL:Neighbor\\?, Acquaintance$/i);

    // Relationships by label (built-in `_$!<Father>!$_` and plain ones); unlabeled and unknown labels are not mapped.
    expect(frank.frontmatter).toMatchObject({
      name: 'Frank Hommers',
      anniversary: '2012-06-21',
      parents: ['[[Ger Verhallen]]', '[[Truus Verhallen]]'],
      spouse: '[[Sanne Hommers]]',
      children: ['[[Lotte Hommers]]'],
      colleagues: ['[[Pieter Jansen]]', '[[Marieke Bos]]'],
      neighbours: ['[[Henk Smit]]'],
    });
    expect(JSON.stringify(frank.frontmatter)).not.toMatch(/Oom Kees|Klaas de Wit/);

    // Nothing changed: up to date, nothing written.
    expect(await sync(frank)).toBe('unchanged');
    expect(pushes).toEqual([]);

    // A relationship added in the note: X-ABRELATEDNAMES (with the UID hint) plus its label; every other line stays.
    const before = unfolded(await serverCard(href));
    frank.frontmatter.siblings = ['[[Sem]]'];
    expect(await sync(frank)).toBe('pushed');
    const withSibling = unfolded(await serverCard(href));
    const added = [`item10.X-ABRELATEDNAMES;X-FRIENDLY-UID=${SEM_UID}:Sem`, 'item10.X-ABLabel:Sibling'];
    expect(upper(changed(minus(withSibling, before)))).toEqual(upper(added));
    expect(changed(minus(before, withSibling))).toEqual([]);
    expect(await sync(frank)).toBe('unchanged');
    expect(frank.frontmatter.siblings).toEqual(['[[Sem]]']);

    // Removing it takes the line and its label away again.
    delete frank.frontmatter.siblings;
    expect(await sync(frank)).toBe('pushed');
    const after = unfolded(await serverCard(href));
    expect(upper(changed(minus(withSibling, after)))).toEqual(upper(added));
    expect(changed(minus(after, withSibling))).toEqual([]);
    expect(await sync(frank)).toBe('unchanged');
  });

  it('16. a DAVx5 4.0 card: RELATED text lines are read, one is added with the hint and removed again', async () => {
    const uid = 'C0FFEE00-0000-4000-8000-000000000016';
    const href = `${BOOK}davx5-v4.vcf`;
    await putCard(
      href,
      [
        'BEGIN:VCARD',
        'VERSION:4.0',
        `UID:${uid}`,
        'FN:Eva Hommers',
        'N:Hommers;Eva;;;',
        'TEL;TYPE=cell:+31 6 87654321',
        'BDAY:19800204',
        'ANNIVERSARY:20110917',
        'RELATED;TYPE=parent;VALUE=text:Ger Verhallen',
        'RELATED;TYPE=child;VALUE=text:Lotte Hommers',
        'RELATED;TYPE=spouse;VALUE=text:Sanne Hommers',
        'REV:20261019T081500Z',
        'END:VCARD',
        '',
      ].join('\r\n'),
    );
    const eva = await importCard(href);
    notes = [...notes, { name: 'Eva Hommers', uid }];
    expect(eva.frontmatter).toMatchObject({
      name: 'Eva Hommers',
      anniversary: '2011-09-17',
      parents: ['[[Ger Verhallen]]'],
      children: ['[[Lotte Hommers]]'],
      spouse: '[[Sanne Hommers]]',
    });
    expect(await sync(eva)).toBe('unchanged');
    expect(pushes).toEqual([]);

    // The 4.0 form: RELATED;TYPE=...;VALUE=text with the hint; no item groups and no X-AB lines.
    const before = unfolded(await serverCard(href));
    eva.frontmatter.partner = '[[Sem]]';
    expect(await sync(eva)).toBe('pushed');
    const withPartner = unfolded(await serverCard(href));
    const added = [`RELATED;TYPE=sweetheart;VALUE=text;X-FRIENDLY-UID=${SEM_UID}:Sem`];
    expect(upper(changed(minus(withPartner, before)))).toEqual(upper(added));
    expect(changed(minus(before, withPartner))).toEqual([]);
    expect(withPartner.join('\n')).not.toMatch(/X-AB|urn:uuid/i);
    expect(await sync(eva)).toBe('unchanged');
    expect(eva.frontmatter.partner).toBe('[[Sem]]');

    delete eva.frontmatter.partner;
    expect(await sync(eva)).toBe('pushed');
    const after = unfolded(await serverCard(href));
    expect(upper(changed(minus(withPartner, after)))).toEqual(upper(added));
    expect(changed(minus(after, withPartner))).toEqual([]);
    expect(await sync(eva)).toBe('unchanged');
  });

  it('17. a 3.0 card with a plugin-written urn:uuid line is rewritten, and only that line changes', async () => {
    const uid = 'C0FFEE00-0000-4000-8000-000000000017';
    const href = `${BOOK}legacy.vcf`;
    await putCard(
      href,
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `UID:${uid}`,
        'FN:Ria Oud',
        'N:Oud;Ria;;;',
        `RELATED;TYPE=child:urn:uuid:${SEM_UID}`,
        'END:VCARD',
        '',
      ].join('\r\n'),
    );
    const ria = await importCard(href);
    expect(ria.frontmatter.children).toEqual(['[[Sem]]']);
    const before = unfolded(await serverCard(href));
    expect(before.join('\n')).toContain('urn:uuid');

    // The note is unchanged; the review shows only the rewrite line and Apply writes the card.
    expect(await sync(ria)).toBe('pushed');
    expect(rewriteLine).toBe('Relationships on this card are rewritten in the form phones understand.');
    const after = unfolded(await serverCard(href));
    expect(after.join('\n')).not.toContain('urn:uuid');
    expect(upper(changed(minus(after, before)))).toEqual(
      upper([`item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=${SEM_UID}:Sem`, 'item1.X-ABLabel:_$!<Child>!$_']),
    );
    expect(changed(minus(before, after))).toEqual([expect.stringMatching(/^RELATED;TYPE=child:urn:uuid:/i)]);
    expect(ria.frontmatter.children).toEqual(['[[Sem]]']);

    // Done once: the next Sync is up to date and shows no review.
    expect(await sync(ria)).toBe('unchanged');
    expect(rewriteLine).toBeUndefined();
  });

  it.each([
    ['3.0', [`item1.X-ABRELATEDNAMES:urn:uuid:${SEM_UID}`, 'item1.X-ABLabel:_$!<Spouse>!$_'], `item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=${SEM_UID}:Sem`],
    ['4.0', [`RELATED;TYPE=spouse;VALUE=text:urn:uuid:${SEM_UID}`], `RELATED;TYPE=spouse;VALUE=text;X-FRIENDLY-UID=${SEM_UID}:Sem`],
  ])('18. %s: a "urn:uuid:…" name (DAVx5 kept alpha.6\'s link as the name) links Sem and gets his name', async (version, lines, fixed) => {
    const uid = `C0FFEE00-0000-4000-8000-00000000018${version === '3.0' ? '3' : '4'}`;
    const href = `${BOOK}urn-name-${version}.vcf`;
    await putCard(
      href,
      ['BEGIN:VCARD', `VERSION:${version}`, `UID:${uid}`, 'FN:Rik Oud', 'N:Oud;Rik;;;', ...lines, 'END:VCARD', ''].join('\r\n'),
    );
    const rik = await importCard(href);
    expect(rik.frontmatter.spouse).toBe('[[Sem]]');
    const before = unfolded(await serverCard(href));

    // The note already links Sem: only the rewrite is reviewed, and Apply puts his name on the card.
    expect(await sync(rik)).toBe('pushed');
    expect(rewriteLine).toBe('Relationships on this card are rewritten in the form phones understand.');
    const after = unfolded(await serverCard(href));
    expect(after.join('\n')).not.toContain('urn:uuid');
    expect(upper(changed(minus(after, before)))).toEqual(upper([fixed]));
    expect(changed(minus(before, after))).toEqual([expect.stringMatching(/urn:uuid:/i)]);
    expect(rik.frontmatter.spouse).toBe('[[Sem]]');

    expect(await sync(rik)).toBe('unchanged');
    expect(rewriteLine).toBeUndefined();
  });

  it.each([
    ['a URI', `RELATED;TYPE=spouse:urn:uuid:${SEM_UID}`, `RELATED;TYPE=spouse;VALUE=text;X-FRIENDLY-UID=${SEM_UID}:Sem`, '1'],
    ['a URI with several types', `RELATED;TYPE=spouse,friend:urn:uuid:${SEM_UID}`, `RELATED;TYPE=spouse,friend;VALUE=text;X-FRIENDLY-UID=${SEM_UID}:Sem`, '2'],
  ])('19. 4.0: %s holding urn:uuid gets Sem\'s name and the hint in place; the types stay', async (_what, line, fixed, n) => {
    const uid = `C0FFEE00-0000-4000-8000-00000000019${n}`;
    const href = `${BOOK}urn-uri-${n}.vcf`;
    await putCard(href, ['BEGIN:VCARD', 'VERSION:4.0', `UID:${uid}`, 'FN:Roos Oud', 'N:Oud;Roos;;;', line, 'END:VCARD', ''].join('\r\n'));
    const roos = await importCard(href);
    expect(roos.frontmatter.spouse).toBe('[[Sem]]');
    const before = unfolded(await serverCard(href));

    // Only the rewrite is reviewed; Apply changes only that line, and the card stays 4.0.
    expect(await sync(roos)).toBe('pushed');
    expect(rewriteLine).toBe('Relationships on this card are rewritten in the form phones understand.');
    const after = unfolded(await serverCard(href));
    expect(after.join('\n')).not.toContain('urn:uuid');
    expect(after).toContain('VERSION:4.0');
    expect(upper(changed(minus(after, before)))).toEqual(upper([fixed]));
    expect(changed(minus(before, after))).toEqual([expect.stringMatching(/urn:uuid:/i)]);
    expect(roos.frontmatter.spouse).toBe('[[Sem]]');

    // Done once: no review loop.
    expect(await sync(roos)).toBe('unchanged');
    expect(rewriteLine).toBeUndefined();
  });

  it.each([
    ['3.0', '2012-05-01', '2020-02-02', '2020-02-02'],
    ['4.0', '20120501', '2020-02-02', '20200202'],
  ])('20. %s: a date with a label: adding its row never removes it, and a new one lands with its label', async (version, onCard, newValue, written) => {
    const uid = `C0FFEE00-0000-4000-8000-00000000020${version === '3.0' ? '3' : '4'}`;
    const href = `${BOOK}labelled-date-${version}.vcf`;
    const dated = (id: string, first: string, last: string) =>
      [
        'BEGIN:VCARD',
        `VERSION:${version}`,
        `UID:${id}`,
        `FN:${first} ${last}`,
        `N:${last};${first};;;`,
        `item1.X-ABDATE:${onCard}`,
        'item1.X-ABLabel:Verkering',
        'END:VCARD',
        '',
      ].join('\r\n');
    await putCard(href, dated(uid, 'Dora', 'Vast'));
    // A second contact whose note is not filled: its base is another device's, older than the row.
    const evaUid = `C0FFEE00-0000-4000-8000-0000000002${version === '3.0' ? '13' : '14'}`;
    const evaHref = `${BOOK}labelled-date-unfilled-${version}.vcf`;
    await putCard(evaHref, dated(evaUid, 'Eva', 'Vast'));
    try {
      // Without a row for the label the date is not read, and Sync leaves it alone.
      const dora = await importCard(href);
      expect(dora.frontmatter.dating).toBeUndefined();
      expect(await sync(dora)).toBe('unchanged');
      expect(pushes).toEqual([]);
      const start = unfolded(await serverCard(href));
      const eva = await importCard(evaHref);
      expect(eva.frontmatter.dating).toBeUndefined();
      const evaBase = await bookList[0].state.get(cleanUid(evaUid));
      expect(evaBase?.storedAt).toEqual(expect.any(Number));
      const evaStart = unfolded(await serverCard(evaHref));

      // Add the row (later than both bases), then fill the note from its base the way the settings screen does.
      const since = (evaBase?.storedAt ?? 0) + 1;
      const row = labelledDateRow('Verkering', 'dating', since);
      mapping = insertLabelledDateRow(DEFAULT_MAPPING, row);
      const stored = await bookList[0].state.get(cleanUid(uid));
      if (!stored) throw new Error('no base stored');
      const plan = planDateFill(
        [{ path: 'Contacts/Dora Vast.md', frontmatter: dora.frontmatter, base: { raw: stored.raw, reader: readerOf(stored.reader) } }],
        mapping,
        row,
      );
      expect(plan).toEqual([{ path: 'Contacts/Dora Vast.md', set: { dating: '2012-05-01' } }]);
      Object.assign(dora.frontmatter, plan[0].set);
      expect(dora.frontmatter.dating).toBe('2012-05-01');

      // The anti-goal: the card keeps both lines, byte for byte. The base, older than the row, is stored again.
      expect(await sync(dora)).toBe('unchanged');
      expect(pushes).toEqual([]);
      expect(unfolded(await serverCard(href))).toEqual(start);
      expect((await bookList[0].state.get(cleanUid(uid)))?.storedAt).toBeGreaterThanOrEqual(since);

      // The anti-goal on a device whose note was not filled: the date is the card's, pulled into the note, no PUT.
      expect(await sync(eva)).toBe('pulled');
      expect(pushes).toEqual([]);
      expect(unfolded(await serverCard(evaHref))).toEqual(evaStart);
      expect(eva.frontmatter.dating).toBe('2012-05-01');
      expect(await sync(eva)).toBe('unchanged');

      // A second date with the label lands as a new labelled pair; nothing else changes.
      dora.frontmatter['dating-2'] = newValue;
      expect(await sync(dora)).toBe('pushed');
      const after = unfolded(await serverCard(href));
      const added = changed(minus(after, start));
      expect(added).toHaveLength(2);
      const group = /^(item\d+)\./i.exec(added[0])?.[1];
      expect(group).toBeDefined();
      expect(upper(added)).toEqual(upper([`${group}.X-ABDATE:${written}`, `${group}.X-ABLabel:Verkering`]));
      expect(group?.toLowerCase()).not.toBe('item1');
      expect(changed(minus(start, after))).toEqual([]);
      expect(after).toContain(`VERSION:${version}`);

      expect(await sync(dora)).toBe('unchanged');
      expect(dora.frontmatter).toMatchObject({ dating: '2012-05-01', 'dating-2': newValue });
    } finally {
      mapping = DEFAULT_MAPPING;
    }
  });

  it.each([
    ['3.0', 'item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=%UID:Ger Verhallen', 'item1.X-ABLabel:_$!<Spouse>!$_', 'item2'],
    ['4.0', 'RELATED;TYPE=spouse;VALUE=text;X-FRIENDLY-UID=%UID:Ger Verhallen', undefined, 'item1'],
  ])('21. %s: links to Obsidian notes: written, followed after a rename, removed when off', async (version, spouseLine, spouseLabel, group) => {
    const suffix = version === '3.0' ? '3' : '4';
    const gerUid = `C0FFEE00-0000-4000-8000-00000000023${suffix}`;
    const joseUid = `C0FFEE00-0000-4000-8000-00000000024${suffix}`;
    const gerHref = `${BOOK}links-ger-${version}.vcf`;
    const joseHref = `${BOOK}links-jose-${version}.vcf`;
    await putCard(gerHref, ['BEGIN:VCARD', `VERSION:${version}`, `UID:${gerUid}`, 'FN:Ger Verhallen', 'N:Verhallen;Ger;;;', 'END:VCARD', ''].join('\r\n'));
    await putCard(
      joseHref,
      [
        'BEGIN:VCARD',
        `VERSION:${version}`,
        `UID:${joseUid}`,
        'FN:Jose Verhallen',
        'N:Verhallen;Jose;;;',
        spouseLine.replace('%UID', gerUid),
        ...(spouseLabel ? [spouseLabel] : []),
        'URL:https://jose.example',
        'END:VCARD',
        '',
      ].join('\r\n'),
    );
    const savedNotes = notes;
    notes = [...notes, { name: 'Ger Verhallen', uid: gerUid }, { name: 'Jose Verhallen', uid: joseUid }];
    const gerUrl = noteLinkUrl('Notes', 'Contacts/Ger Verhallen.md');
    expect(gerUrl).toBe('obsidian://open?vault=Notes&file=Contacts%2FGer%20Verhallen');
    try {
      const jose = await importCard(joseHref);
      expect(jose.frontmatter).toMatchObject({ spouse: '[[Ger Verhallen]]', website: 'https://jose.example' });
      const props = JSON.stringify(jose.frontmatter);
      expect(await sync(jose)).toBe('unchanged');
      expect(pushes).toEqual([]);
      const start = unfolded(await serverCard(joseHref));

      // On: the card gets the link and its label, nothing else; the note gets nothing.
      noteLinks = { enabled: true, vault: 'Notes', ownVaults: ['Notes'] };
      expect(await sync(jose)).toBe('pushed');
      expect(linksLine).toBe(LINKS_LINE);
      const withLink = unfolded(await serverCard(joseHref));
      expect(upper(changed(minus(withLink, start)))).toEqual(upper([`${group}.URL:${gerUrl}`, `${group}.X-ABLabel:Ger Verhallen`]));
      expect(changed(minus(start, withLink))).toEqual([]);
      expect(withLink).toContain(`VERSION:${version}`);
      expect(JSON.stringify(jose.frontmatter)).toBe(props);
      expect(await sync(jose)).toBe('unchanged');
      expect(linksLine).toBeUndefined();
      expect(JSON.stringify(jose.frontmatter)).toBe(props);

      // The note moves: the link follows it. The URL is the link's identity, so the old pair goes and the new one
      // lands as the next free group, with the same label; nothing else on the card changes.
      paths.set('Ger Verhallen', 'Contacts/Ger Verhallen/index.md');
      expect(await sync(jose)).toBe('pushed');
      expect(linksLine).toBe(LINKS_LINE);
      const moved = unfolded(await serverCard(joseHref));
      const movedGroup = `item${Number(group.slice('item'.length)) + 1}`;
      const movedUrl = noteLinkUrl('Notes', 'Contacts/Ger Verhallen/index.md');
      expect(movedUrl).toBe('obsidian://open?vault=Notes&file=Contacts%2FGer%20Verhallen%2Findex');
      expect(upper(changed(minus(moved, withLink)))).toEqual(upper([`${movedGroup}.URL:${movedUrl}`, `${movedGroup}.X-ABLabel:Ger Verhallen`]));
      expect(upper(changed(minus(withLink, moved)))).toEqual(upper([`${group}.URL:${gerUrl}`, `${group}.X-ABLabel:Ger Verhallen`]));
      expect(moved).toContain('URL:https://jose.example');
      expect(await sync(jose)).toBe('unchanged');

      // Off: both link lines go, the website stays as it was, and the note is not touched.
      noteLinks = { enabled: false, vault: 'Notes', ownVaults: ['Notes'] };
      expect(await sync(jose)).toBe('pushed');
      const off = unfolded(await serverCard(joseHref));
      expect(upper(changed(minus(moved, off)))).toEqual(upper([`${movedGroup}.URL:${movedUrl}`, `${movedGroup}.X-ABLabel:Ger Verhallen`]));
      expect(changed(minus(off, moved))).toEqual([]);
      expect(off).toContain('URL:https://jose.example');
      expect(upper(changed(off))).toEqual(upper(changed(start)));
      expect(JSON.stringify(jose.frontmatter)).toBe(props);
      expect(await sync(jose)).toBe('unchanged');
    } finally {
      noteLinks = undefined;
      paths.clear();
      notes = savedNotes;
    }
  });

  // The plugin writes `GENDER:O;non-binair`; Radicale does not know GENDER as a field made of parts and stores the
  // `;` escaped. The plugin reads that escaped `;` as the separator, so the identity survives the next Sync.
  it.each([
    ['3.0', String.raw`X-GENDER:O\;non-binair`, '3'],
    ['4.0', String.raw`GENDER:O\;non-binair`, '4'],
  ])('22. %s: department, prefix and gender from the note are written as parts; the next Sync is up to date', async (version, genderLine, suffix) => {
    const uid = `C0FFEE00-0000-4000-8000-00000000022${suffix}`;
    const href = `${BOOK}parts-${version}.vcf`;
    await putCard(
      href,
      ['BEGIN:VCARD', `VERSION:${version}`, `UID:${uid}`, 'FN:Piet Parts', 'N:Parts;Piet;;;', 'ORG:Acme', 'END:VCARD', ''].join('\r\n'),
    );
    const piet = await importCard(href);
    expect(piet.frontmatter).toMatchObject({ company: 'Acme' });
    expect(await sync(piet)).toBe('unchanged');
    const before = unfolded(await serverCard(href));

    Object.assign(piet.frontmatter, { department: 'Sales', 'name-prefix': 'Dr.', gender: 'O', 'gender-identity': 'non-binair' });
    expect(await sync(piet)).toBe('pushed');
    const after = unfolded(await serverCard(href));
    expect(after).toContain(`VERSION:${version}`);
    expect(upper(changed(minus(after, before)))).toEqual(upper(['ORG:Acme;Sales', 'N:Parts;Piet;;Dr.;', genderLine]));
    expect(upper(changed(minus(before, after)))).toEqual(upper(['ORG:Acme', 'N:Parts;Piet;;;']));
    expect(piet.frontmatter).toMatchObject({ department: 'Sales', 'name-prefix': 'Dr.', gender: 'O', 'gender-identity': 'non-binair' });

    expect(await sync(piet)).toBe('unchanged');
    expect(pushes).toEqual([]);
  });

  it.each([
    ['3.0', '3'],
    ['4.0', '4'],
  ])('23. %s: a part an older reader did not show arrives in the note and the card stays as it is', async (version, suffix) => {
    const uid = `C0FFEE00-0000-4000-8000-00000000025${suffix}`;
    const href = `${BOOK}parts-old-reader-${version}.vcf`;
    await putCard(
      href,
      ['BEGIN:VCARD', `VERSION:${version}`, `UID:${uid}`, 'FN:Mia Parts', 'N:Parts;Mia;;;', 'ORG:Acme;Sales', 'END:VCARD', ''].join('\r\n'),
    );
    const mia = await importCard(href);
    // The base as a device with reader 2 stored it: ORG's second part was not read then.
    const stored = await bookList[0].state.get(cleanUid(uid));
    if (!stored) throw new Error('no base stored');
    await bookList[0].state.set(cleanUid(uid), { ...stored, reader: 2 });
    delete mia.frontmatter.department;
    const start = unfolded(await serverCard(href));

    expect(await sync(mia)).toBe('pulled');
    expect(pushes).toEqual([]);
    expect(mia.frontmatter).toMatchObject({ company: 'Acme', department: 'Sales' });
    expect(unfolded(await serverCard(href))).toEqual(start);
    expect(await sync(mia)).toBe('unchanged');
    expect(pushes).toEqual([]);
  });

  it.each([['3.0'], ['4.0']])('24. %s: a note photo survives Radicale, other edits, a phone edit and its removal', async (version) => {
    // Radicale (vobject) damages a vCard 4.0 data URI photo to `data:image/png\\;base64`; 3.0 ENCODING=b is intact.
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const photo = `data:image/png;base64,${PNG}`;
    const uid = `C0FFEE00-0000-4000-8000-00000000026${version === '3.0' ? '3' : '4'}`;
    const href = `${BOOK}photo-${version}.vcf`;
    await putCard(href, ['BEGIN:VCARD', `VERSION:${version}`, `UID:${uid}`, 'FN:Foto Test', 'N:Test;Foto;;;', 'END:VCARD', ''].join('\r\n'));
    const note = await importCard(href);
    const photoOnServer = async () => unfolded(await serverCard(href)).filter((l) => /^PHOTO/i.test(l));

    // Added in the note: pushed once, then up to date.
    note.frontmatter.photo = photo;
    expect(await sync(note)).toBe('pushed');
    if (version === '4.0') expect(await photoOnServer()).toEqual([expect.stringMatching(/^PHOTO:data:image\/png\\;base64$/i)]);
    expect(await sync(note)).toBe('unchanged');
    expect(pushes).toEqual([]);

    // Another note edit: one push, without the photo coming back as a difference.
    note.frontmatter.title = 'Fotograaf';
    expect(await sync(note)).toBe('pushed');
    expect(await sync(note)).toBe('unchanged');

    // A phone edits the card: pulled, no photo row and no push.
    const card = await serverCard(href);
    await putCard(href, card.replace('END:VCARD', 'NICKNAME:Flits\r\nEND:VCARD'));
    expect(await sync(note)).toBe('pulled');
    expect(pushes).toEqual([]);
    expect(note.frontmatter).toMatchObject({ photo, nickname: 'Flits' });
    expect(await sync(note)).toBe('unchanged');

    if (version === '4.0') {
      // A phone that could not read the damaged photo (DAVx5) sends the card back without any PHOTO line: no removal.
      const dropped = unfolded(await serverCard(href))
        .filter((l) => !/^(\w+\.)?PHOTO[;:]/i.test(l))
        .map((l) => (/^NICKNAME:/i.test(l) ? 'NICKNAME:Bliksem' : l));
      await putCard(href, [...dropped, ''].join('\r\n'));
      expect(await photoOnServer()).toEqual([]);
      expect(await sync(note)).toBe('pulled');
      expect(pushes).toEqual([]);
      expect(note.frontmatter).toMatchObject({ photo, nickname: 'Bliksem' });
      expect(await sync(note)).toBe('unchanged');
    }

    // Removed in the note: removed on the server.
    delete note.frontmatter.photo;
    expect(await sync(note)).toBe('pushed');
    expect(await photoOnServer()).toEqual([]);
    expect(await sync(note)).toBe('unchanged');
    expect(unfolded(await serverCard(href))).toContain(`VERSION:${version}`);
  });

  it('25. 4.0: a contact an earlier version damaged: the note is put right without a push; a photo put back, or new while a phone adds one, is pushed once', async () => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const photo = `data:image/png;base64,${PNG}`;
    const uid = 'C0FFEE00-0000-4000-8000-000000000270';
    const href = `${BOOK}photo-damaged.vcf`;
    await putCard(href, ['BEGIN:VCARD', 'VERSION:4.0', `UID:${uid}`, 'FN:Foto Schade', 'N:Schade;Foto;;;', `PHOTO:${photo}`, 'END:VCARD', ''].join('\r\n'));
    const photoOnServer = async () => unfolded(await serverCard(href)).filter((l) => /^PHOTO/i.test(l));
    expect(await photoOnServer()).toEqual([String.raw`PHOTO:data:image/png\;base64`]);
    // What an earlier version left: the damaged value in the note, the damaged card as the base.
    const note = await importCard(href);
    expect(note.frontmatter.photo).toBe(String.raw`data:image/png\;base64`);

    // Put right in the note, nothing pushed; then up to date.
    expect(await sync(note)).toBe('pulled');
    expect(pushes).toEqual([]);
    expect(note.frontmatter.photo).toBeUndefined();
    expect(await sync(note)).toBe('unchanged');

    // The owner puts the photo back: pushed once, then up to date.
    note.frontmatter.photo = photo;
    expect(await sync(note)).toBe('pushed');
    expect(pushes).toHaveLength(1);
    expect(pushes[0].replace(/\r\n[ \t]/g, '')).toContain(`PHOTO:${photo}`);
    expect(await sync(note)).toBe('unchanged');
    expect(note.frontmatter.photo).toBe(photo);

    // A new photo in the note while a phone adds another: the note's is pushed, not lost.
    const other = `data:image/png;base64,${PNG.replace('iVBOR', 'iVBOQ')}`;
    delete note.frontmatter.photo;
    expect(await sync(note)).toBe('pushed');
    expect(await photoOnServer()).toEqual([]);
    note.frontmatter.photo = other;
    await putCard(href, (await serverCard(href)).replace('END:VCARD', `PHOTO:${photo}\r\nEND:VCARD`));
    expect(await sync(note)).toBe('pushed');
    expect(pushes[0].replace(/\r\n[ \t]/g, '').match(/^PHOTO.*$/gm)).toEqual([`PHOTO:${other}`]);
    expect(await sync(note)).toBe('unchanged');
    expect(note.frontmatter.photo).toBe(other);
  });

  it('26. Sync all: scan, apply all that are ready, a new card only on its own, a note changed after the scan', async () => {
    const cardOf = (uid: string, first: string, extra = '') =>
      SEM_CARD.replace(SEM_UID, uid).replace(/Sem/g, first).replace('END:VCARD', `${extra}END:VCARD`);
    const tel = (value: string) => `TEL;TYPE=CELL:${value}\r\n`;
    const uidOf = (n: number) => `C0FFEE00-0000-4000-8000-0000000002${n}0`;

    // Jos: changed on the server. Pim: up to date. Ans: her note is changed (and again after the scan).
    const josHref = `${BOOK}scan-jos.vcf`;
    await putCard(josHref, cardOf(uidOf(60), 'Jos'));
    await putCard(`${BOOK}scan-pim.vcf`, cardOf(uidOf(61), 'Pim'));
    await putCard(`${BOOK}scan-ans.vcf`, cardOf(uidOf(62), 'Ans'));
    const jos = await importCard(josHref);
    const pim = await importCard(`${BOOK}scan-pim.vcf`);
    const ans = await importCard(`${BOOK}scan-ans.vcf`);
    for (const n of [jos, pim, ans]) expect(await sync(n)).toBe('unchanged');
    await putCard(josHref, cardOf(uidOf(60), 'Jos', tel('06-11111111')));
    ans.frontmatter.mobile = '06-33333333';
    // Nieuw: no card yet.
    const nieuw = memoryNote({ name: 'Nieuw de Vries', firstname: 'Nieuw', lastname: 'de Vries', mobile: '06-22222222' });
    // Ada: no source:, no base on this device, her card is only in the second book, and it changed.
    const adaUid = uidOf(63);
    const adaCard = cardOf(adaUid, 'Ada');
    await putCard(`${FAMILY}scan-ada.vcf`, adaCard);
    const ada = memoryNote(toFriendly(parseCard(adaCard), mapping, await relationContext(adapter, notes, paths)).props);
    expect(ada.frontmatter.source).toBeUndefined();
    expect(await family.state.get(adaUid)).toBeUndefined();
    expect(await state.get(adaUid)).toBeUndefined();
    await putCard(`${FAMILY}scan-ada.vcf`, cardOf(adaUid, 'Ada', tel('06-44444444')));

    const all = [jos, pim, ans, nieuw, ada];
    const pathOf = (n: Note) => `Contacts/${String(n.frontmatter.name)}.md`;
    const syncAll = new SyncAll({
      notes: () => all.map((n) => ({ path: pathOf(n), name: String(n.frontmatter.name) })),
      flowDeps: async (path, over) => flowDepsFor(all.find((n) => pathOf(n) === path)!, over),
      lock: () => () => {},
    });
    const item = (n: Note) => syncAll.state.items.find((i) => i.path === pathOf(n))!;
    const cards = await cardCount();
    const pimBase = await state.get(uidOf(61));

    uidLookups.length = 0;
    await syncAll.scan();
    // The scan reads each book's listing once; it asks the server for no single UID.
    expect(uidLookups).toEqual([]);
    expect(item(jos)).toMatchObject({ kind: 'review', badges: ['server'] });
    expect(item(nieuw)).toMatchObject({ kind: 'review', badges: ['newCard'] });
    expect(item(pim)).toMatchObject({ kind: 'upToDate' });
    expect(item(ans)).toMatchObject({ kind: 'review', badges: ['obsidian'] });
    // Ada has no base to compare with, so her phone number is a conflict to decide: not ready for Apply all.
    expect(item(ada)).toMatchObject({ kind: 'review', badges: ['conflict'] });
    // Nothing was written by the scan.
    expect(await cardCount()).toBe(cards);
    expect(jos.frontmatter.mobile).toBeUndefined();
    expect(await state.get(uidOf(61))).toEqual(pimBase);

    // The owner changes Ans again after the scan.
    ans.frontmatter.mobile = '06-55555555';
    const ansCard = await serverCard(`${BOOK}scan-ans.vcf`);
    const ansNote = structuredClone(ans.frontmatter);
    const ansBase = await state.get(uidOf(62));
    expect(ansBase).toBeDefined();
    expect(syncAll.readyPaths()).toEqual([pathOf(ans), pathOf(jos)].sort());
    const counts = await syncAll.applyAllReady();
    expect(counts).toEqual({ applied: 1, changed: 1, failed: 0 });
    expect(jos.frontmatter.mobile).toBe('06-11111111');
    expect(item(jos).kind).toBe('done');
    expect(await cardCount()).toBe(cards);
    expect(item(nieuw).kind).toBe('review');
    expect(nieuw.frontmatter.uid).toBeUndefined();
    expect(item(ans)).toMatchObject({ kind: 'review', messages: [CHANGED_SINCE_SCAN] });
    expect(await serverCard(`${BOOK}scan-ans.vcf`)).toBe(ansCard);
    expect(ans.frontmatter).toEqual(ansNote);
    expect(await state.get(uidOf(62))).toEqual(ansBase);

    // A new card is created only on its own Apply.
    await syncAll.apply(pathOf(nieuw));
    expect(item(nieuw).kind).toBe('done');
    expect(await cardCount()).toBe(cards + 1);
    expect(typeof nieuw.frontmatter.uid).toBe('string');
    expect(await state.get(String(nieuw.frontmatter.uid))).toBeDefined();

    // Ada's card is in the second book: the listing and the real lookup agree, so her Apply goes through.
    const adaItem = item(ada);
    if (adaItem.kind !== 'review') throw new Error('Ada is not listed');
    syncAll.setChoices(pathOf(ada), new Map(adaItem.request.prepared.rows.filter((r) => r.changed && r.preselect === undefined).map((r) => [r.property, 'server' as Choice])));
    await syncAll.apply(pathOf(ada));
    expect(item(ada).kind).toBe('done');
    expect(ada.frontmatter.mobile).toBe('06-44444444');
    expect((await family.state.get(adaUid))?.href).toBe(`${FAMILY}scan-ada.vcf`);
    expect(await state.get(adaUid)).toBeUndefined();

    // A fresh scan lists nothing but Ans, whose note changed after the scan.
    await syncAll.scan();
    expect(syncAll.state.items.filter((i) => i.kind !== 'upToDate').map((i) => i.path)).toEqual([pathOf(ans)]);
  });

  it('27. Sync off for friends: cards keep their Friend lines, no friend comes into the note, turning it on offers the note\'s friends', async () => {
    const uid = 'C0FFEE00-0000-4000-8000-000000000027';
    const href = `${BOOK}friends-off.vcf`;
    const upper = (lines: string[]) => lines.map((l) => l.replace(/^[^:;]+/, (name) => name.toUpperCase())).sort();
    const changed = (lines: string[]) => lines.filter((l) => !isRev(l));
    const friendLines = async () => unfolded(await serverCard(href)).filter((l) => /^RELATED;TYPE=friend/i.test(l));
    const friendsOff = (rows: MappingRow[]): MappingRow[] =>
      rows.map((r) => (r.property === 'friends' ? { ...r, sync: false as const } : r));
    const cardOf = (...friends: string[]) =>
      [
        'BEGIN:VCARD', 'VERSION:4.0', `UID:${uid}`, 'FN:Fien Vriend', 'N:Vriend;Fien;;;', 'EMAIL:fien@example.com',
        ...friends.map((name) => `RELATED;TYPE=friend;VALUE=text:${name}`), 'END:VCARD', '',
      ].join('\r\n');
    try {
      mapping = friendsOff(DEFAULT_MAPPING);
      await putCard(href, cardOf('Pia Jansen'));
      const fien = await importCard(href);
      // The card's Friend line is not mapped; the note's own friends are not the card's.
      expect(fien.frontmatter.friends).toBeUndefined();
      fien.frontmatter.friends = ['[[Kees Bakker]]', '[[Lies Smit]]'];
      expect(await sync(fien)).toBe('unchanged');
      expect(pushes).toEqual([]);

      // An Apply of another property keeps the card's Friend lines, and the note's friends stay off the card.
      const before = unfolded(await serverCard(href));
      fien.frontmatter.email = 'fien@example.org';
      expect(await sync(fien)).toBe('pushed');
      const after = unfolded(await serverCard(href));
      expect(upper(changed(minus(after, before)))).toEqual(upper(['EMAIL:fien@example.org']));
      expect(upper(changed(minus(before, after)))).toEqual(upper(['EMAIL:fien@example.com']));
      expect(await friendLines()).toEqual(['RELATED;TYPE=friend;VALUE=text:Pia Jansen']);
      expect(await sync(fien)).toBe('unchanged');

      // A Friend added on the card stays there and does not come into the note.
      await putCard(href, cardOf('Pia Jansen', 'Joop Meijer').replace('fien@example.com', 'fien@example.org'));
      await sync(fien);
      expect(pushes).toEqual([]);
      expect(fien.frontmatter.friends).toEqual(['[[Kees Bakker]]', '[[Lies Smit]]']);
      expect(await friendLines()).toHaveLength(2);

      // The owner cleans the card, then turns Sync back on (the time is later than the base's).
      await putCard(href, cardOf().replace('fien@example.com', 'fien@example.org'));
      expect(await sync(fien)).toBe('unchanged');
      const base = await state.get(cleanUid(uid));
      expect(base?.storedAt).toEqual(expect.any(Number));
      mapping = DEFAULT_MAPPING.map((r) => (r.property === 'friends' ? { ...r, syncSince: (base?.storedAt ?? 0) + 1 } : r));
      let shown: { property: string; preselect?: string; server?: unknown; local?: unknown; changed: boolean }[] = [];
      const result = await syncFlow(
        await flowDepsFor(fien, {
          notify: () => {},
          review: async (request) => {
            shown = request.prepared.rows;
            return { kind: 'cancel' };
          },
        }),
      );
      expect(result.kind).toBe('cancelled');
      // The stale base is read without the row: the note's friends are an Obsidian change, never a removal.
      expect(shown.filter((r) => r.changed).map((r) => r.property)).toEqual(['friends']);
      expect(shown.find((r) => r.property === 'friends')).toMatchObject({ preselect: 'local' });
      expect(fien.frontmatter.friends).toEqual(['[[Kees Bakker]]', '[[Lies Smit]]']);
      expect(await friendLines()).toEqual([]);

      // Applied, the note's friends reach the card.
      expect(await sync(fien)).toBe('pushed');
      expect(await friendLines()).toHaveLength(2);
      expect(fien.frontmatter.friends).toEqual(['[[Kees Bakker]]', '[[Lies Smit]]']);
      expect(await sync(fien)).toBe('unchanged');
    } finally {
      mapping = DEFAULT_MAPPING;
    }
  });
});
