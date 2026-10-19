/** Pure display decisions of the sync review screen. No obsidian / src/context imports. */

import { linkTarget } from '../contacts/friendly/relations';
import { FriendlyValue } from '../contacts/friendly/translate';
import { ReviewRow, Side } from './review';

export interface DisplayValue {
  text?: string;
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
