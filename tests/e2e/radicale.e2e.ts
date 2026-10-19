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
import { DEFAULT_MAPPING, isMappedProperty } from 'src/contacts/friendly/mapping';
import { RelationContext, resolveRemoteName } from 'src/contacts/friendly/relations';
import { FriendlyValue, toFriendly } from 'src/contacts/friendly/translate';
import { contactFileName, renderFriendlyNote } from 'src/contacts/friendlyNotes';
import { initSettings } from 'src/context/sharedSettingsContext';
import type { Source } from 'src/settings/settings.d';
import { encodeBasicAuth } from 'src/settings/carddavCredentials';
import { VCardMeta } from 'src/sync/adapters/adapter';
import { AdapterInterface } from 'src/sync/adapters/adapterInterface';
import { carddavAdapter } from 'src/sync/adapters/carddavGeneric';
import { moveCard } from 'src/sync/moveCard';
import { canApply, Choice } from 'src/sync/review';
import { importCandidates, SyncPlan } from 'src/sync/sources';
import { NoteIO, SyncOutcome } from 'src/sync/syncContact';
import { FlowResult, syncFlow } from 'src/sync/syncFlow';
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
async function relationContext(adapter: AdapterInterface, notes: { name: string; uid: string }[]): Promise<RelationContext> {
  const metas = await adapter.getMetaList();
  const remote = (Array.isArray(metas) ? metas : []).flatMap((meta: VCardMeta) => {
    const fileName = contactFileName(meta.n, meta.fn);
    return meta.uid && fileName ? [{ uid: cleanUid(meta.uid), fileName }] : [];
  });
  return {
    uidToName(uid) {
      const id = cleanUid(uid);
      return notes.find((n) => cleanUid(n.uid) === id)?.name ?? remote.find((r) => r.uid === id)?.fileName;
    },
    resolveLink(name) {
      const note = notes.find((n) => n.name === name);
      return note ? { uid: cleanUid(note.uid) } : resolveRemoteName(name, remote);
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
  let jan: Note;
  let notes: { name: string; uid: string }[] = [];

  /** The real adapter, counting PUTs. */
  const counting: AdapterInterface = {
    ...adapter,
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
    const lookups = await relationContext(adapter, notes);
    const sources = bookList.map((b) => b.source);
    return syncFlow({
      note: note.io,
      path: `Contacts/${String(note.frontmatter.name)}.md`,
      name: String(note.frontmatter.name),
      rows: DEFAULT_MAPPING,
      sources,
      active: sources,
      defaultSource: 'radicale',
      adapterFor: (source) => (source.id === 'radicale' ? counting : bookOf(source.id).adapter),
      stateFor: (id) => bookOf(id).state,
      contexts: async () => ({ ctx: lookups, readOnlyCtx: lookups, settle: async () => {} }), // these lookups never write
      review: async (request) => {
        const { rows } = request.prepared;
        const picked =
          typeof choices === 'string'
            ? new Map(rows.filter((r) => r.changed && r.preselect === undefined).map((r) => [r.property, choices as Choice]))
            : new Map(Object.entries(choices));
        expect(canApply(rows, picked), `undecided: ${rows.filter((r) => r.changed && r.preselect === undefined).map((r) => r.property)}`).toBe(true);
        return { kind: 'apply', choices: picked, rename: false };
      },
      notify: (msg) => void notices.push(msg),
      nameTaken: () => false,
    });
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
    const props = toFriendly(parseCard(pulled.raw), DEFAULT_MAPPING, await relationContext(adapter, notes)).props;
    const uid = cleanUid(String(props.uid));
    await book.state.set(uid, { raw: pulled.raw, etag: pulled.etag ?? '', href: pulled.href ?? href });
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
    expect(Array.isArray(metas) && metas.map((m) => ({ href: m.href, uid: m.uid, fn: m.fn }))).toEqual([
      { href: JAN_HREF, uid: JAN_UID, fn: 'Jan de Vries' },
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

  it('5. children: [[Sem]] becomes RELATED;TYPE=child:urn:uuid:<sem uid> on the server', async () => {
    await putCard(`${BOOK}sem-card.vcf`, SEM_CARD);
    notes = [...notes, { name: 'Sem', uid: SEM_UID }];
    const before = unfolded(await serverCard(JAN_HREF));
    jan.frontmatter.children = ['[[Sem]]'];

    expect(await sync(jan)).toBe('pushed');
    const after = unfolded(await serverCard(JAN_HREF));
    expect(after).toContain(`RELATED;TYPE=child:urn:uuid:${SEM_UID}`);
    expect(minus(after, before).filter((l) => !isRev(l))).toEqual([`RELATED;TYPE=child:urn:uuid:${SEM_UID}`]);
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

    const server = toFriendly(parseCard(before), DEFAULT_MAPPING, await relationContext(adapter, notes)).props;
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
});
