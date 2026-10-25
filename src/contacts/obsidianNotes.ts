/**
 * Obsidian side of friendly contact notes: reading and writing a note for Sync, resolving
 * relationship links through the vault, and the card a note exports as.
 */

import { App, normalizePath, Notice, parseYaml, TAbstractFile, TFile, TFolder } from "obsidian";
import { updateFrontMatterValue } from "src/contacts/contactFrontmatter";
import { blockedNotes, convertFrontmatter, Rename, renameAllInFrontmatter, technicalKeys } from "src/contacts/convertNotes";
import { withUnfilledDates } from "src/contacts/friendly/dateLabels";
import { parseCard, serializeCard } from "src/contacts/friendly/lines";
import { noteLinkOptions } from "src/contacts/friendly/noteLinks";
import { MappingRow, syncRows } from "src/contacts/friendly/mapping";
import { photoDamagedOn, repairDamagedPhotos, repairNotePhotos } from "src/contacts/friendly/photo";
import type { MirrorEnv } from "src/contacts/relationMirror";
import { linkTarget, RelationContext, resolveRemoteName } from "src/contacts/friendly/relations";
import { hasFixedNoteName } from "src/contacts/layout";
import { CURRENT_READER, FriendlyValue, newCard, patch, readerOf, toFriendly } from "src/contacts/friendly/translate";
import { contactFileName, hasVCardValues, isContactFrontmatter, isContactNote, renderFriendlyNote } from "src/contacts/friendlyNotes";
import { getApp, getPluginDir } from "src/context/sharedAppContext";
import {
  contactDisplayName,
  contactLinktext,
  contactNameFor,
  effectiveLayout,
  moveContactFolders,
  newContactLocation,
  renameContact,
} from "src/contacts/layoutNotes";
import { moveNotice, normalizeFolder, SkippedMove } from "src/contacts/moveContacts";
import { getSettings, updateSetting } from "src/context/sharedSettingsContext";
import type { Source } from "src/settings/settings";
import { createContactFile, findContactFiles, isFileInFolder } from "src/file/file";
import { insightQueueStore } from "src/insights/insightsQueStore";
import { activeSources, adapterFor } from "src/sync/adapters";
import type { VCardRaw } from "src/sync/adapters/adapter";
import type { NoteIO } from "src/sync/syncContact";
import { sourceForExport } from "src/sync/sources";
import { createSyncState, obsidianFileStore, SyncState } from "src/sync/syncState";
import { cleanUid, generateUUID } from "src/util/vcard";

export interface ContactNote {
  file: TFile;
  uid: string | undefined;
}

export interface RemoteContact {
  uid: string;
  fileName: string;
  sourceId: string;
  href: string;
  etag: string;
  org?: string;
}

const FRONTMATTER = /^---\r?\n((?:[\s\S]*?\r?\n)?)---[ \t]*(?:\r?\n|$)/;

/** Reads and writes one contact note for Sync; only the given properties are touched. */
export function noteIO(app: App, file: TFile): NoteIO {
  return {
    async readFrontmatter() {
      // From the file itself: the metadata cache can lag behind a write made a moment ago (e.g. by the last Sync).
      const match = FRONTMATTER.exec(await app.vault.read(file));
      const parsed: unknown = match ? parseYaml(match[1]) : undefined;
      return parsed && typeof parsed === "object" ? { ...(parsed as Record<string, unknown>) } : {};
    },
    async writeProps(set: Record<string, FriendlyValue>, remove: string[]) {
      await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(set)) frontmatter[key] = value;
        for (const key of remove) delete frontmatter[key];
      });
    },
    /** Renames the contact in the layout: its folder too when the note is in one (see src/contacts/layoutNotes.ts). */
    rename(newName: string, displayName?: string) {
      return renameContact(app, file, newName, displayName);
    },
  };
}

/** Whether the file is a contact note (see `isContactNote`), judged by the metadata cache. The one check behind Sync's command, button and menu item. */
export function isContactNoteFile(app: App, file: TAbstractFile | null | undefined): file is TFile {
  if (!(file instanceof TFile)) return false;
  return isContactNote(file, app.metadataCache.getFileCache(file)?.frontmatter, getSettings().contactsFolder);
}

/** The contact notes in the contacts folder, with their UID (`uid`, or `UID` in old-style notes). */
export function contactNotes(app: App, folderPath: string = getSettings().contactsFolder): ContactNote[] {
  const folder = app.vault.getAbstractFileByPath(normalizePath(folderPath));
  if (!(folder instanceof TFolder)) return [];
  return findContactFiles(folder).flatMap((file) => {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter || !isContactFrontmatter(frontmatter)) return [];
    const uid: unknown = frontmatter.uid ?? frontmatter.UID;
    return [{ file, uid: typeof uid === "string" && uid.trim() !== "" ? uid.trim() : undefined }];
  });
}

/** Relationship mirroring against the vault: contact notes, link resolution and property writes. */
export function obsidianMirrorEnv(app: App): MirrorEnv {
  const contactFrontmatter = (file: TFile) => {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    return frontmatter && isContactFrontmatter(frontmatter) ? { ...frontmatter } : undefined;
  };
  return {
    listContacts() {
      // No contacts folder configured: mirroring stays out of the vault.
      if (getSettings().contactsFolder === "") return [];
      const folder = app.vault.getAbstractFileByPath(normalizePath(getSettings().contactsFolder));
      if (!(folder instanceof TFolder)) return [];
      return findContactFiles(folder).flatMap((file) => {
        const frontmatter = contactFrontmatter(file);
        return frontmatter ? [{ path: file.path, frontmatter }] : [];
      });
    },
    resolveLink(linkpath, fromPath) {
      const file = app.metadataCache.getFirstLinkpathDest(linkpath, fromPath);
      return file && isFileInFolder(file) && contactFrontmatter(file) ? file.path : undefined;
    },
    linkTo(targetPath, fromPath) {
      const file = app.vault.getAbstractFileByPath(targetPath);
      if (!(file instanceof TFile)) throw new Error(`Contact note not found: ${targetPath}`);
      return `[[${contactLinktext(app, file, fromPath)}]]`;
    },
    async updateProperty(path, property, fn) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(`Contact note not found: ${path}`);
      await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        const next = fn(frontmatter[property]);
        if (next === undefined) delete frontmatter[property];
        else frontmatter[property] = next;
      });
    },
  };
}

/** Old-style contact notes (vCard keys) -> friendly properties, in place; the body is untouched. */
export async function convertContactNotes(app: App): Promise<{ converted: number; moved: string[]; failed: number }> {
  const rows = getSettings().friendly.mapping;
  const moved: string[] = [];
  let converted = 0;
  let failed = 0;
  for (const { file } of contactNotes(app)) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter || (!hasVCardValues(frontmatter, rows) && technicalKeys(frontmatter).length === 0)) continue;
    try {
      await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        // Decided on the live frontmatter, not the cache.
        const result = convertFrontmatter(fm, rows);
        for (const [key, value] of Object.entries(result.set)) fm[key] = value;
        for (const key of result.remove) delete fm[key];
        if (result.moved.length > 0) moved.push(`${file.path}: ${result.moved.join(", ")}`);
      });
      converted++;
    } catch (error) {
      failed++;
      console.error(`Friendly Contacts: could not convert ${file.path}`, error);
    }
  }
  return { converted, moved, failed };
}

/** Contact notes where the renames would move a value. */
export function notesToRename(app: App, renames: Rename[]): TFile[] {
  return contactNotes(app).flatMap(({ file }) => {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const result = frontmatter ? renameAllInFrontmatter(frontmatter, renames) : undefined;
    return result && "set" in result && Object.keys(result.set).length > 0 ? [file] : [];
  });
}

/** Contact notes where a rename would land on a name that already holds a value, with those names (from the cache). */
export function renameBlockers(app: App, renames: Rename[]): { path: string; targets: string[] }[] {
  const notes = contactNotes(app).flatMap(({ file }) => {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    return fm ? [{ path: file.path, fm }] : [];
  });
  return blockedNotes(notes, renames);
}

/**
 * Applies the renames in all contact notes at once. Callers check `renameBlockers` first; a note that turns out
 * blocked at write time anyway is left unchanged and reported as failed.
 */
export async function renamePropertyInNotes(app: App, renames: Rename[]): Promise<{ renamed: number; failed: string[] }> {
  let renamed = 0;
  const failed: string[] = [];
  for (const { file } of contactNotes(app)) {
    try {
      const outcome = { value: "none" as "renamed" | "blocked" | "none" };
      await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        const result = renameAllInFrontmatter(fm, renames);
        if ("blocked" in result) outcome.value = "blocked";
        else if (Object.keys(result.set).length > 0) {
          for (const key of result.remove) delete fm[key];
          for (const [key, value] of Object.entries(result.set)) fm[key] = value;
          outcome.value = "renamed";
        }
      });
      if (outcome.value === "renamed") renamed++;
      else if (outcome.value === "blocked") failed.push(file.path);
    } catch (error) {
      failed.push(file.path);
      console.error(`Friendly Contacts: could not rename properties in ${file.path}`, error);
    }
  }
  return { renamed, failed };
}

const REMOTE_TTL_MS = 5 * 60 * 1000;
/**
 * Per source (keyed by id, url and credentials); only sources that loaded are cached, a failed one is retried.
 * `versions`: the VERSION of every card in the listing (also those without a UID or name).
 */
const remoteCache = new Map<string, { key: string; at: number; list: RemoteContact[]; versions: (string | undefined)[] }>();
/** When the user was last told that a source could not be read, so a retry does not repeat the Notice. */
const lastFailureNotice = new Map<string, number>();

export function clearRemoteContactsCache(): void {
  remoteCache.clear();
  lastFailureNotice.clear();
}

/** A failure text for the user: never the address book URL or its credentials. */
function failureText(reason: unknown, source: Source): string {
  let text = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "unknown error";
  for (const secret of [source.addressBookUrl, source.authKey]) {
    if (secret) text = text.split(secret).join("…");
  }
  return text;
}

const listingKey = (source: Source): string => JSON.stringify([source.addressBookUrl, source.authType, source.authKey]);

/** The cached listing of a source while it is fresh and its connection unchanged. */
function cachedListing(source: Source) {
  const cached = remoteCache.get(source.id);
  return cached?.key === listingKey(source) && Date.now() - cached.at < REMOTE_TTL_MS ? cached : undefined;
}

/** Reads the listing of one source and caches it; throws when it cannot be read. */
async function loadListing(source: Source): Promise<{ list: RemoteContact[]; versions: (string | undefined)[] }> {
  const metas = await adapterFor(source).getMetaList();
  if (!Array.isArray(metas)) {
    throw new Error(metas.errorMessage || (metas.status ? `HTTP ${metas.status}` : "unknown error"));
  }
  const list = metas.flatMap((meta) => {
    const fileName = contactFileName(meta.n, meta.fn);
    return meta.uid && fileName
      ? [{ uid: cleanUid(meta.uid), fileName, sourceId: source.id, href: meta.href, etag: meta.etag, org: meta.org }]
      : [];
  });
  const entry = { key: listingKey(source), at: Date.now(), list, versions: metas.map((meta) => meta.version) };
  remoteCache.set(source.id, entry);
  return entry;
}

/**
 * The vCard version of every card in the address book, from its listing: the cached one unless `fresh`.
 * Throws (a message without the URL or credentials) when the book cannot be read.
 */
export async function cardVersions(source: Source, opts: { fresh?: boolean } = {}): Promise<(string | undefined)[]> {
  const cached = opts.fresh ? undefined : cachedListing(source);
  if (cached) return cached.versions;
  try {
    return (await loadListing(source)).versions;
  } catch (error) {
    throw new Error(failureText(error, source));
  }
}

/**
 * Contacts on the servers of every active address book, with the file name they would get on import.
 * Each source is cached for 5 minutes; one that cannot be read is skipped with a Notice (at most one per 5 minutes)
 * and tried again on the next call.
 */
export async function remoteContacts(): Promise<RemoteContact[]> {
  return (await remoteContactsWithFailures()).contacts;
}

/** `remoteContacts`, plus the ids of the active sources that could not be read this time (Notice or not). */
export async function remoteContactsWithFailures(): Promise<{ contacts: RemoteContact[]; failed: string[] }> {
  const sources = activeSources();
  for (const id of remoteCache.keys()) if (!sources.some((s) => s.id === id)) remoteCache.delete(id);
  const failed: string[] = [];
  const lists = await Promise.all(
    sources.map(async (source): Promise<RemoteContact[]> => {
      const cached = cachedListing(source);
      if (cached) return cached.list;
      try {
        const { list } = await loadListing(source);
        lastFailureNotice.delete(source.id);
        return list;
      } catch (error) {
        const told = lastFailureNotice.get(source.id);
        if (told === undefined || Date.now() - told >= REMOTE_TTL_MS) {
          lastFailureNotice.set(source.id, Date.now());
          new Notice(`Could not read ${source.name}: ${failureText(error, source)}`);
        }
        failed.push(source.id);
        return [];
      }
    }),
  );
  return { contacts: lists.flat(), failed: sources.filter((s) => failed.includes(s.id)).map((s) => s.id) };
}

/**
 * Relationship lookups for one note (`sourcePath`): UIDs become link text in the vault's link format,
 * links are resolved the way Obsidian resolves them.
 */
export class ObsidianRelationContext implements RelationContext {
  private pending: Promise<void>[] = [];

  /** `readOnly`: never writes a UID to a linked note; such a link resolves like an unknown name. */
  constructor(
    private app: App,
    private sourcePath: string,
    private contacts: ContactNote[],
    private remote: RemoteContact[],
    private readOnly = false,
  ) {}

  uidToName(uid: string): string | undefined {
    const id = cleanUid(uid);
    const note = this.contacts.find((c) => c.uid !== undefined && cleanUid(c.uid) === id);
    if (note) return contactLinktext(this.app, note.file, this.sourcePath, true);
    return this.remoteName(id);
  }

  displayName(uid: string): string | undefined {
    const id = cleanUid(uid);
    const note = this.contacts.find((c) => c.uid !== undefined && cleanUid(c.uid) === id);
    return note ? contactDisplayName(this.app, note.file) : this.remoteName(id);
  }

  /** The name of a contact known only on the server; a contact in several address books under different names has none. */
  private remoteName(id: string): string | undefined {
    const names = new Set(this.remote.filter((r) => r.uid === id).map((r) => r.fileName));
    return names.size === 1 ? [...names][0] : undefined;
  }

  /**
   * The contact note a link target names, as Obsidian resolves it. When Obsidian finds no note at all (a contact in
   * its own folder is not found by its name, its note is `index`): the one contact note with that display name.
   * `ambiguous` for several; none for a link to a note that is no contact note.
   */
  private findContactNote(name: string): { note?: ContactNote; ambiguous?: true } {
    const dest = this.app.metadataCache.getFirstLinkpathDest(name, this.sourcePath);
    if (dest) return { note: this.contacts.find((c) => c.file.path === dest.path) };
    const wanted = name.trim().toLowerCase();
    const named = this.contacts.filter((c) => contactDisplayName(this.app, c.file).trim().toLowerCase() === wanted);
    return named.length > 1 ? { ambiguous: true } : { note: named[0] };
  }

  /**
   * A link target as Obsidian resolves it (see `findContactNote`). Else (also for a link to a note that is no
   * contact note) the address book listing.
   */
  resolveLink(name: string): { uid: string } | { text: string } | { ambiguous: true } {
    const { note, ambiguous } = this.findContactNote(name);
    if (ambiguous) return { ambiguous: true };
    if (!note || (note.uid === undefined && this.readOnly)) return resolveRemoteName(name, this.remote);
    if (note.uid === undefined) {
      // Like the UID processor: a contact that gets linked needs an identity.
      note.uid = `urn:uuid:${generateUUID()}`;
      this.pending.push(updateFrontMatterValue(note.file, "UID", note.uid));
    }
    return { uid: cleanUid(note.uid) };
  }

  /** The contact note a link target names, for a link to it on a card: no UID needed, nothing written. */
  contactNote(target: string): { path: string; name: string } | undefined {
    const { note } = this.findContactNote(target);
    return note ? { path: note.file.path, name: contactDisplayName(this.app, note.file) } : undefined;
  }

  /** Waits for the UIDs assigned while resolving links to be written. */
  async settle(): Promise<void> {
    const results = await Promise.allSettled(this.pending.splice(0));
    for (const result of results) {
      if (result.status === "rejected") {
        new Notice(`Could not save a new contact UID: ${String(result.reason)}`);
      }
    }
  }
}

export async function relationContextFor(app: App, sourcePath: string): Promise<ObsidianRelationContext> {
  return new ObsidianRelationContext(app, sourcePath, contactNotes(app), await remoteContacts());
}

/**
 * The lookups Sync needs for one note: `ctx` may give a linked contact note its UID (used at Apply; call
 * `settle()` afterwards), `readOnlyCtx` never writes (used to prepare the review).
 */
export async function syncRelationContexts(
  app: App,
  sourcePath: string,
): Promise<{ ctx: ObsidianRelationContext; readOnlyCtx: ObsidianRelationContext; unreadable: string[] }> {
  const contacts = contactNotes(app);
  const { contacts: remote, failed } = await remoteContactsWithFailures();
  return {
    ctx: new ObsidianRelationContext(app, sourcePath, contacts, remote),
    readOnlyCtx: new ObsidianRelationContext(app, sourcePath, contacts, remote, true),
    /** Ids of the active address books whose contact list could not be read. */
    unreadable: failed,
  };
}

/** Contact notes and remote contacts, gathered once for a batch (e.g. an export of many notes). */
export interface ContactLookups {
  contacts: ContactNote[];
  remote: RemoteContact[];
}

export async function contactLookups(app: App): Promise<ContactLookups> {
  return { contacts: contactNotes(app), remote: await remoteContacts() };
}

const sharedStates = new Map<string, SyncState>();

/** The sync-state store of one source (its writes are queued, so every caller must share it). */
export function contactSyncState(sourceId: string, app: App = getApp()): SyncState {
  const dir = `${getPluginDir()}/sync-state/${sourceId}`;
  let state = sharedStates.get(dir);
  if (!state) {
    state = createSyncState(obsidianFileStore(app), dir);
    sharedStates.set(dir, state);
  }
  return state;
}

/**
 * The vCard a friendly note exports as: the last synced card patched with the note, else a new card.
 * Read-only: exporting never writes to the vault.
 */
export async function friendlyNoteCard(
  app: App,
  file: TFile,
  props: Record<string, FriendlyValue>,
  rows: MappingRow[],
  lookups: ContactLookups,
): Promise<string> {
  const ctx = new ObsidianRelationContext(app, file.path, lookups.contacts, lookups.remote, true);
  const uid = typeof props.uid === "string" ? props.uid.trim() : "";
  // Export works without sync enabled: the note's own book is used even when it is not active (see sourceForExport).
  const noteSource = app.metadataCache.getFileCache(file)?.frontmatter?.source;
  const source = uid === "" ? undefined : await sourceForExport(
    noteSource === undefined || noteSource === null ? undefined : String(noteSource),
    getSettings(),
    async (sourceId) => (await contactSyncState(sourceId, app).get(uid)) !== undefined,
  );
  const base = uid !== "" && source ? await contactSyncState(source.id, app).get(uid) : undefined;
  let lines;
  // A damaged photo (one an earlier version wrote into the note, or in an old base) is put right as Sync does: the
  // base's photo, or none (see repairNotePhotos).
  const baseLines = base ? repairDamagedPhotos(parseCard(base.raw), []).lines : [];
  const noteProps = repairNotePhotos(props, baseLines).props;
  if (base) {
    // Read the way it was stored, so lines an older reader ignored are not taken for relationships removed in the note.
    const reader = readerOf(base.reader);
    const before = toFriendly(baseLines, rows, ctx, { reader, ownVaults: noteLinkOptions(getSettings().noteLinks).ownVaults });
    // A date with a label added after the base was stored, or a part an older reader did not read, may never have
    // been filled into the note: not a removal.
    lines = patch(baseLines, before, withUnfilledDates(noteProps, before.props, rows, base, reader), rows, ctx).lines;
  } else {
    lines = newCard(noteProps, rows, ctx).lines;
  }
  return serializeCard(lines);
}

/**
 * Creates a friendly contact note from one card in the contacts folder.
 * Returns the card's UID ('' when it has none) and whether the note now holds this card, or undefined
 * when the card has no name. An existing file is only replaced when the user says so, maybe later.
 * `rows`: the rows the card is read with. Import from an address book passes `syncRows` (a property with Sync off is
 * not imported); a .vcf file import passes the stored rows (every property). The note is rendered with the stored
 * rows either way. `extra` (e.g. `{ source }`) is written into the frontmatter after the mapped properties.
 */
export async function importCard(
  app: App,
  card: string,
  rows: MappingRow[],
  extra: Record<string, FriendlyValue> = {},
): Promise<{ uid: string; written: boolean; path?: string } | undefined> {
  const { contactsFolder, defaultHashtag, friendly } = getSettings();
  const lines = parseCard(card);
  const value = (name: string) => lines.find((line) => line.name === name)?.value;
  const fileName = contactFileName(value("N"), value("FN"));
  if (!fileName) return undefined;
  const ctx = await relationContextFor(app, normalizePath(newContactLocation(app, fileName, contactsFolder).note));
  const props = { ...toFriendly(lines, rows, ctx, { ownVaults: noteLinkOptions(getSettings().noteLinks).ownVaults }).props, ...extra };
  const content = renderFriendlyNote(props, defaultHashtag, friendly.mapping);
  const path = await createContactFile(app, contactsFolder, content, `${fileName}.md`);
  const written = path !== undefined && (await app.vault.adapter.exists(path)) && (await app.vault.adapter.read(path)) === content;
  return { uid: cleanUid(value("UID")), written, path };
}

/** 'skipped': a note with that name exists and was kept (the user chose Skip or closed the dialog); 'unnamed': the card has no name. */
export type ImportOutcome = "imported" | "skipped" | "unnamed";

/**
 * Imports a card pulled from `source`: the note gets `source: <name>` and the card is that source's base for the next
 * Sync. `relinkLater`: a bulk import collects the new notes there and calls `relinkImported` once at the end, instead
 * of relinking after each card (a note imported a moment ago may not be in the metadata cache yet).
 */
export async function importRemoteCard(
  app: App,
  pulled: VCardRaw,
  meta: { href: string; etag?: string },
  source: Source,
  options: { relinkLater?: { uid: string; path: string }[] } = {},
): Promise<ImportOutcome> {
  // A photo the server damaged holds no image: neither the note nor the base gets it (see repairDamagedPhotos).
  const sent = parseCard(pulled.raw);
  const { lines, repaired } = repairDamagedPhotos(sent, []);
  const raw = repaired ? serializeCard(lines) : pulled.raw;
  // A property with Sync off is not imported (see syncRows).
  const imported = await importCard(app, raw, syncRows(getSettings().friendly.mapping), { source: source.name });
  if (!imported) return "unnamed";
  // Only a note that holds this card may get its base; an existing (skipped) note keeps syncing without one.
  if (imported.uid !== "" && imported.written) {
    await contactSyncState(source.id, app).set(imported.uid, {
      raw,
      etag: pulled.etag || meta.etag || "",
      href: pulled.href || meta.href,
      reader: CURRENT_READER,
      ...(photoDamagedOn(sent, false) ? { photoDamaged: true } : {}),
    });
  }
  if (imported.written && imported.path !== undefined && hasFixedNoteName(effectiveLayout())) {
    // Relationships to this contact that had no note to point to can point to this one now. Only with a fixed note
    // name: a note named for the contact is found by the plain `[[Name]]` already. All imports end up here.
    if (options.relinkLater) options.relinkLater.push({ uid: imported.uid, path: imported.path });
    else await relinkNewContact(app, imported.uid, imported.path);
  }
  return imported.written ? "imported" : "skipped";
}

/**
 * The note just written to `path` once the vault and its metadata cache know it (they learn about a file written
 * through the adapter a moment later); undefined, with a warning, when that takes longer than 2 seconds.
 */
async function settledNote(app: App, path: string): Promise<TFile | undefined> {
  const ready = () => {
    const file = app.vault.getAbstractFileByPath(path);
    return file instanceof TFile && app.metadataCache.getFileCache(file)?.frontmatter ? file : undefined;
  };
  let file = ready();
  for (let tries = 0; file === undefined && tries < 20; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    file = ready();
  }
  if (file === undefined) console.warn(`Friendly Contacts: relationships not linked to ${path}: the vault did not show the note within 2 seconds`);
  return file;
}

/** `relinkAfterImport` for a note just written to `path`; a failure is logged, never fails the import. */
async function relinkNewContact(app: App, uid: string, path: string): Promise<void> {
  try {
    const file = await settledNote(app, path);
    if (file === undefined) return;
    const count = await relinkAfterImport(app, uid, file);
    if (count > 0) new Notice(`Linked ${count} relationship${count === 1 ? "" : "s"} to ${contactNameFor(app, file)}.`);
  } catch (error) {
    console.error("Friendly Contacts: could not link relationships to the imported contact", error);
  }
}

/**
 * After a bulk import (see `importRemoteCard`'s `relinkLater`): one relink pass over every contact imported, once
 * all their notes are in the metadata cache, so relationships between contacts of the same import are found too.
 * Returns the number of entries changed; a failure is logged, never fails the import.
 */
export async function relinkImported(app: App, imported: { uid: string; path: string }[]): Promise<number> {
  const files = new Map<string, TFile>();
  for (const { path } of imported) {
    const file = await settledNote(app, path);
    if (file) files.set(path, file);
  }
  let count = 0;
  for (const { uid, path } of imported) {
    const file = files.get(path);
    if (!file) continue;
    try {
      count += await relinkAfterImport(app, uid, file);
    } catch (error) {
      console.error(`Friendly Contacts: could not link relationships to ${path}`, error);
    }
  }
  if (count > 0) new Notice(`Linked ${count} relationship${count === 1 ? "" : "s"} to the imported contacts.`);
  return count;
}

/**
 * After the contact with `uid` was imported as `file`: relationship entries in contact notes that point to no note
 * but whose name is this contact on the server become links to `file` (an alias the user wrote is kept). Other
 * links, and everything but the relationship properties, are left alone. Returns the number of entries changed.
 */
export async function relinkAfterImport(app: App, uid: string, file: TFile): Promise<number> {
  const id = cleanUid(uid);
  if (id === "") return 0;
  const remote = await remoteContacts();
  const relationProperties = getSettings().friendly.mapping.flatMap((row) => (row.kind === "relation" ? [row.property] : []));
  /** The entry as it should be now, or undefined when it stays. */
  const relinked = (entry: unknown, notePath: string): string | undefined => {
    if (typeof entry !== "string") return undefined;
    const name = linkTarget(entry.trim()).trim();
    if (name === "" || app.metadataCache.getFirstLinkpathDest(name, notePath)) return undefined;
    const resolved = resolveRemoteName(name, remote);
    if (!("uid" in resolved) || resolved.uid !== id) return undefined;
    const linktext = contactLinktext(app, file, notePath, true);
    const alias = /^\[\[[^|\]]*\|([^\]]+)\]\]$/.exec(entry.trim())?.[1];
    return `[[${alias === undefined ? linktext : `${linktext.split("|")[0]}|${alias}`}]]`;
  };
  let count = 0;
  for (const { file: note } of contactNotes(app)) {
    if (note.path === file.path) continue;
    const cached = app.metadataCache.getFileCache(note)?.frontmatter;
    const needs = relationProperties.some((property) => {
      const value: unknown = cached?.[property];
      return (Array.isArray(value) ? value : [value]).some((entry) => relinked(entry, note.path) !== undefined);
    });
    if (!needs) continue;
    try {
      await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
        for (const property of relationProperties) {
          const value = fm[property];
          if (Array.isArray(value)) {
            fm[property] = value.map((entry: unknown) => {
              const next = relinked(entry, note.path);
              if (next !== undefined) count++;
              return next ?? entry;
            });
          } else {
            const next = relinked(value, note.path);
            if (next !== undefined) {
              fm[property] = next;
              count++;
            }
          }
        }
      });
    } catch (error) {
      console.error(`Friendly Contacts: could not link relationships in ${note.path}`, error);
    }
  }
  return count;
}

/**
 * Moves every contact in the contacts folder to `toFolder`, then points the setting at it. A contact in its own folder
 * moves with its whole folder, in every layout (also one made with other settings, see `moveContactFolders`).
 */
export async function moveContacts(
  app: App,
  toFolder: string,
  fromFolder: string = getSettings().contactsFolder,
): Promise<{ moved: number; skipped: SkippedMove[] }> {
  const from = normalizeFolder(fromFolder);
  const to = normalizeFolder(toFolder);
  const { moved, skipped } = await moveContactFolders(app, contactNotes(app, from).map(({ file }) => file), from, to);
  // Only follow the contacts when some actually moved; otherwise the plugin would look in an empty folder.
  if (moved > 0) {
    await updateSetting("contactsFolder", to);
    insightQueueStore.clear();
  }
  return { moved, skipped };
}

/** Tells the owner what a move did; skipped files are listed in the console. */
export function reportMove(result: { moved: number; skipped: SkippedMove[] }, toFolder: string): void {
  const { moved, skipped } = result;
  if (skipped.length > 0) {
    console.log("Friendly Contacts: skipped while moving contacts:\n" + skipped.map((s) => `${s.from}: ${s.reason}`).join("\n"));
  }
  new Notice(moveNotice(moved, skipped.length, toFolder));
}
