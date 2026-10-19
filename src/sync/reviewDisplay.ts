/** Pure display decisions of the sync review screen. No obsidian / src/context imports. */

import { linkTarget } from '../contacts/friendly/relations';
import { FriendlyValue } from '../contacts/friendly/translate';
import { Choice, isDecided, ReviewRow, Side } from './review';

export interface DisplayValue {
  text?: string;
  /** Shown dimmed: a note about the value rather than a value. */
  muted?: boolean;
  image?: string;
  items?: { name: string; only: boolean }[];
}

export const NONE = '(none)';

const asList = (value: FriendlyValue | undefined): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter((v) => v.trim() !== '');

/** A data URI or URL as is; bare base64 is taken to be a JPEG. */
function imageSource(value: string): string {
  const v = value.trim();
  return /^(data:|https?:|file:|app:)/i.test(v) ? v : `data:image/jpeg;base64,${v}`;
}

/**
 * What one side of a row shows. `linkName` turns a relation value (a link) into the name to show;
 * a UID is never displayed.
 */
export function displayValue(row: ReviewRow, side: Side, linkName: (link: string) => string): DisplayValue {
  const own = asList(side === 'server' ? row.server : row.local);
  if (own.length === 0) return { text: NONE };

  if (row.kind === 'photo') return { image: imageSource(own[0]) };

  if (row.kind === 'list' || row.kind === 'relation') {
    const key = (v: string): string => (row.kind === 'relation' ? linkTarget(v.trim()) : v);
    const other = new Set(asList(side === 'server' ? row.local : row.server).map(key));
    return {
      items: own.map((v) => ({
        name: row.kind === 'relation' ? linkName(v) : v,
        only: !other.has(key(v)),
      })),
    };
  }

  return { text: own.join(', ') };
}

/** What a column of a row shows; for a new card (`newCardIn`: the book's name) the server column says it is not there. */
export function cellValue(
  row: ReviewRow,
  side: Side,
  linkName: (link: string) => string,
  opts: { newCardIn?: string } = {},
): DisplayValue {
  if (side === 'server' && opts.newCardIn !== undefined) return { text: `Not in ${opts.newCardIn} yet`, muted: true };
  return displayValue(row, side, linkName);
}

/** The column, pick button and "All from" label of a side: the address book's name, or Obsidian. */
export const sideLabel = (side: Side, serverName: string): string => (side === 'server' ? serverName : 'Obsidian');

/** The sides a row can be picked from: a new card has no server side, and picking it would empty the note. */
export const pickSides = (newCard: boolean): Side[] => (newCard ? ['local'] : ['server', 'local']);

/** The rows on screen (changed ones; with Show all also the unchanged ones, never `uid`), and how many Show all adds. */
export function shownRows(rows: ReviewRow[], showAll: boolean): { visible: ReviewRow[]; hidden: number } {
  const extra = (r: ReviewRow) => !r.changed && r.property !== 'uid';
  return { visible: rows.filter((r) => r.changed || (showAll && extra(r))), hidden: rows.filter(extra).length };
}

const hasNewline = (value: FriendlyValue | undefined): boolean => asList(value).some((v) => v.includes('\n'));

/** The custom edit of a row needs a multi-line field: a side's value or the custom text has a newline. */
export function isMultiline(row: ReviewRow, choice: Choice | undefined): boolean {
  return hasNewline(row.server) || hasNewline(row.local) || (typeof choice === 'object' && choice.custom.includes('\n'));
}

/** An empty custom value that removes the property (on a conflict it decides nothing instead). */
export function willRemove(row: ReviewRow, choice: Choice | undefined): boolean {
  return typeof choice === 'object' && choice.custom.trim() === '' && isDecided(row, choice);
}

/** Why Apply is disabled; undefined when no conflict is left. */
export function applyHint(undecided: number): string | undefined {
  if (undecided === 0) return undefined;
  return `Decide ${undecided} conflict${undecided === 1 ? '' : 's'}`;
}

/** `[[Path/Name|Alias]]` -> Alias, else the last part of the target; `[Alias](path.md)` -> Alias. Never a UID. */
export function linkDisplayName(link: string): string {
  const v = link.trim();
  const wiki = /^\[\[([\s\S]*)\]\]$/.exec(v);
  if (wiki) {
    const [target, alias] = wiki[1].split('|');
    if (alias?.trim()) return alias.trim();
    return (target.split('#')[0].split('/').pop() ?? target).replace(/\.md$/i, '');
  }
  const md = /^\[([^\]]*)\]\(/.exec(v);
  if (md?.[1]) return md[1];
  return (linkTarget(v).split('/').pop() ?? v).replace(/\.md$/i, '');
}
