/**
 * Obsidian side of friendly contact notes: reading and writing a note for Sync, resolving
 * relationship links through the vault, and the card a note exports as.
 */

import { App, normalizePath, Notice, parseYaml, TFile, TFolder } from "obsidian";
import { updateFrontMatterValue } from "src/contacts/contactFrontmatter";
import { convertFrontmatter, Rename, renameAllInFrontmatter, technicalKeys } from "src/contacts/convertNotes";
import { parseCard, serializeCard } from "src/contacts/friendly/lines";
import { MappingRow } from "src/contacts/friendly/mapping";
import type { MirrorEnv } from "src/contacts/relationMirror";
import { RelationContext, resolveRemoteName } from "src/contacts/friendly/relations";
import { FriendlyValue, newCard, patch, toFriendly } from "src/contacts/friendly/translate";
import { contactFileName, hasVCardValues, isContactFrontmatter, renderFriendlyNote } from "src/contacts/friendlyNotes";
import { getApp, getPluginDir } from "src/context/sharedAppContext";
import { moveNotice, normalizeFolder, planMoves, SkippedMove } from "src/contacts/moveContacts";
import { getSettings, updateSetting } from "src/context/sharedSettingsContext";
import type { Source } from "src/settings/settings";
import { createContactFile, findContactFiles, isFileInFolder } from "src/file/file";
import { insightQueueStore } from "src/insights/insightsQueStore";
import { activeSources, adapterFor } from "src/sync/adapters";
import type { VCardRaw } from "src/sync/adapters/adapter";
import type { NoteIO } from "src/sync/syncContact";
import { defaultSourceOf } from "src/sync/sources";
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
    async appendToBody(markdown: string) {
      await app.vault.process(file, (data) => `${data.replace(/\s*$/, "")}\n\n${markdown}\n`);
    },
  };
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
      return `[[${app.metadataCache.fileToLinktext(file, fromPath)}]]`;
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

/** Contact notes where the renames would move a value (and none that would be skipped). */
export function notesToRename(app: App, renames: Rename[]): TFile[] {
  return contactNotes(app).flatMap(({ file }) => {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const result = frontmatter ? renameAllInFrontmatter(frontmatter, renames) : undefined;
    return result && "set" in result && Object.keys(result.set).length > 0 ? [file] : [];
  });
}

/** Applies the renames in all contact notes at once; notes where a target name already has a value are skipped. */
export async function renamePropertyInNotes(app: App, renames: Rename[]): Promise<{ renamed: number; skipped: string[] }> {
  let renamed = 0;
  const skipped: string[] = [];
  for (const { file } of contactNotes(app)) {
    try {
      const outcome = { value: "none" as "renamed" | "skipped" | "none" };
      await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        const result = renameAllInFrontmatter(fm, renames);
        if ("skipped" in result) outcome.value = "skipped";
        else if (Object.keys(result.set).length > 0) {
          for (const key of result.remove) delete fm[key];
          for (const [key, value] of Object.entries(result.set)) fm[key] = value;
          outcome.value = "renamed";
        }
      });
      if (outcome.value === "renamed") renamed++;
      else if (outcome.value === "skipped") skipped.push(file.path);
    } catch (error) {
      skipped.push(file.path);
      console.error(`Friendly Contacts: could not rename properties in ${file.path}`, error);
    }
  }
  return { renamed, skipped };
}

const REMOTE_TTL_MS = 5 * 60 * 1000;
/** Per source (keyed by id, url and credentials); only sources that loaded are cached, a failed one is retried. */
const remoteCache = new Map<string, { key: string; at: number; list: RemoteContact[] }>();
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

/**
 * Contacts on the servers of every active address book, with the file name they would get on import.
 * Each source is cached for 5 minutes; one that cannot be read is skipped with a Notice (at most one per 5 minutes)
 * and tried again on the next call.
 */
export async function remoteContacts(): Promise<RemoteContact[]> {
  const sources = activeSources();
  for (const id of remoteCache.keys()) if (!sources.some((s) => s.id === id)) remoteCache.delete(id);
  const lists = await Promise.all(
    sources.map(async (source): Promise<RemoteContact[]> => {
      const key = JSON.stringify([source.addressBookUrl, source.authType, source.authKey]);
      const cached = remoteCache.get(source.id);
      if (cached?.key === key && Date.now() - cached.at < REMOTE_TTL_MS) return cached.list;
      try {
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
        remoteCache.set(source.id, { key, at: Date.now(), list });
        lastFailureNotice.delete(source.id);
        return list;
      } catch (error) {
        const told = lastFailureNotice.get(source.id);
        if (told === undefined || Date.now() - told >= REMOTE_TTL_MS) {
          lastFailureNotice.set(source.id, Date.now());
          new Notice(`Could not read ${source.name}: ${failureText(error, source)}`);
        }
        return [];
      }
    }),
  );
  return lists.flat();
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
    if (note) return this.app.metadataCache.fileToLinktext(note.file, this.sourcePath, true);
    // A contact in several address books under different names has no one name to show.
    const names = new Set(this.remote.filter((r) => r.uid === id).map((r) => r.fileName));
    return names.size === 1 ? [...names][0] : undefined;
  }

  resolveLink(name: string): { uid: string } | { text: string } | { ambiguous: true } {
    const dest = this.app.metadataCache.getFirstLinkpathDest(name, this.sourcePath);
    const note = dest ? this.contacts.find((c) => c.file.path === dest.path) : undefined;
    if (!note || (note.uid === undefined && this.readOnly)) return resolveRemoteName(name, this.remote);
    if (note.uid === undefined) {
      // Like the UID processor: a contact that gets linked needs an identity.
      note.uid = `urn:uuid:${generateUUID()}`;
      this.pending.push(updateFrontMatterValue(note.file, "UID", note.uid));
    }
    return { uid: cleanUid(note.uid) };
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
  // Export works without sync enabled: the default source's base is used even when that source is not active.
  const source = defaultSourceOf(getSettings());
  const base = uid !== "" && source ? await contactSyncState(source.id, app).get(uid) : undefined;
  let lines;
  if (base) {
    const baseLines = parseCard(base.raw);
    lines = patch(baseLines, toFriendly(baseLines, rows, ctx), props, rows, ctx).lines;
  } else {
    lines = newCard(props, rows, ctx).lines;
  }
  return serializeCard(lines);
}

/**
 * Creates a friendly contact note from one card in the contacts folder.
 * Returns the card's UID ('' when it has none) and whether the note now holds this card, or undefined
 * when the card has no name. An existing file is only replaced when the user says so, maybe later.
 */
export async function importCard(app: App, card: string): Promise<{ uid: string; written: boolean } | undefined> {
  const { contactsFolder, defaultHashtag, friendly } = getSettings();
  const lines = parseCard(card);
  const value = (name: string) => lines.find((line) => line.name === name)?.value;
  const fileName = contactFileName(value("N"), value("FN"));
  if (!fileName) return undefined;
  const ctx = await relationContextFor(app, normalizePath(`${contactsFolder}/${fileName}.md`));
  const props = toFriendly(lines, friendly.mapping, ctx).props;
  const content = renderFriendlyNote(props, defaultHashtag, friendly.mapping);
  const path = await createContactFile(app, contactsFolder, content, `${fileName}.md`);
  const written = path !== undefined && (await app.vault.adapter.exists(path)) && (await app.vault.adapter.read(path)) === content;
  return { uid: cleanUid(value("UID")), written };
}

/** Imports a card pulled from the server of `sourceId` and stores it as that source's base for the next Sync. */
export async function importRemoteCard(
  app: App,
  pulled: VCardRaw,
  meta: { href: string; etag?: string },
  sourceId: string | undefined,
): Promise<boolean> {
  const imported = await importCard(app, pulled.raw);
  if (!imported) return false;
  // Only a note that holds this card may get its base; an existing (skipped) note keeps syncing without one.
  if (imported.uid !== "" && imported.written && sourceId !== undefined) {
    await contactSyncState(sourceId, app).set(imported.uid, {
      raw: pulled.raw,
      etag: pulled.etag || meta.etag || "",
      href: pulled.href || meta.href,
    });
  }
  return true;
}

/** Moves every contact note in the contacts folder to `toFolder`, then points the setting at it. */
export async function moveContacts(
  app: App,
  toFolder: string,
  fromFolder: string = getSettings().contactsFolder,
): Promise<{ moved: number; skipped: SkippedMove[] }> {
  const from = normalizeFolder(fromFolder);
  const to = normalizeFolder(toFolder);
  const files = new Map(contactNotes(app, from).map(({ file }) => [file.path, file]));
  const plan = planMoves([...files.keys()], from, to, (path) => app.vault.getAbstractFileByPath(path) !== null);
  const skipped = [...plan.skipped];
  let moved = 0;
  for (const move of plan.moves) {
    const file = files.get(move.from);
    if (!file) continue;
    try {
      await ensureFolder(app, move.to.slice(0, Math.max(move.to.lastIndexOf("/"), 0)));
      await app.fileManager.renameFile(file, move.to);
      moved++;
    } catch (error) {
      skipped.push({ from: move.from, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  // Only follow the contacts when some actually moved; otherwise the plugin would look in an empty folder.
  if (moved > 0) {
    await updateSetting("contactsFolder", to);
    insightQueueStore.clear();
  }
  return { moved, skipped };
}

async function ensureFolder(app: App, path: string): Promise<void> {
  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current = current === "" ? part : `${current}/${part}`;
    if (app.vault.getAbstractFileByPath(current)) continue;
    try {
      await app.vault.createFolder(current);
    } catch (error) {
      if (!app.vault.getAbstractFileByPath(current)) throw error; // "already exists" is fine
    }
  }
}

/** Tells the owner what a move did; skipped files are listed in the console. */
export function reportMove(result: { moved: number; skipped: SkippedMove[] }, toFolder: string): void {
  const { moved, skipped } = result;
  if (skipped.length > 0) {
    console.log("Friendly Contacts: skipped while moving contacts:\n" + skipped.map((s) => `${s.from}: ${s.reason}`).join("\n"));
  }
  new Notice(moveNotice(moved, skipped.length, toFolder));
}
