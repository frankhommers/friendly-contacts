/**
 * Links to Obsidian notes on cards: the settings stored in data.json, the `obsidian://open` URL, the link lines
 * the plugin writes (`itemN.URL` + `itemN.X-ABLabel`, "own" links) and the links a note wants. No obsidian imports.
 */

import { unescapeText, VCardLine } from './lines';
import { rowForProperty, MappingRow } from './mapping';
import { linkTarget, RelationContext } from './relations';
import { FriendlyValue } from './translate';

/** Stored in data.json. `formerVaultNames`: names links were written with before, still recognised as own. */
export type NoteLinksSettings = { enabled: boolean; vaultName: string; formerVaultNames: string[] };

export const DEFAULT_NOTE_LINKS: NoteLinksSettings = { enabled: false, vaultName: '', formerVaultNames: [] };

const unique = (names: string[]): string[] => [...new Set(names)];

/** `stored` as read from data.json: missing or wrong-typed fields get the default, names are trimmed. */
export function normalizeNoteLinks(stored: unknown): NoteLinksSettings {
  const value = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const former = Array.isArray(value.formerVaultNames) ? value.formerVaultNames : [];
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_NOTE_LINKS.enabled,
    vaultName: typeof value.vaultName === 'string' ? value.vaultName.trim() : DEFAULT_NOTE_LINKS.vaultName,
    formerVaultNames: unique(
      former.flatMap((name) => (typeof name === 'string' && name.trim() !== '' ? [name.trim()] : [])),
    ),
  };
}

/** Sets `enabled`; turning on with no vault name stored takes the name of this device's vault. */
export function turnNoteLinks(stored: NoteLinksSettings, on: boolean, deviceVault: string): NoteLinksSettings {
  return { ...stored, enabled: on, vaultName: on && stored.vaultName === '' ? deviceVault : stored.vaultName };
}

/** A new vault name (empty: this device's vault); the old name stays recognised as a former one. */
export function setLinkVault(stored: NoteLinksSettings, name: string, deviceVault: string): NoteLinksSettings {
  const vaultName = name.trim() === '' ? deviceVault : name.trim();
  const former = stored.vaultName === '' ? stored.formerVaultNames : [...stored.formerVaultNames, stored.vaultName];
  return { ...stored, vaultName, formerVaultNames: unique(former).filter((n) => n !== vaultName) };
}

/** What Sync uses: `ownVaults` are the names whose links Sync recognises as its own (none until a name is set). */
export type NoteLinkOptions = { enabled: boolean; vault: string; ownVaults: string[] };

export function noteLinkOptions(stored: NoteLinksSettings): NoteLinkOptions {
  const { vaultName } = stored;
  return {
    enabled: stored.enabled && vaultName !== '',
    vault: vaultName,
    ownVaults: vaultName === '' ? [] : unique([vaultName, ...stored.formerVaultNames]),
  };
}

/** `notePath` is a vault path; a trailing `.md` (any case) is dropped. */
export function noteLinkUrl(vault: string, notePath: string): string {
  const file = notePath.replace(/\.md$/i, '');
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
}

/** `value` as on the card: unescaped first. Undefined unless it is an `obsidian://open` link with `vault` and `file`. */
export function parseNoteLink(value: string): { vault: string; file: string } | undefined {
  const match = /^obsidian:\/\/open\?(.*)$/i.exec(unescapeText(value).trim());
  if (!match) return undefined;
  const found = new Map<string, string>();
  for (const part of match[1].split('&')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    try {
      const key = decodeURIComponent(part.slice(0, at));
      const decoded = decodeURIComponent(part.slice(at + 1));
      if (!found.has(key)) found.set(key, decoded);
    } catch {
      return undefined;
    }
  }
  const vault = found.get('vault');
  const file = found.get('file');
  return vault === undefined || file === undefined || vault === '' || file === '' ? undefined : { vault, file };
}

/** A grouped `URL` line holding a note link to one of `ownVaults` (compared ignoring case). */
export function isOwnNoteLink(line: VCardLine, ownVaults: readonly string[]): boolean {
  if (line.group === undefined || line.name !== 'URL') return false;
  const link = parseNoteLink(line.value);
  if (!link) return false;
  const vault = link.vault.toLowerCase();
  return ownVaults.some((own) => own.toLowerCase() === vault);
}

/** The own link lines in card order, with the first `X-ABLabel` (unescaped) of their group and its index. */
export function cardNoteLinks(
  lines: VCardLine[],
  ownVaults: readonly string[],
): { line: number; url: string; label?: string; labelLine?: number }[] {
  const labels = new Map<string, { label: string; line: number }>();
  lines.forEach((line, index) => {
    const group = line.group?.toLowerCase();
    if (line.name === 'X-ABLABEL' && group !== undefined && !labels.has(group)) {
      labels.set(group, { label: unescapeText(line.value), line: index });
    }
  });
  const links: { line: number; url: string; label?: string; labelLine?: number }[] = [];
  lines.forEach((line, index) => {
    if (!isOwnNoteLink(line, ownVaults)) return;
    const label = labels.get(line.group!.toLowerCase());
    const link: { line: number; url: string; label?: string; labelLine?: number } = {
      line: index,
      url: unescapeText(line.value).trim(),
    };
    if (label) {
      link.label = label.label;
      link.labelLine = label.line;
    }
    links.push(link);
  });
  return links;
}

export type NoteLink = { url: string; label: string };

/**
 * The links a note wants: one per distinct contact note its relationships resolve to, in the mapping's order of the
 * relationship rows (`spouse`, `spouse-2`, ...), then the order in the note. The label is the contact's name.
 */
export function wantedNoteLinks(
  props: Record<string, FriendlyValue>,
  rows: MappingRow[],
  ctx: RelationContext,
  vault: string,
): NoteLink[] {
  const keyed = Object.keys(props).flatMap((key) => {
    const found = rowForProperty(key, rows);
    return found && found.row.kind === 'relation' ? [{ key, index: rows.indexOf(found.row), ordinal: found.ordinal }] : [];
  });
  keyed.sort((a, b) => a.index - b.index || a.ordinal - b.ordinal);
  const seen = new Set<string>();
  const links: NoteLink[] = [];
  for (const { key } of keyed) {
    const value = props[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      const note = ctx.contactNote?.(linkTarget(item.trim()));
      if (!note || seen.has(note.path)) continue;
      seen.add(note.path);
      links.push({ url: noteLinkUrl(vault, note.path), label: note.name });
    }
  }
  return links;
}

const pairKey = (url: string, label: string): string => JSON.stringify([url, label]);

/** True when the card's own `(url, label)` pairs and `wanted` differ as multisets (order does not count). */
export function noteLinksDiffer(lines: VCardLine[], wanted: NoteLink[], ownVaults: readonly string[]): boolean {
  const have = cardNoteLinks(lines, ownVaults).map((l) => pairKey(l.url, l.label ?? ''));
  const want = wanted.map((l) => pairKey(l.url, l.label));
  if (have.length !== want.length) return true;
  const counts = new Map<string, number>();
  for (const key of have) counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const key of want) {
    const left = counts.get(key) ?? 0;
    if (left === 0) return true;
    counts.set(key, left - 1);
  }
  return false;
}
