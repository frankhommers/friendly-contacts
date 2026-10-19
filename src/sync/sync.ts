import {computed} from "@preact/signals-core";
import {App, Notice} from "obsidian";
import {Contact} from "src/contacts";
import {hasVCardValues} from "src/contacts/friendlyNotes";
import {coerceNoteProps} from "src/contacts/friendly/merge";
import {contactSyncState, noteIO, syncRelationContexts} from "src/contacts/obsidianNotes";
import {getApp} from "src/context/sharedAppContext";
import { getSettings } from "src/context/sharedSettingsContext";
import { Source } from "src/settings/settings";
import { activeSources, adapterFor, isSyncAvailable } from "src/sync/adapters";
import { AdapterInterface } from "src/sync/adapters/adapterInterface";
import {VCardMeta, VCardRaw} from "src/sync/adapters/adapter";
import {BaseHolder, CardLocation, noteSourceId, planSync, SyncPlan} from "src/sync/sources";
import {canApply, Choice, resultProps} from "src/sync/review";
import {applySync, locateCard, NoteIO, prepareSync, SyncOutcome} from "src/sync/syncContact";
import {ConfirmModal} from "src/ui/modals/confirmModal";
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

/** The note's uid as Sync reads it ('' when there is none). */
function noteUid(frontmatter: Record<string, unknown>): string {
  const uid = coerceNoteProps(frontmatter, getSettings().friendly.mapping).props.uid;
  return typeof uid === 'string' ? uid.trim() : '';
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

function confirmMove(app: App, title: string): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, title, 'Move', () => resolve(true), 'Cancel', () => resolve(false)).open();
  });
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

const OUTCOME_TEXT: Record<Exclude<SyncOutcome, 'failed'>, string> = {
  unchanged: 'already in sync',
  pulled: 'updated from the server',
  pushed: 'sent to the server',
  both: 'updated from and sent to the server',
  created: 'created on the server',
};

/** Notes with a Sync in progress; a second Sync of the same note would merge against a stale read. */
const running = new Set<string>();

/** One Sync of a contact note with its card on the server (see src/sync/syncContact.ts). */
export async function syncContact(contact: Contact): Promise<SyncOutcome | undefined> {
  const key = contact.file.path;
  if (running.has(key)) {
    new Notice(`Sync already running for ${contact.file.basename}.`);
    return undefined;
  }
  running.add(key);
  try {
    return await runSync(contact);
  } catch (error) {
    new Notice(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  } finally {
    running.delete(key);
  }
}

async function runSync(contact: Contact): Promise<SyncOutcome | undefined> {
  const app = getApp();
  const rows = getSettings().friendly.mapping;
  const note = noteIO(app, contact.file);
  const name = contact.file.basename;
  const frontmatter = await note.readFrontmatter();
  if (hasVCardValues(frontmatter, rows)) {
    // Sync reads only friendly properties: a UID kept in `UID` is not seen, and syncing would create a second card.
    new Notice(`${name} still has vCard properties (FN, UID, TEL[CELL], ...). Run "Convert contacts to friendly properties" first, then sync.`);
    return undefined;
  }

  const uid = noteUid(frontmatter);
  const resolved = await resolveNoteSource(app, frontmatter, uid);
  if ('error' in resolved) {
    new Notice(`Not syncing ${name}: ${resolved.error}.`);
    return undefined;
  }
  const { source, explicit, active, baseIn } = resolved;
  const byId = (id: string) => active.find((s) => s.id === id);
  // A disabled book can be named too (a base may be held there).
  const sourceName = (id: string) => getSettings().sources.find((s) => s.id === id)?.name ?? id;

  let plan: SyncPlan = { kind: 'sync', sourceId: source.id };
  if (uid !== '') {
    // Before anything is created or moved, every active source is searched for the exact UID.
    const { found, failed } = await locateCard(active.map((s) => ({ sourceId: s.id, adapter: adapterFor(s) })), uid);
    if (failed.length > 0 && !found.some((f) => f.sourceId === source.id)) {
      const which = failed.map((f) => `${sourceName(f.sourceId)} (${f.message})`).join(', ');
      new Notice(`Not syncing ${name}: could not search ${which}, and the card could be there.`);
      return 'failed';
    }
    plan = planSync({ id: source.id, explicit }, found, sourceName, baseIn);
  }

  switch (plan.kind) {
    case 'refuse':
      new Notice(`Not syncing ${name}: ${plan.message}`);
      return undefined;
    case 'sync':
    case 'adopt': {
      const target = byId(plan.sourceId);
      if (!target) return undefined;
      const outcome = await syncWith(app, contact.file.path, note, name, target);
      if (outcome !== undefined && outcome !== 'failed') {
        new Notice(`${name}: ${OUTCOME_TEXT[outcome]}${active.length > 1 ? ` (${target.name})` : ''}.`);
      }
      return outcome;
    }
    case 'move': {
      const from = byId(plan.from.sourceId);
      const to = byId(plan.to);
      if (!from || !to) return undefined;
      if (!(await confirmMove(app, `Move ${name} from ${from.name} to ${to.name}?`))) return undefined;
      const move = { from: plan.from, adapter: adapterFor(from), state: contactSyncState(from.id, app) };
      return syncWith(app, contact.file.path, note, name, to, move, from.name);
    }
  }
}

/**
 * Interim bridge until the review screen is wired in: prepare, then apply the preselected choices when no row
 * needs a decision; with a conflict nothing is written.
 */
async function syncWith(
  app: App,
  path: string,
  note: NoteIO,
  name: string,
  target: Source,
  move?: { from: CardLocation; adapter: AdapterInterface; state: ReturnType<typeof contactSyncState> },
  fromName?: string,
): Promise<SyncOutcome | undefined> {
  const { ctx, readOnlyCtx } = await syncRelationContexts(app, path);
  const deps = {
    adapter: adapterFor(target),
    state: contactSyncState(target.id, app),
    rows: getSettings().friendly.mapping,
    ctx,
    readOnlyCtx,
    notify: (message: string) => new Notice(message),
  };
  try {
    const prepared = await prepareSync(note, deps, { sourceId: target.id, move });
    if (prepared.kind === 'failed') {
      new Notice(`Sync failed: ${prepared.message}`);
      return 'failed';
    }
    if (prepared.kind === 'upToDate') {
      new Notice(`${name}: Up to date`);
      return 'unchanged';
    }
    const choices = new Map<string, Choice>();
    if (!canApply(prepared.prepared.rows, choices)) {
      new Notice(`${name}: conflicts need the review screen; nothing was synced.`);
      return undefined;
    }
    const R = resultProps(prepared.prepared.rows, choices, prepared.prepared.server?.friendly.props ?? {});
    const result = await applySync(prepared.prepared, R, note, deps, { sourceName: target.name });
    switch (result.kind) {
      case 'stale':
        new Notice(result.reason === 'server' ? `${name} changed on the server meanwhile` : `${name} changed while reviewing`);
        return undefined;
      case 'failed':
        new Notice(move ? `Not moved: ${name}: ${result.message}.` : `Sync failed: ${result.message}`);
        return 'failed';
      case 'done':
        if (move) {
          new Notice(
            result.oldKept
              ? `Moved ${name} to ${target.name}, but the old copy is still in ${fromName}; delete it there by hand.`
              : `Moved ${name} to ${target.name}.`,
          );
        }
        return result.outcome;
    }
  } finally {
    // UIDs given to linked contact notes while Apply built the card are written (or reported) before returning.
    await ctx.settle();
  }
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
