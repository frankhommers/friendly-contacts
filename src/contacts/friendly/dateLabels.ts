/**
 * Dates with a label: rows the owner adds for a phone's custom date (`itemN.X-ABDATE` + `itemN.X-ABLabel`), the
 * labels found on cards that have no row yet, and the notes to fill when a row is added. No obsidian imports.
 */

import { parseCard, unescapeText, VCardLine } from './lines';
import {
  isLabelledDateRow,
  labelText,
  LabelledDateRow,
  MappingRow,
  readableLabel,
  rowForProperty,
  validateMapping,
} from './mapping';
import { sameValue } from './merge';
import { RelationContext } from './relations';
import { CURRENT_READER, FriendlyValue, Reader, toFriendly } from './translate';

export { isLabelledDateRow, readableLabel };
export type { LabelledDateRow };

export type FillNote = {
  path: string;
  frontmatter: Record<string, unknown>;
  /** The stored sync base of the contact and the reader it was stored with. */
  base?: { raw: string; reader: Reader };
};

/**
 * When a sync base was stored (`storedAt`) and when its dates with a label were last brought up to date without
 * storing it (`datesAt`, see `SyncState.touch`). Absent: before it was recorded, or never.
 */
export type BaseTimes = { storedAt?: number; datesAt?: number };

/** Lookups that find nothing: relations are read but their values are discarded. */
export const NO_LOOKUPS: RelationContext = {
  uidToName: () => undefined,
  displayName: () => undefined,
  resolveLink: (name) => ({ text: name }),
};

/** `since`: when the row is added to the mapping (see `LabelledDateRow.since`); absent: always there. */
export function labelledDateRow(label: string, property: string, since?: number): LabelledDateRow {
  const row: LabelledDateRow = {
    kind: 'field',
    property: property.trim(),
    read: [],
    write: 'X-ABDATE',
    format: 'date',
    appleDateLabel: label.trim(),
  };
  if (since !== undefined) row.since = since;
  return row;
}

/**
 * Whether a base (`times`, see `BaseTimes`) stored by `reader` predates `row` as a labelled date added after it (after
 * both `storedAt` and `datesAt`: a touched base agrees with the date rows added up to then), or a row of a
 * later reader (`sinceReader` above `reader`). The base of the device that added the row holds the date, but the note
 * it belongs to may not have been filled (the sync bases are per device, the settings travel): read with the row, the
 * date would look removed in the note. Without it the date is the card's own, so Sync brings it into the note. A base
 * without `storedAt` is older than every row with a `since`; a row without `since` is always there. Likewise a part a
 * later reader made visible (a department, a prefix) was never in the note: read without its row it is the card's
 * own, not a removal. Relation rows carry no reader mark. Such rows may be patched back (`withUnfilledDates`,
 * `withFilledLeftOut`).
 */
function addedAfter(row: MappingRow, times: BaseTimes | undefined, reader: Reader): boolean {
  const datesKnown = Math.max(times?.storedAt ?? 0, times?.datesAt ?? 0);
  return (
    (isLabelledDateRow(row) && (row.since ?? 0) > datesKnown) ||
    (row.kind !== 'relation' && row.sinceReader !== undefined && row.sinceReader > reader)
  );
}

/**
 * Whether a base stored at `times.storedAt` predates Sync being turned back on for `row` (`syncSince`). The base may
 * still hold the row's lines from before Sync was turned off, and the owner may have cleaned the card since: read with
 * the row, a cleaned card would look like a removal on the server. A row with Sync off is skipped anyway. `datesAt`
 * does not count: touching a base changes no card.
 */
function syncedAfter(row: MappingRow, times: BaseTimes | undefined): boolean {
  return !row.skip && row.syncSince !== undefined && row.syncSince > (times?.storedAt ?? 0);
}

/**
 * The rows a sync base (`times`) stored by `reader` is read with: `rows` without the rows added after it (see
 * `addedAfter`), and with `skip` on each row Sync was turned back on for after it (see `syncedAfter`). Such a row is
 * marked, not dropped, so its lines in the base are not read by another row whose pattern also matches.
 */
export function rowsForBase(
  rows: MappingRow[],
  times: BaseTimes | undefined,
  reader: Reader = CURRENT_READER,
): MappingRow[] {
  return rows
    .filter((row) => !addedAfter(row, times, reader))
    .map((row) => (syncedAfter(row, times) ? { ...row, skip: true as const } : row));
}

/** Whether `rowsForBase` reads a base (`times`) stored by `reader` without some of `rows`. */
export function baseLeavesOut(rows: MappingRow[], times: BaseTimes | undefined, reader: Reader = CURRENT_READER): boolean {
  return rows.some((row) => addedAfter(row, times, reader) || syncedAfter(row, times));
}

/**
 * Whether `key` of a base belongs to a row read without because it was added after the base (`addedAfter`). Never a
 * row with Sync off, and never one Sync was turned back on for after the base (`syncedAfter`): its values in the base
 * are from before, so patching them back would read the stale base with the row again.
 */
function patchable(key: string, rows: MappingRow[], times: BaseTimes | undefined, reader: Reader): boolean {
  const row = rowForProperty(key, rows)?.row;
  return row !== undefined && addedAfter(row, times, reader) && !syncedAfter(row, times);
}

/**
 * The note's properties to patch the base with (an export): `note` plus the base's values for the rows added after
 * the base (see `addedAfter`, for `times` and `reader`) that the note leaves empty. Such a date or part was not
 * filled into the note, so it is no removal. `base`: the base read with all `rows`.
 */
export function withUnfilledDates(
  note: Record<string, FriendlyValue>,
  base: Record<string, FriendlyValue>,
  rows: MappingRow[],
  times: BaseTimes | undefined,
  reader: Reader = CURRENT_READER,
): Record<string, FriendlyValue> {
  const result = { ...note };
  for (const [key, value] of Object.entries(base)) {
    if (patchable(key, rows, times, reader) && isEmptyValue(note[key])) result[key] = value;
  }
  return result;
}

/**
 * `base` plus the full base's value for each row added after the base (see `addedAfter`) that the note already holds
 * with that same value: another device filled it into the note, so this base knew it, and a removal on the card is a
 * removal. A row the note leaves empty or holds with another value stays out (a server addition, or a conflict).
 * A row Sync was turned back on for after the base stays out too (see `patchable`). `full`: the base read with all
 * `rows`.
 */
export function withFilledLeftOut(
  base: Record<string, FriendlyValue>,
  full: Record<string, FriendlyValue>,
  note: Record<string, FriendlyValue>,
  rows: MappingRow[],
  times: BaseTimes | undefined,
  reader: Reader = CURRENT_READER,
): Record<string, FriendlyValue> {
  const result = { ...base };
  for (const [key, value] of Object.entries(full)) {
    if (patchable(key, rows, times, reader) && !isEmptyValue(value) && sameValue(note[key], value, key)) {
      result[key] = value;
    }
  }
  return result;
}

/** A mechanical property name for a label: lower-case, whitespace to `-`. The owner makes it English. */
export function suggestPropertyName(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, '-');
}

/** A new array with `row` right after the last date row (`birthday`, `anniversary`, ...), else at the end. */
export function insertLabelledDateRow(rows: MappingRow[], row: LabelledDateRow): MappingRow[] {
  let at = -1;
  rows.forEach((r, i) => {
    if (r.kind === 'field' && r.format === 'date') at = i;
  });
  const result = [...rows];
  result.splice(at < 0 ? result.length : at + 1, 0, row);
  return result;
}

/**
 * `rows` with `row` inserted, or the reasons it does not fit. Build it from the mapping as saved at the moment of
 * saving, so a rename saved while the notes were read or filled is kept.
 */
export function mappingWithLabelledDate(
  rows: MappingRow[],
  row: LabelledDateRow,
): { rows: MappingRow[] } | { errors: string[] } {
  const next = insertLabelledDateRow(rows, row);
  const errors = validateMapping(next);
  return errors.length > 0 ? { errors } : { rows: next };
}

/** `defaults` plus every labelled-date row of `current`, in their order. */
export function withLabelledDateRows(defaults: MappingRow[], current: MappingRow[]): MappingRow[] {
  return current.filter(isLabelledDateRow).reduce<MappingRow[]>(insertLabelledDateRow, [...defaults]);
}

/** The keys of `frontmatter` that belong to `row` (`dating`, `dating-2`, ...), in key order. */
export function rowPropertyKeys(frontmatter: Record<string, unknown>, row: MappingRow): string[] {
  return Object.keys(frontmatter).filter((key) => rowForProperty(key, [row]) !== undefined);
}

/** The first `X-ABLabel` of each group (lower-case group), unescaped. */
function groupLabels(lines: VCardLine[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const line of lines) {
    const group = line.group?.toLowerCase();
    if (line.name === 'X-ABLABEL' && group !== undefined && !labels.has(group)) {
      labels.set(group, unescapeText(line.value));
    }
  }
  return labels;
}

/**
 * Every `X-ABDATE` label on `cards` that no row with an `appleDateLabel` matches, in its readable form, with the
 * number of cards it is on. Spellings that differ in case are one label (the first seen); a label holding a comma
 * is left out (no row can match it). Most contacts first, then by label.
 */
export function unmappedDateLabels(
  cards: VCardLine[][],
  rows: MappingRow[],
): { label: string; contacts: number }[] {
  const labelled = rows.flatMap((row) =>
    row.kind === 'field' && row.appleDateLabel !== undefined ? [row.appleDateLabel.trim().toLowerCase()] : [],
  );
  const found = new Map<string, { label: string; contacts: number }>();
  for (const lines of cards) {
    const groups = groupLabels(lines);
    const onCard = new Set<string>();
    for (const line of lines) {
      if (line.name !== 'X-ABDATE' || line.group === undefined) continue;
      const raw = groups.get(line.group.toLowerCase());
      if (raw === undefined) continue;
      const label = readableLabel(raw);
      if (label === '' || label.includes(',')) continue;
      const names = labelText(raw);
      if (labelled.some((l) => names.includes(l))) continue;
      const key = label.toLowerCase();
      if (!found.has(key)) found.set(key, { label, contacts: 0 });
      if (!onCard.has(key)) {
        onCard.add(key);
        found.get(key)!.contacts++;
      }
    }
  }
  return [...found.values()].sort((a, b) => b.contacts - a.contacts || a.label.localeCompare(b.label));
}

/** A property value that counts as not filled in: absent, null, blank text or an empty list. */
export const isEmptyValue = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

/**
 * The properties to fill in each note when `row` is added: what its base holds for the row, read the way Sync reads
 * the base (with the base's reader, `rows` including `row`), so base, card and note agree and Sync never reads the
 * date as removed in the note. `ownVaults`: lines the plugin wrote (links to notes) are not read. A property the note already holds is kept. Notes with nothing to set are left out.
 */
export function planDateFill(
  notes: FillNote[],
  rows: MappingRow[],
  row: LabelledDateRow,
  ownVaults: readonly string[] = [],
): { path: string; set: Record<string, string> }[] {
  const plan: { path: string; set: Record<string, string> }[] = [];
  for (const note of notes) {
    if (!note.base) continue;
    const { props } = toFriendly(parseCard(note.base.raw), rows, NO_LOOKUPS, { reader: note.base.reader, ownVaults });
    const set: Record<string, string> = {};
    for (const key of rowPropertyKeys(props, row)) {
      const value = props[key];
      if (typeof value === 'string' && isEmptyValue(note.frontmatter[key])) set[key] = value;
    }
    if (Object.keys(set).length > 0) plan.push({ path: note.path, set });
  }
  return plan;
}
