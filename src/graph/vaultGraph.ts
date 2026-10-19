/** The Obsidian-facing side of the people graph: contact notes -> graph input, and the graph's centre. */

import type { App } from "obsidian";
import { coerceNoteProps } from "src/contacts/friendly/merge";
import type { MappingRow } from "src/contacts/friendly/mapping";
import { photoImageSrc } from "src/contacts/friendly/photo";
import { relationSnapshot } from "src/contacts/friendly/relations";
import { contactDisplayName } from "src/contacts/layoutNotes";
import { contactNotes } from "src/contacts/obsidianNotes";
import type { GraphContact } from "src/graph/graphModel";
import { cleanUid } from "src/util/vcard";

/**
 * Every contact note as a graph contact, sorted by path (the direction of an edge follows the order). A relation
 * entry is the path of the contact note it links to, else its link text.
 */
export function graphContacts(app: App, rows: MappingRow[]): GraphContact[] {
  const notes = [...contactNotes(app)].sort((a, b) => (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0));
  const contactPaths = new Set(notes.map((n) => n.file.path));
  return notes.map(({ file }) => {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const { props } = coerceNoteProps(frontmatter, rows);
    const resolve = (linkpath: string): string | undefined => {
      const path = app.metadataCache.getFirstLinkpathDest(linkpath, file.path)?.path;
      return path !== undefined && contactPaths.has(path) ? path : undefined;
    };
    const contact: GraphContact = {
      id: file.path,
      name: contactDisplayName(app, file),
      snapshot: relationSnapshot(props, rows, resolve),
    };
    const rawPhoto: unknown = Array.isArray(frontmatter.photo) ? frontmatter.photo[0] : frontmatter.photo;
    const photo = typeof rawPhoto === "string" ? photoImageSrc(rawPhoto) : undefined;
    if (photo !== undefined) contact.photo = photo;
    return contact;
  });
}

/**
 * The note the graph is drawn around: the contact whose UID is `meUid`; else the active note when it is a contact
 * note; else undefined (everyone).
 */
export function graphCentre(app: App, meUid: string, activePath: string | undefined): string | undefined {
  const notes = contactNotes(app);
  const me = cleanUid(meUid).toLowerCase();
  if (me !== "") {
    const mine = notes.find((n) => n.uid !== undefined && cleanUid(n.uid).toLowerCase() === me);
    if (mine) return mine.file.path;
  }
  return activePath !== undefined && notes.some((n) => n.file.path === activePath) ? activePath : undefined;
}

/** A contact the vault owner can be: only notes with a UID are listed (the setting stores the UID). */
export interface MeCandidate {
  uid: string;
  name: string;
  path: string;
}

export function meCandidates(app: App): MeCandidate[] {
  return contactNotes(app)
    .flatMap(({ file, uid }) =>
      uid === undefined || cleanUid(uid) === "" ? [] : [{ uid: cleanUid(uid), name: contactDisplayName(app, file), path: file.path }],
    )
    .sort((a, b) => a.name.localeCompare(b.name) || (a.path < b.path ? -1 : 1));
}

/** The name of the contact with `uid`; undefined when there is none (no contact has that UID any more). */
export function contactNameByUid(app: App, uid: string): string | undefined {
  const wanted = cleanUid(uid).toLowerCase();
  if (wanted === "") return undefined;
  return meCandidates(app).find((c) => c.uid.toLowerCase() === wanted)?.name;
}
