/**
 * Converting contact notes: old-style vCard keys -> friendly properties, and renaming a friendly property.
 * Pure; the Obsidian side (processFrontMatter over the vault) is in obsidianNotes.ts.
 */

import { MappingRow, rowForProperty } from 'src/contacts/friendly/mapping';
import { FriendlyValue } from 'src/contacts/friendly/translate';
import { hasValue, isVCardKey, recordToFriendly } from 'src/contacts/friendlyNotes';

type Frontmatter = Record<string, unknown>;

export interface ConvertResult {
  set: Record<string, FriendlyValue>;
  /** vCard keys whose data now lives in a friendly property. */
  remove: string[];
  /**
   * Conflicts with a friendly property that already had a different value, as `name -> name-2` (a text value
   * moved to the next free numbered slot) or `categories (merged)` (list items added). The existing value stays.
   */
  moved: string[];
}

const asText = (value: unknown): string =>
  Array.isArray(value) ? value.filter(hasValue).map(String).join(',') : String(value);

const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify([a].flat().map(String)) === JSON.stringify([b].flat().map(String))
    : String(a).trim() === String(b).trim();

/**
 * The friendly properties an old-style note's vCard keys stand for. Other keys, and vCard keys with no
 * friendly property (e.g. `X-FOO`), are neither set nor removed, so no data is lost.
 */
export function convertFrontmatter(fm: Frontmatter, rows: MappingRow[]): ConvertResult {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (isVCardKey(key) && hasValue(value)) record[key] = asText(value);
  }
  const result: ConvertResult = { set: {}, remove: [], moved: [] };
  if (Object.keys(record).length === 0) return result;

  result.remove = Object.keys(record).filter((key) => Object.keys(recordToFriendly({ [key]: record[key] }, rows)).length > 0);
  for (const [property, value] of Object.entries(recordToFriendly(record, rows))) {
    const existing = fm[property];
    if (!hasValue(existing) && !(property in result.set)) {
      result.set[property] = value;
    } else if (Array.isArray(value)) {
      const current = [existing].flat().filter(hasValue).map(String);
      const merged = [...new Set([...current, ...value])];
      if (merged.length > current.length) {
        result.set[property] = merged;
        result.moved.push(`${property} (merged)`);
      }
    } else if (!sameValue(existing, value)) {
      const base = rowForProperty(property, rows)?.row.property ?? property;
      const slots = [base, ...Array.from({ length: 50 }, (_, i) => `${base}-${i + 2}`)];
      if (slots.some((slot) => hasValue(fm[slot]) && sameValue(fm[slot], value))) continue;
      const free = slots.find((slot) => !hasValue(fm[slot]) && !(slot in result.set));
      if (free === undefined) continue;
      result.set[free] = value;
      result.moved.push(`${property} -> ${free}`);
    }
  }
  return result;
}

/** Moves `from` (and `from-2`, `from-3`, ...) to `to`; skipped when the note already has a value under a target name. */
export function renameInFrontmatter(
  fm: Frontmatter,
  from: string,
  to: string,
): { set: Record<string, FriendlyValue>; remove: string[] } | { skipped: true } {
  const set: Record<string, FriendlyValue> = {};
  const remove: string[] = [];
  const isExtra = (key: string) => key.startsWith(`${from}-`) && /^\d+$/.test(key.slice(from.length + 1));
  for (const [key, value] of Object.entries(fm)) {
    if (key !== from && !isExtra(key)) continue;
    if (!hasValue(value)) continue;
    const target = to + key.slice(from.length);
    if (hasValue(fm[target])) return { skipped: true };
    set[target] = value as FriendlyValue;
    remove.push(key);
  }
  return { set, remove };
}
