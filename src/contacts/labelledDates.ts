/**
 * Obsidian side of "Dates with a label": the contact notes with their sync bases, the labels on those bases, and
 * filling or removing a row's properties in the notes. The decisions are in `friendly/dateLabels.ts`.
 */

import { App, TFile } from "obsidian";
import { FillNote, isEmptyValue, rowPropertyKeys, unmappedDateLabels } from "src/contacts/friendly/dateLabels";
import { parseCard } from "src/contacts/friendly/lines";
import { MappingRow } from "src/contacts/friendly/mapping";
import { readerOf } from "src/contacts/friendly/translate";
import { contactNotes, contactSyncState } from "src/contacts/obsidianNotes";
import { getSettings } from "src/context/sharedSettingsContext";
import { sourceForExport } from "src/sync/sources";

/** A note with its base, and where that base is stored (address book and UID), for `touchBases`. */
export type NoteWithBase = FillNote & { baseOf?: { source: string; uid: string } };

/**
 * Every contact note with its frontmatter and, when it has a UID, the base of the address book an export would use
 * (the note's `source:`, else the first book holding a base for the UID, else the default book).
 */
export async function notesWithBases(app: App): Promise<NoteWithBase[]> {
  const settings = getSettings();
  const notes: NoteWithBase[] = [];
  for (const { file, uid } of contactNotes(app)) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const note: NoteWithBase = { path: file.path, frontmatter };
    if (uid !== undefined) {
      const noteSource = frontmatter.source;
      const source = await sourceForExport(
        noteSource === undefined || noteSource === null ? undefined : String(noteSource),
        settings,
        async (sourceId) => (await contactSyncState(sourceId, app).get(uid)) !== undefined,
      );
      const entry = source ? await contactSyncState(source.id, app).get(uid) : undefined;
      if (entry && source) {
        note.base = { raw: entry.raw, reader: readerOf(entry.reader) };
        note.baseOf = { source: source.id, uid };
      }
    }
    notes.push(note);
  }
  return notes;
}

/**
 * Marks the bases of `notes` as stored at `storedAt` or later (card, etag, href and reader stay), in the address book
 * each was read from. Used after a date row with `since` = `storedAt` is added: from then on those bases agree with
 * the row (see `rowsForBase`), whether the note was filled from them or not. One base failing does not stop the rest.
 * `touched`: bases handled; `failed`: paths of the notes whose base could not be updated.
 */
export async function touchBases(
  app: App,
  notes: NoteWithBase[],
  storedAt: number,
): Promise<{ touched: number; failed: string[] }> {
  let touched = 0;
  const failed: string[] = [];
  for (const { path, baseOf } of notes) {
    if (!baseOf) continue;
    try {
      await contactSyncState(baseOf.source, app).touch(baseOf.uid, storedAt);
      touched++;
    } catch (error) {
      failed.push(path);
      console.error(`Friendly Contacts: could not update the sync base of ${path}`, error);
    }
  }
  return { touched, failed };
}

/** The date labels on the cards as they were at each contact's last Sync that no row has yet. */
export async function findDateLabels(app: App, rows: MappingRow[]): Promise<{ label: string; contacts: number }[]> {
  const cards = (await notesWithBases(app)).flatMap((note) => (note.base ? [parseCard(note.base.raw)] : []));
  return unmappedDateLabels(cards, rows);
}

/**
 * Sets the planned properties in each note, only where the note's property is still empty at write time.
 * `filled`: notes that got at least one property; `failed`: notes that are gone or could not be written.
 */
export async function fillNotes(
  app: App,
  fills: { path: string; set: Record<string, string> }[],
): Promise<{ filled: number; failed: string[] }> {
  let filled = 0;
  const failed: string[] = [];
  for (const { path, set } of fills) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      failed.push(path);
      console.error(`Friendly Contacts: could not fill ${path}: the note is gone`);
      continue;
    }
    try {
      const outcome = { changed: false };
      await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(set)) {
          if (!isEmptyValue(fm[key])) continue;
          fm[key] = value;
          outcome.changed = true;
        }
      });
      if (outcome.changed) filled++;
    } catch (error) {
      failed.push(path);
      console.error(`Friendly Contacts: could not fill ${path}`, error);
    }
  }
  return { filled, failed };
}

/** Contact notes holding any of `row`'s properties (`dating`, `dating-2`, ...), from the metadata cache. */
export function notesWithRowProperties(app: App, row: MappingRow): TFile[] {
  return contactNotes(app).flatMap(({ file }) => {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    return frontmatter && rowPropertyKeys(frontmatter, row).length > 0 ? [file] : [];
  });
}

/** Removes `row`'s properties from every contact note. `removed`: notes that changed. */
export async function removeRowProperties(app: App, row: MappingRow): Promise<{ removed: number; failed: string[] }> {
  let removed = 0;
  const failed: string[] = [];
  for (const file of notesWithRowProperties(app, row)) {
    try {
      const outcome = { changed: false };
      await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        for (const key of rowPropertyKeys(fm, row)) {
          delete fm[key];
          outcome.changed = true;
        }
      });
      if (outcome.changed) removed++;
    } catch (error) {
      failed.push(file.path);
      console.error(`Friendly Contacts: could not remove properties from ${file.path}`, error);
    }
  }
  return { removed, failed };
}
