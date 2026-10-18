import type { AuthType, Source } from "src/settings/settings.d";
import { cleanUid } from "src/util/vcard";

/** Pure helpers for the address book list; no Obsidian or context imports. */

export interface MigratedSources {
  sources: Source[];
  defaultSource: string;
  /** Id of the source made from the old single CardDAV block; its sync state moves to that source. */
  migratedFrom?: string;
}

/** Last non-empty path segment of the address book URL, URI-decoded; "Contacts" when there is none. */
export function sourceNameFromUrl(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL: treat the text as a path.
  }
  const segment = path.split('/').filter((part) => part !== '').pop();
  if (segment === undefined) return 'Contacts';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Error text for an empty name or a case-insensitive duplicate of another source; undefined when fine. */
export function validateSourceName(name: string, sources: Source[], selfId?: string): string | undefined {
  if (name.trim() === '') return 'The name cannot be empty.';
  if (sources.some((s) => s.id !== selfId && sameName(s.name, name))) {
    return `Another address book is already named "${name.trim()}".`;
  }
  return undefined;
}

/** The default source, if there is one. */
export function defaultSourceOf(settings: { sources: Source[]; defaultSource: string }): Source | undefined {
  return settings.sources.find((s) => s.id === settings.defaultSource);
}

export function findSourceByName(sources: Source[], name: string): Source | undefined {
  return sources.find((s) => sameName(s.name, name));
}

/** Fixed id of the book made from the old CardDAV block, so devices upgrading independently agree on it. */
export const MIGRATED_SOURCE_ID = 'carddav';

/**
 * Settings written before address book sources hold one CardDAV block plus syncEnabled/syncSelected.
 * Stored `sources` win; otherwise a CardDAV block with a URL becomes the one (default) source.
 */
export function migrateSources(loaded: Record<string, unknown>): MigratedSources {
  if (Array.isArray(loaded.sources)) {
    const sources = loaded.sources as Source[];
    const defaultSource = typeof loaded.defaultSource === 'string' ? loaded.defaultSource : (sources[0]?.id ?? '');
    return { sources, defaultSource };
  }
  const carddav = (loaded.CardDAV ?? {}) as Record<string, unknown>;
  const addressBookUrl = typeof carddav.addressBookUrl === 'string' ? carddav.addressBookUrl : '';
  if (addressBookUrl.trim() === '') return { sources: [], defaultSource: '' };
  const id = MIGRATED_SOURCE_ID;
  const source: Source = {
    id,
    name: sourceNameFromUrl(addressBookUrl),
    addressBookUrl,
    authType: (carddav.authType === 'basic' ? 'basic' : 'apikey') as AuthType,
    authKey: typeof carddav.authKey === 'string' ? carddav.authKey : '',
    enabled: loaded.syncEnabled === true && loaded.syncSelected === 'CardDAV',
  };
  return { sources: [source], defaultSource: id, migratedFrom: id };
}

/** Where a card was found: the source, and the card's href and ETag there. */
export type CardLocation = { sourceId: string; href: string; etag: string };

export type SyncPlan =
  | { kind: 'sync'; sourceId: string } // card in the note's source, or no card anywhere -> sync/create there
  | { kind: 'adopt'; sourceId: string } // note has no source:, card found in exactly one source
  | { kind: 'move'; from: CardLocation; to: string } // note names a source, card is in exactly one other
  | { kind: 'refuse'; message: string };

/**
 * The source a note syncs with. An explicit `source:` name is that source or an error, never a fallback.
 * Without a name: the first source in `baseIn` (sources holding a sync base for the note's UID, enabled ones
 * first), else the default. A disabled source chosen this way is an error too.
 */
export function noteSourceId(
  noteSource: string | undefined,
  sources: Source[],
  baseIn: string[],
  defaultSource: string,
): { id: string } | { error: string } {
  const usable = (source: Source) =>
    source.enabled ? { id: source.id } : { error: `Address book '${source.name}' is not enabled` };
  if (noteSource !== undefined && noteSource.trim() !== '') {
    const named = findSourceByName(sources, noteSource);
    return named ? usable(named) : { error: `Unknown address book '${noteSource.trim()}'` };
  }
  if (baseIn.length > 0) {
    // Callers list enabled sources first; a base only in a disabled one refuses (the card may still be there).
    const holder = sources.find((s) => s.id === baseIn[0]);
    return holder ? usable(holder) : { id: baseIn[0] };
  }
  const fallback = sources.find((s) => s.id === defaultSource);
  return fallback ? usable(fallback) : { error: 'No address book is set up' };
}

const listNames = (names: string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** A source holding a sync base for the note's UID, and whether it is enabled. */
export type BaseHolder = { id: string; active: boolean };

/**
 * What Sync does, given the note's source, the sources where a card with the note's exact UID was found, and
 * (`baseIn`) the sources holding a sync base for that UID. An explicit source with the card found nowhere does not
 * create a second card when another book holds a base: that book is disabled or the card is gone from it.
 */
export function planSync(
  noteSource: { id: string; explicit: boolean },
  found: CardLocation[],
  sourceName: (id: string) => string,
  baseIn: BaseHolder[] = [],
): SyncPlan {
  if (found.length === 0 && noteSource.explicit) {
    const other = baseIn.find((holder) => holder.id !== noteSource.id);
    if (other) {
      const name = sourceName(other.id);
      const why = other.active ? 'where the card is gone' : 'which is disabled';
      return {
        kind: 'refuse',
        message:
          `The card was last synced with ${name}, ${why}; ` +
          `${other.active ? `restore it there or delete its sync state, ` : `enable ${name} to move it, `}` +
          'or remove the UID from the note to create a new card.',
      };
    }
  }
  if (found.length === 0 || found.some((f) => f.sourceId === noteSource.id)) {
    return { kind: 'sync', sourceId: noteSource.id };
  }
  if (found.length === 1) {
    const [only] = found;
    return noteSource.explicit
      ? { kind: 'move', from: only, to: noteSource.id }
      : { kind: 'adopt', sourceId: only.sourceId };
  }
  return {
    kind: 'refuse',
    message:
      `The card is in ${listNames(found.map((f) => sourceName(f.sourceId)))}; ` +
      'keep one copy (delete the others on the server) and set source: to that address book.',
  };
}

/**
 * The source whose sync base an export uses for a note: the one `source:` names, else the first holding a base
 * for the note's UID (`holdsBase`), else the default. Unlike Sync, it also takes disabled sources and never errors.
 */
export async function sourceForExport(
  noteSource: string | undefined,
  settings: { sources: Source[]; defaultSource: string },
  holdsBase: (sourceId: string) => Promise<boolean>,
): Promise<Source | undefined> {
  if (noteSource !== undefined && noteSource.trim() !== '') {
    const named = findSourceByName(settings.sources, noteSource);
    if (named) return named;
  }
  for (const source of settings.sources) {
    if (await holdsBase(source.id)) return source;
  }
  return defaultSourceOf(settings);
}

/** Remote cards whose UID has no note, sorted by file name; a UID present in two sources is offered once per source. */
export function importCandidates<T extends { uid: string; fileName: string }>(remote: T[], noteUids: string[]): T[] {
  const known = new Set(noteUids);
  return remote
    .filter((card) => !known.has(card.uid))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/**
 * True when a contact note already holds this card's UID, or one was imported earlier in the same run (the
 * metadata cache may not show a fresh note yet). A card without a UID is never "known".
 */
export function uidAlreadyImported(uid: string | undefined, noteUids: Iterable<string | undefined>, importedNow: Set<string>): boolean {
  const wanted = cleanUid(uid);
  if (wanted === '') return false;
  if (importedNow.has(wanted)) return true;
  for (const noteUid of noteUids) if (cleanUid(noteUid) === wanted) return true;
  return false;
}

/** The address book URL with the parts that do not tell books apart removed: host case, default port, trailing slash. */
export function normalizeBookUrl(url: string): string {
  const text = url.trim();
  try {
    const parsed = new URL(text);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    return text.replace(/\/+$/, '');
  }
}

/** Another source (not `selfId`) with the same address book URL, if there is one. */
export function sourceWithSameUrl(sources: Source[], url: string, selfId: string): Source | undefined {
  const wanted = normalizeBookUrl(url);
  if (wanted === '') return undefined;
  return sources.find((s) => s.id !== selfId && normalizeBookUrl(s.addressBookUrl) === wanted);
}

/** "Address book", or "Address book 2", "Address book 3", ... when that name is taken. */
export function uniqueSourceName(sources: Source[], base = 'Address book'): string {
  let name = base;
  for (let n = 2; sources.some((s) => sameName(s.name, name)); n++) name = `${base} ${n}`;
  return name;
}

type SourceList = { sources: Source[]; defaultSource: string };

/** The list with `source` added (the first one becomes the default) or, when its id is known, replaced. */
export function withSource<T extends SourceList>(settings: T, source: Source): T {
  const exists = settings.sources.some((s) => s.id === source.id);
  return {
    ...settings,
    sources: exists ? settings.sources.map((s) => (s.id === source.id ? source : s)) : [...settings.sources, source],
    defaultSource: settings.defaultSource === '' || !settings.sources.some((s) => s.id === settings.defaultSource)
      ? source.id
      : settings.defaultSource,
  };
}

/** The list without that source. Callers refuse removing the default first, so the default stays valid. */
export function withoutSource<T extends SourceList>(settings: T, id: string): T {
  return { ...settings, sources: settings.sources.filter((s) => s.id !== id) };
}

/** Why a source cannot be removed: it is the default, or notes use it. undefined when it can go. */
export function removalBlocker(source: Source, defaultSource: string, noteCount: number): string | undefined {
  if (source.id === defaultSource) return 'Make another address book the default first.';
  if (noteCount > 0) return `${noteCount} contacts use ${source.name}.`;
  return undefined;
}

/** What a caller may change in a saved source: everything but its id. */
export type SourcePatch = Partial<Omit<Source, 'id'>>;

/**
 * The settings with `patch` applied to the CURRENT entry of that id, so a change made from an older view of the
 * source cannot revert fields it did not touch. undefined when the source no longer exists.
 */
export function patchSource<T extends SourceList>(settings: T, id: string, patch: SourcePatch): T | undefined {
  const current = settings.sources.find((s) => s.id === id);
  if (!current) return undefined;
  const { id: _ignored, ...fields } = patch as SourcePatch & { id?: string };
  return { ...settings, sources: settings.sources.map((s) => (s.id === id ? { ...current, ...fields } : s)) };
}
