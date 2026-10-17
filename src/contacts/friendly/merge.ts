/** Three-way merge of friendly properties and coercion of raw note values. No obsidian / src/context imports. */

import { isMappedProperty, MappingRow, rowForProperty } from './mapping';
import { linkTarget } from './relations';
import { FriendlyValue } from './translate';

export interface Conflict {
  property: string;
  local: FriendlyValue;
  server: FriendlyValue;
}

type Props = Record<string, FriendlyValue>;

/** Absent (undefined, '' or []) -> undefined; text -> trimmed; list -> sorted unique link targets. */
function canonical(value: FriendlyValue | undefined): string | string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const items = new Set(value.map((v) => linkTarget(v.trim())).filter((v) => v !== ''));
    return items.size === 0 ? undefined : [...items].sort();
  }
  const text = value.trim();
  return text === '' ? undefined : text;
}

/** Equal as the merge sees them: absent values match, text is trimmed, lists compare as sorted link-target sets. */
export function sameValue(a: FriendlyValue | undefined, b: FriendlyValue | undefined): boolean {
  const x = canonical(a);
  const y = canonical(b);
  if (x === undefined || y === undefined) return x === y;
  if (typeof x === 'string' && typeof y === 'string') return x === y;
  const xs = typeof x === 'string' ? [x] : x;
  const ys = typeof y === 'string' ? [y] : y;
  return xs.length === ys.length && xs.every((v, i) => v === ys[i]);
}

export function mergeFriendly(
  base: Props | undefined,
  server: Props,
  local: Props,
): { merged: Props; conflicts: Conflict[] } {
  const merged: Props = {};
  const conflicts: Conflict[] = [];
  const properties = new Set([...Object.keys(server), ...Object.keys(local)]);
  if (base) for (const p of Object.keys(base)) properties.add(p);

  for (const property of properties) {
    const s = server[property];
    const l = local[property];
    let winner: FriendlyValue | undefined;
    if (sameValue(s, l)) {
      winner = s;
    } else if (base === undefined) {
      if (canonical(s) === undefined) winner = l;
      else if (canonical(l) === undefined) winner = s;
      else {
        winner = s;
        conflicts.push({ property, local: l as FriendlyValue, server: s as FriendlyValue });
      }
    } else if (sameValue(base[property], s)) {
      winner = l;
    } else if (sameValue(base[property], l)) {
      winner = s;
    } else {
      winner = s;
      conflicts.push({ property, local: l ?? '', server: s ?? '' });
    }
    if (canonical(winner) !== undefined) merged[property] = winner as FriendlyValue;
  }
  return { merged, conflicts };
}

function isListProperty(property: string, rows: MappingRow[]): boolean {
  const row = rowForProperty(property, rows)?.row;
  if (!row) return false;
  return row.kind === 'relation' ? !row.single : row.kind === 'field' && row.format === 'list';
}

/** Primitive YAML value -> string; null, empty and non-scalar values -> undefined. */
function scalar(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  return undefined;
}

/** Unquoted `[[Name]]` parses as `[["Name"]]`; recover that exact shape as the wikilink text. */
function recoverWikilink(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length !== 1) return undefined;
  const inner: unknown = value[0];
  if (!Array.isArray(inner) || inner.length !== 1 || typeof inner[0] !== 'string') return undefined;
  return `[[${inner[0]}]]`;
}

export function coerceNoteProps(
  frontmatter: Record<string, unknown>,
  rows: MappingRow[],
): { props: Props; warnings: string[] } {
  const props: Props = {};
  const warnings: string[] = [];
  for (const [property, raw] of Object.entries(frontmatter)) {
    if (!isMappedProperty(property, rows)) continue;
    const whole = recoverWikilink(raw);
    const source = whole !== undefined ? [whole] : Array.isArray(raw) ? raw : [raw];
    const items = source.map((v) => recoverWikilink(v) ?? scalar(v)).filter((v): v is string => v !== undefined);
    if (items.length === 0) continue;
    if (isListProperty(property, rows)) {
      props[property] = items;
    } else {
      if (Array.isArray(raw) && whole === undefined) {
        warnings.push(`Property "${property}" is a list but holds one value; using the first item "${items[0]}".`);
      }
      props[property] = items[0];
    }
  }
  return { props, warnings };
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function renderConflictCallout(conflicts: Conflict[], when: Date): string {
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const lines = [`> [!warning] Sync conflict ${stamp}`, '> The server value was kept. Your value was:'];
  for (const c of conflicts) {
    const value = Array.isArray(c.local) ? c.local.join(', ') : c.local;
    lines.push(`> - ${c.property}: ${value}`);
  }
  return lines.join('\n');
}
