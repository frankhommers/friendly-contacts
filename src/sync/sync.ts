import {computed} from "@preact/signals-core";
import {App, normalizePath, Notice, TFile} from "obsidian";
import {Contact} from "src/contacts";
import {hasVCardValues} from "src/contacts/friendlyNotes";
import {linkTarget, relationSnapshot} from "src/contacts/friendly/relations";
import {
  contactNotes,
  contactSyncState,
  importRemoteCard,
  noteIO,
  obsidianMirrorEnv,
  RemoteContact,
  remoteContacts,
  syncRelationContexts,
} from "src/contacts/obsidianNotes";
import {getApp} from "src/context/sharedAppContext";
import { getSettings } from "src/context/sharedSettingsContext";
import { mirrorRelationsOnThisDevice } from "src/settings/deviceSettings";
import { Source } from "src/settings/settings";
import { activeSources, adapterFor, isSyncAvailable } from "src/sync/adapters";
import { AdapterInterface } from "src/sync/adapters/adapterInterface";
import {VCardMeta, VCardRaw} from "src/sync/adapters/adapter";
import {BaseHolder, noteSourceId} from "src/sync/sources";
import {ReviewRow} from "src/sync/review";
import {FlowResult, ReviewDecision, ReviewRequest, syncFlow, SyncFlowDeps} from "src/sync/syncFlow";
import {SyncReviewModal} from "src/ui/modals/syncReviewModal";
import {AppHttpResponse} from "src/util/platformHttpClient";
import {cleanUid} from "src/util/vcard";

export const enabled = computed(() => isSyncAvailable());

/** The note's `source:` name; undefined when the property is missing or empty. */
function sourceProperty(frontmatter: Record<string, unknown>): string | undefined {
  const value = frontmatter.source;
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

type NoteSource = { source: Source; explicit: boolean; active: Source[]; baseIn: BaseHolder[] };

/**
 * The active source a note syncs with: its `source:` (never a fallback when that is unknown or disabled), else the
 * active source holding a sync base for its UID, else the default source.
 */
async function resolveNoteSource(app: App, frontmatter: Record<string, unknown>, uid: string): Promise<NoteSource | { error: string }> {
  const active = activeSources();
  if (active.length === 0) return { error: 'Sync is not set up' };
  const named = sourceProperty(frontmatter);
  const settings = getSettings();
  const baseIn: string[] = [];
  if (uid !== '') {
    // Active sources first; a base only in a disabled source makes noteSourceId refuse rather than pick the default.
    const inactive = settings.sources.filter((s) => !active.some((a) => a.id === s.id));
    for (const source of [...active, ...inactive]) {
      if (await contactSyncState(source.id, app).get(uid)) baseIn.push(source.id);
    }
  }
  const resolved = noteSourceId(named, settings.sources, baseIn, settings.defaultSource);
  if ('error' in resolved) return resolved;
  const source = active.find((s) => s.id === resolved.id);
  if (!source) return { error: 'Sync is not set up' };
  const holders = baseIn.map((id) => ({ id, active: active.some((a) => a.id === id) }));
  return { source, explicit: named !== undefined, active, baseIn: holders };
}

function hasUidMatch(remoteContact:VCardMeta, currentContacts: Contact[]) {
  const uid = remoteContact.uid;
  if(uid === undefined) {
    return false;
  }
  return currentContacts.some(contact =>  cleanUid(contact.data['UID']) === cleanUid(uid));
}

function hasFnMatch(remoteContact: VCardMeta, currentContacts: Contact[]) {
  const fn = remoteContact.fn;
  if(fn === undefined) {
    return false;
  }
  return currentContacts.some(contact => contact.data['FN'] === fn);
}

/** A card on a server that has no note yet, with the source it was found in. */
export type UnknownRemote = VCardMeta & { sourceId: string };

/** Cards on the servers of every active address book that match no note by UID or name. */
export async function getUnknownFromRemote(currentContacts: Contact[]): Promise<UnknownRemote[]> {
  const unknown: UnknownRemote[] = [];
  for (const source of activeSources()) {
    const list = await adapterFor(source).getMetaList();
    if ('errorMessage' in list) {
      new Notice(`${source.name}: ${list.errorMessage}`);
      continue;
    }
    for (const meta of list) {
      if (!hasUidMatch(meta, currentContacts) && !hasFnMatch(meta, currentContacts)) {
        unknown.push({ ...meta, sourceId: source.id });
      }
    }
  }
  return unknown;
}

/** Deletes the contact's card on the server and forgets its sync state; true when deleted. */
export async function deleteOnRemote(contact: Contact): Promise<boolean> {
  const uid = cleanUid(contact.data['UID']);
  if (!uid) {
    new Notice(`${contact.file.basename} has no UID; there is no card on the server to delete.`);
    return false;
  }
  const app = getApp();
  // Only in the note's own source; never in another one that happens to hold the UID.
  const resolved = await resolveNoteSource(app, await noteIO(app, contact.file).readFrontmatter(), uid);
  if ('error' in resolved) {
    new Notice(`Not deleting ${contact.file.basename}: ${resolved.error}.`);
    return false;
  }
  const sourceId = resolved.source.id;
  const adapter = adapterFor(resolved.source);
  const meta = await getMetaByUID(adapter, uid);
  if (!meta) {
    new Notice(`${contact.file.basename} was not found in ${resolved.source.name}.`);
    return false;
  }
  if (cleanUid(meta.uid) !== uid) {
    // Never delete a card that is not exactly this contact's.
    new Notice(`Not deleting: the server card found for ${contact.file.basename} has another UID (${meta.uid ?? 'none'}).`);
    return false;
  }
  if (!meta.etag) {
    new Notice(`Not deleting ${contact.file.basename}: the server sent no ETag, so the delete cannot be made safe.`);
    return false;
  }
  const res = await adapter.delete(meta.href, meta.etag);
  if (res.status === 412) {
    new Notice(`Not deleted: ${contact.file.basename} was changed on the server in the meantime. Sync it and try again.`);
    return false;
  }
  if (res.errorMessage || res.status < 200 || res.status >= 300) {
    new Notice(res.errorMessage || res.data || `Delete failed: HTTP ${res.status}`);
    return false;
  }
  await contactSyncState(sourceId).remove(uid);
  new Notice(`Deleted ${contact.file.basename} from ${resolved.source.name}; the note stays.`);
  return true;
}

/** Notes with a Sync in progress; a second Sync of the same note would merge against a stale read. */
const running = new Set<string>();

/** One Sync of a contact note with its card on the server, through the review screen (see src/sync/syncFlow.ts). */
export async function syncContact(file: TFile): Promise<FlowResult | undefined> {
  const key = file.path;
  if (running.has(key)) {
    new Notice(`Sync already running for ${file.basename}.`);
    return undefined;
  }
  running.add(key);
  try {
    return await runSync(file);
  } catch (error) {
    new Notice(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  } finally {
    running.delete(key);
  }
}

/** Obsidian wiring around syncFlow: the note, the address books, the review modal and Notices. */
async function runSync(file: TFile): Promise<FlowResult | undefined> {
  const app = getApp();
  const settings = getSettings();
  const rows = settings.friendly.mapping;
  const note = noteIO(app, file);
  const name = file.basename;
  if (hasVCardValues(await note.readFrontmatter(), rows)) {
    // Sync reads only friendly properties: a UID kept in `UID` is not seen, and syncing would create a second card.
    new Notice(`${name} still has vCard properties (FN, UID, TEL[CELL], ...). Run "Convert contacts to friendly properties" first, then sync.`);
    return undefined;
  }
  const deps: SyncFlowDeps = {
    note,
    path: file.path,
    name,
    rows,
    sources: settings.sources,
    active: activeSources(),
    defaultSource: settings.defaultSource,
    adapterFor,
    stateFor: (id) => contactSyncState(id, app),
    contexts: async () => {
      const { ctx, readOnlyCtx } = await syncRelationContexts(app, file.path);
      return { ctx, readOnlyCtx, settle: () => ctx.settle() };
    },
    review: (request) => openReview(app, file, request),
    notify: (message) => new Notice(message),
    mirror: mirrorLookup(app, file),
    nameTaken: (basename) => {
      const folder = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : "";
      const existing = app.vault.getAbstractFileByPath(normalizePath(`${folder}${basename}.${file.extension}`));
      return existing !== null && existing !== file;
    },
  };
  return syncFlow(deps);
}

/** Opens the review modal; resolves once with Apply, Cancel (or Escape) or "reopen" after an Import. */
async function openReview(app: App, file: TFile, request: ReviewRequest): Promise<ReviewDecision> {
  const serverOnly = await serverOnlyLookup(app, file);
  return new Promise((resolve) => {
    new SyncReviewModal(
      app,
      {
        ...request,
        serverOnly,
        onReopen: () => resolve({ kind: 'reopen' }),
        onCancel: () => resolve({ kind: 'cancel' }),
      },
      (choices, rename) => resolve({ kind: 'apply', choices, rename }),
    ).open();
  });
}

/** Relationship mirroring as it runs on this device, for "Also changes"; undefined when it does not run here. */
function mirrorLookup(app: App, file: TFile): SyncFlowDeps['mirror'] {
  if (!mirrorRelationsOnThisDevice(app) || getSettings().contactsFolder === '') return undefined;
  const env = obsidianMirrorEnv(app);
  const rows = getSettings().friendly.mapping;
  let contacts: Map<string, Record<string, unknown>> | undefined;
  const frontmatterOf = (path: string) => {
    contacts ??= new Map(env.listContacts().map((c) => [c.path, c.frontmatter]));
    return contacts.get(path);
  };
  return {
    resolveLink: (linkpath) => env.resolveLink(linkpath, file.path),
    snapshotOf: (path) => {
      const frontmatter = frontmatterOf(path);
      return frontmatter && relationSnapshot(frontmatter, rows, (link) => env.resolveLink(link, path));
    },
    nameOf: (path) => {
      const found = app.vault.getAbstractFileByPath(path);
      return found instanceof TFile ? found.basename : (path.split('/').pop() ?? path).replace(/\.md$/i, '');
    },
  };
}

/**
 * The relationship targets of a row that exist only on the server: a link that resolves to no note but to
 * exactly one card (by name) whose UID has no note yet. `import` makes that card a note.
 */
async function serverOnlyLookup(app: App, file: TFile): Promise<(row: ReviewRow) => { name: string; import(): Promise<void> }[]> {
  const remote = await remoteContacts();
  const known = new Set(contactNotes(app).flatMap(({ uid }) => (uid === undefined ? [] : [cleanUid(uid)])));
  return (row) => {
    if (row.kind !== 'relation' || row.server === undefined) return [];
    const items = Array.isArray(row.server) ? row.server : [row.server];
    return items.flatMap((item) => {
      const name = linkTarget(item.trim());
      if (name === '' || app.metadataCache.getFirstLinkpathDest(name, file.path)) return [];
      const cards = remote.filter((r) => r.fileName === name && !known.has(r.uid));
      // Unknown, or two different people with this name: nothing to offer.
      if (new Set(cards.map((c) => c.uid)).size !== 1) return [];
      return [{ name, import: () => importServerOnly(app, cards[0]) }];
    });
  };
}

async function importServerOnly(app: App, card: RemoteContact): Promise<void> {
  const source = activeSources().find((s) => s.id === card.sourceId);
  if (!source) throw new Error("that address book is no longer enabled");
  const pulled = await pullFromRemote(source, card.href);
  if (!pulled) throw new Error(`could not read ${card.fileName} from ${source.name}`);
  const outcome = await importRemoteCard(app, pulled, card, source);
  if (outcome === "skipped") throw new Error(`a note named ${card.fileName} already exists`);
  if (outcome === "unnamed") throw new Error("the card has no name");
  new Notice(`Imported ${card.fileName} from ${source.name}.`);
}

/** Pulls one card from the server of the given address book. */
export async function pullFromRemote(source: Source, href: string): Promise<VCardRaw | undefined> {
  const remoteRaw = await adapterFor(source).pull(href);

  if (remoteRaw && "errorMessage" in remoteRaw) {
    new Notice(remoteRaw.errorMessage);
    return;
  }
  return remoteRaw;
}


async function getMetaByUID(adapter: AdapterInterface, uid: string): Promise<VCardMeta | undefined> {
  const res: VCardMeta | AppHttpResponse | undefined = await adapter.getMetaByUid(uid);
  if (res && "errorMessage" in res && res.errorMessage) {
    new Notice(res.errorMessage);
    return undefined;
  }
  return res as VCardMeta | undefined;
}
