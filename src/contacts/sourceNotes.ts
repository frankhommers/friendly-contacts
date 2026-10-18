/** Which contact notes belong to which address book, and what changes in them when a book is renamed or removed. */

import type { App, TFile } from "obsidian";
import { contactNotes, contactSyncState } from "src/contacts/obsidianNotes";
import { getPluginDir } from "src/context/sharedAppContext";
import { getSettings, setSettings } from "src/context/sharedSettingsContext";
import type { Source } from "src/settings/settings";
import { forgetAdapter } from "src/sync/adapters";
import { patchSource, removalBlocker, sameName, SourcePatch, validateSourceName, withoutSource } from "src/sync/sources";

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

/** Saves `patch` into the current entry of that source. Returns false when the source no longer exists. */
export async function saveSourcePatch(id: string, patch: SourcePatch): Promise<boolean> {
  const next = patchSource(getSettings(), id, patch);
  if (!next) return false;
  await setSettings(next);
  return true;
}

/**
 * Why `from` cannot be renamed to `to`: contact notes already name `to`, and renaming would merge them into this
 * book. Their paths go to the console. undefined when nothing is in the way (a change of letter case only is fine).
 */
export function renameRefusal(app: App, from: string, to: string): string | undefined {
  if (sameName(from, to)) return undefined;
  const taken = notesNamingSource(app, to);
  if (taken.length === 0) return undefined;
  console.log(`Friendly Contacts: notes that already use the address book name ${to}:\n${taken.map((f) => f.path).join("\n")}`);
  return `Not renamed: ${taken.length} note(s) already use ${to}. See console.`;
}

/**
 * Renames a source: the notes first, then the setting. Throws when the name is not valid or the source is gone;
 * returns `{ refused }` (nothing touched) when notes already use the new name.
 */
export async function renameSource(
  app: App,
  id: string,
  newName: string,
): Promise<{ renamed: number; failed: string[] } | { refused: string }> {
  const { sources } = getSettings();
  const source = sources.find((s) => s.id === id);
  if (!source) throw new Error("This address book no longer exists.");
  const name = newName.trim();
  const problem = validateSourceName(name, sources, id);
  if (problem) throw new Error(problem);
  const refused = renameRefusal(app, source.name, name);
  if (refused) return { refused };
  const result = await renameSourceInNotes(app, source.name, name);
  if (!(await saveSourcePatch(id, { name }))) throw new Error("This address book no longer exists.");
  return result;
}

/** Why a source cannot be removed right now (default, or notes use it); undefined when it can go. */
export async function removalRefusal(app: App, id: string): Promise<string | undefined> {
  const { sources, defaultSource } = getSettings();
  const source = sources.find((s) => s.id === id);
  if (!source) return "This address book no longer exists.";
  const using = await notesUsingSource(app, source, sources, defaultSource);
  return removalBlocker(source, defaultSource, using.length);
}

/**
 * Removes a source: refused (with the reason) for the default and for a source in use; else the setting goes,
 * then its cached adapter and its sync-state directory.
 */
export async function removeSource(app: App, id: string): Promise<{ removed: true } | { refused: string }> {
  const refused = await removalRefusal(app, id);
  if (refused) return { refused };
  await setSettings(withoutSource(getSettings(), id));
  forgetAdapter(id);
  try {
    await removeSourceState(app, id, getPluginDir());
  } catch (error) {
    console.error(`Friendly Contacts: could not delete the sync state of address book ${id}`, error);
  }
  return { removed: true };
}
