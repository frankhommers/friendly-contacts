/** Which contact notes belong to which address book, and what changes in them when a book is renamed or removed. */

import type { App, TFile } from "obsidian";
import { contactNotes, contactSyncState } from "src/contacts/obsidianNotes";
import type { Source } from "src/settings/settings";
import { sameName } from "src/sync/sources";

/** The note's `source:` name; undefined when it is missing or empty. */
function namedSource(app: App, file: TFile): string | undefined {
  const value = app.metadataCache.getFileCache(file)?.frontmatter?.source;
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

/** Contact notes whose `source:` names the address book (case-insensitive). */
export function notesNamingSource(app: App, name: string): TFile[] {
  return contactNotes(app).flatMap(({ file }) => {
    const named = namedSource(app, file);
    return named !== undefined && sameName(named, name) ? [file] : [];
  });
}

/**
 * Notes that sync with `source`: those naming it in `source:`, and those without `source:` whose UID has a base in
 * it (or, with no base anywhere, the default source, where Sync would put them).
 */
export async function notesUsingSource(
  app: App,
  source: Source,
  sources: Source[],
  defaultSource: string,
): Promise<TFile[]> {
  const using: TFile[] = [];
  for (const { file, uid } of contactNotes(app)) {
    const named = namedSource(app, file);
    if (named !== undefined) {
      if (sameName(named, source.name)) using.push(file);
      continue;
    }
    const holders: string[] = [];
    if (uid !== undefined) {
      for (const candidate of sources) {
        if (await contactSyncState(candidate.id, app).get(uid)) holders.push(candidate.id);
      }
    }
    if (holders.includes(source.id) || (holders.length === 0 && source.id === defaultSource)) using.push(file);
  }
  return using;
}

/** Gives every contact note that names `from` the name `to`. Notes that cannot be written are listed in `failed`. */
export async function renameSourceInNotes(
  app: App,
  from: string,
  to: string,
): Promise<{ renamed: number; failed: string[] }> {
  let renamed = 0;
  const failed: string[] = [];
  for (const file of notesNamingSource(app, from)) {
    try {
      await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        frontmatter.source = to;
      });
      renamed++;
    } catch (error) {
      failed.push(file.path);
      console.error(`Friendly Contacts: could not rename the address book in ${file.path}`, error);
    }
  }
  return { renamed, failed };
}

/** Deletes the sync state (the bases) of a removed address book. */
export async function removeSourceState(app: App, sourceId: string, pluginDir: string): Promise<void> {
  const dir = `${pluginDir}/sync-state/${sourceId}`;
  if (await app.vault.adapter.exists(dir)) await app.vault.adapter.rmdir(dir, true);
}
