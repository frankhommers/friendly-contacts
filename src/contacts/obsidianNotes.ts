/**
 * Obsidian side of friendly contact notes: reading and writing a note for Sync, resolving
 * relationship links through the vault, and the card a note exports as.
 */

import { App, normalizePath, Notice, parseYaml, TFile, TFolder } from "obsidian";
import { updateFrontMatterValue } from "src/contacts/contactFrontmatter";
import { parseCard, serializeCard } from "src/contacts/friendly/lines";
import { MappingRow } from "src/contacts/friendly/mapping";
import type { MirrorEnv } from "src/contacts/relationMirror";
import { RelationContext, resolveRemoteName } from "src/contacts/friendly/relations";
import { FriendlyValue, newCard, patch, toFriendly } from "src/contacts/friendly/translate";
import { contactFileName, isContactFrontmatter, renderFriendlyNote } from "src/contacts/friendlyNotes";
import { getApp, getPluginDir } from "src/context/sharedAppContext";
import { getSettings } from "src/context/sharedSettingsContext";
import { createContactFile, findContactFiles, isFileInFolder } from "src/file/file";
import { getCurrentAdapter } from "src/sync/adapters";
import type { VCardRaw } from "src/sync/adapters/adapter";
import type { NoteIO } from "src/sync/syncContact";
import { createSyncState, obsidianFileStore, SyncState } from "src/sync/syncState";
import { cleanUid, generateUUID } from "src/util/vcard";

export interface ContactNote {
  file: TFile;
  uid: string | undefined;
}

export interface RemoteContact {
  uid: string;
  fileName: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Reads and writes one contact note for Sync; only the given properties are touched. */
export function noteIO(app: App, file: TFile): NoteIO {
  return {
    async readFrontmatter() {
      const cached = app.metadataCache.getFileCache(file)?.frontmatter;
      if (cached) return { ...cached };
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
export function contactNotes(app: App): ContactNote[] {
  const folder = app.vault.getAbstractFileByPath(normalizePath(getSettings().contactsFolder));
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
    async setProperty(path, property, value) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return;
      await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        if (value === undefined) delete frontmatter[property];
        else frontmatter[property] = value;
      });
    },
  };
}

const REMOTE_TTL_MS = 5 * 60 * 1000;
let remoteCache: { at: number; list: RemoteContact[] } | undefined;

/** Contacts on the server with the file name they would get on import; cached for 5 minutes. */
export async function remoteContacts(): Promise<RemoteContact[]> {
  const adapter = getCurrentAdapter();
  if (!adapter) return [];
  if (remoteCache && Date.now() - remoteCache.at < REMOTE_TTL_MS) return remoteCache.list;
  try {
    const metas = await adapter.getMetaList();
    if (!Array.isArray(metas)) return [];
    const list = metas.flatMap((meta) => {
      const fileName = contactFileName(meta.n, meta.fn);
      return meta.uid && fileName ? [{ uid: cleanUid(meta.uid), fileName }] : [];
    });
    remoteCache = { at: Date.now(), list };
    return list;
  } catch {
    return [];
  }
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
    return this.remote.find((r) => r.uid === id)?.fileName;
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

let sharedState: { dir: string; state: SyncState } | undefined;

/** The one sync-state store (its writes are queued, so every caller must share it). */
export function contactSyncState(app: App = getApp()): SyncState {
  const dir = `${getPluginDir()}/sync-state`;
  if (sharedState?.dir !== dir) sharedState = { dir, state: createSyncState(obsidianFileStore(app), dir) };
  return sharedState.state;
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
  const base = uid !== "" ? await contactSyncState(app).get(uid) : undefined;
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

/** Imports a card pulled from the server and stores it as the base for the next Sync. */
export async function importRemoteCard(
  app: App,
  pulled: VCardRaw,
  meta: { href: string; etag?: string },
): Promise<boolean> {
  const imported = await importCard(app, pulled.raw);
  if (!imported) return false;
  // Only a note that holds this card may get its base; an existing (skipped) note keeps syncing without one.
  if (imported.uid !== "" && imported.written) {
    await contactSyncState(app).set(imported.uid, {
      raw: pulled.raw,
      etag: pulled.etag || meta.etag || "",
      href: pulled.href || meta.href,
    });
  }
  return true;
}
