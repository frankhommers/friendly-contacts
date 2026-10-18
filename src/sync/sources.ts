import type { AuthType, Source } from "src/settings/settings.d";

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

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

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

/**
 * Settings written before address book sources hold one CardDAV block plus syncEnabled/syncSelected.
 * Stored `sources` win; otherwise a CardDAV block with a URL becomes the one (default) source.
 */
export function migrateSources(loaded: Record<string, unknown>, newId: () => string): MigratedSources {
  if (Array.isArray(loaded.sources)) {
    const sources = loaded.sources as Source[];
    const defaultSource = typeof loaded.defaultSource === 'string' ? loaded.defaultSource : (sources[0]?.id ?? '');
    return { sources, defaultSource };
  }
  const carddav = (loaded.CardDAV ?? {}) as Record<string, unknown>;
  const addressBookUrl = typeof carddav.addressBookUrl === 'string' ? carddav.addressBookUrl : '';
  if (addressBookUrl.trim() === '') return { sources: [], defaultSource: '' };
  const id = newId();
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
