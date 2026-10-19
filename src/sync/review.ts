/** Pure model of the sync review screen. No obsidian / src/context imports. */

import { MappingRow, rowForProperty } from '../contacts/friendly/mapping';
import { sameValue } from '../contacts/friendly/merge';
import { FriendlyValue } from '../contacts/friendly/translate';

type Props = Record<string, FriendlyValue>;

export type Side = 'server' | 'local';
export type Choice = Side | { custom: string };

export interface ReviewRow {
  property: string;
  server: FriendlyValue | undefined;
  local: FriendlyValue | undefined;
  /** undefined = conflict, must be decided. */
  preselect: Side | undefined;
  kind: 'text' | 'list' | 'photo' | 'relation';
  /** false only for "Show all" rows. */
  changed: boolean;
}

const isPhotoProperty = (property: string): boolean => /^photo(-\d+)?$/.test(property);

function kindOf(property: string, rows: MappingRow[]): ReviewRow['kind'] {
  const row = rowForProperty(property, rows)?.row;
  if (row?.kind === 'relation') return 'relation';
  if (row?.kind === 'field' && row.format === 'list') return 'list';
  if (isPhotoProperty(property)) return 'photo';
  return 'text';
}

/** Mapping row index, then ordinal; unmapped properties last. */
function orderOf(property: string, rows: MappingRow[]): [number, number] {
  const found = rowForProperty(property, rows);
  if (!found) return [Number.MAX_SAFE_INTEGER, 0];
  return [rows.indexOf(found.row), found.ordinal];
}

const isAbsent = (value: FriendlyValue | undefined): boolean =>
  value === undefined || (Array.isArray(value) ? value.length === 0 : value.trim() === '');

/**
 * One row per property whose Radicale (`server`) and Obsidian (`local`) values differ, preselected from the base,
 * plus (for "Show all") every other property present on either side with `changed: false`; in mapping order.
 */
export function reviewRows(
  base: Props | undefined,
  server: Props,
  local: Props,
  rows: MappingRow[],
  opts: { newCard: boolean },
): ReviewRow[] {
  const properties = new Set([...Object.keys(server), ...Object.keys(local)]);
  if (base) for (const p of Object.keys(base)) properties.add(p);

  const result: ReviewRow[] = [];
  for (const property of properties) {
    const s = server[property];
    const l = local[property];
    const kind = kindOf(property, rows);
    if (sameValue(s, l, property)) {
      if (isAbsent(s) && isAbsent(l)) continue;
      result.push({ property, server: s, local: l, preselect: 'server', kind, changed: false });
      continue;
    }
    let preselect: Side | undefined;
    if (opts.newCard) preselect = 'local';
    else if (base && sameValue(base[property], l, property)) preselect = 'server';
    else if (base && sameValue(base[property], s, property)) preselect = 'local';
    result.push({ property, server: s, local: l, preselect, kind, changed: true });
  }

  const keys = new Map(result.map((r) => [r.property, orderOf(r.property, rows)]));
  return result.sort((a, b) => {
    const [ai, ao] = keys.get(a.property) as [number, number];
    const [bi, bo] = keys.get(b.property) as [number, number];
    return ai - bi || ao - bo || a.property.localeCompare(b.property);
  });
}

export function isUpToDate(rows: ReviewRow[]): boolean {
  return !rows.some((r) => r.changed);
}

/**
 * Whether a row's result is settled by `choice` (the user's pick, if any) or the preselection. An empty
 * "Edit result" decides nothing on a conflict; on a row with a preselection it removes the property.
 */
export function isDecided(row: ReviewRow, choice: Choice | undefined): boolean {
  if (!row.changed) return true;
  const effective = choice ?? row.preselect;
  if (effective === undefined) return false;
  return !(typeof effective === 'object' && row.preselect === undefined && effective.custom.trim() === '');
}

/** The conflicts still to decide. */
export function undecidedCount(rows: ReviewRow[], choices: Map<string, Choice>): number {
  return rows.filter((r) => !isDecided(r, choices.get(r.property))).length;
}

export function canApply(rows: ReviewRow[], choices: Map<string, Choice>): boolean {
  return undecidedCount(rows, choices) === 0;
}

/** The choices for a preview of the result while conflicts are open: an undecided conflict keeps the note's value. */
export function previewChoices(rows: ReviewRow[], choices: Map<string, Choice>): Map<string, Choice> {
  const preview = new Map(choices);
  for (const row of rows) if (!isDecided(row, choices.get(row.property))) preview.set(row.property, 'local');
  return preview;
}

/**
 * The properties after applying the choices to `server` (F(S)); rows that are not `changed` are ignored.
 * Throws on an undecided conflict (check `canApply` first): no side is ever picked silently.
 */
export function resultProps(rows: ReviewRow[], choices: Map<string, Choice>, server: Props): Props {
  const result: Props = { ...server };
  for (const row of rows) {
    if (!row.changed) continue;
    const choice = choices.get(row.property) ?? row.preselect;
    if (choice === undefined || !isDecided(row, choice)) throw new Error(`The conflict in ${row.property} is not decided.`);
    let value: FriendlyValue | undefined;
    if (choice === 'server') value = row.server;
    else if (choice === 'local') value = row.local;
    else {
      if (row.kind !== 'text') throw new Error(`A custom value is only possible for text properties: ${row.property}`);
      const text = choice.custom.trim();
      if (sameValue(text, row.local, row.property)) value = row.local;
      else if (sameValue(text, row.server, row.property)) value = row.server;
      else value = text;
    }
    if (isAbsent(value)) delete result[row.property];
    else result[row.property] = value as FriendlyValue;
  }
  return result;
}
