/**
 * Mapping table between friendly note properties and vCard lines.
 *
 * A pattern is `NAME` (line has no identifying TYPE after matchTypes),
 * `NAME[T1,T2]` (exactly that TYPE set, any order) or `NAME[*]` (any TYPE set).
 */

import { matchTypes, typesOf, VCardLine } from './lines';

export type Pattern = string;

export type FieldRow = {
  kind: 'field';
  property: string;
  read: Pattern[];
  write: string;
  format?: 'date' | 'list';
};
export type ComponentRow = {
  kind: 'component';
  property: string;
  read: Pattern[];
  write: string;
  index: number;
};
export type RelationRow = {
  kind: 'relation';
  property: string;
  types: string[];
  write: string;
  mirror?: string;
  single?: boolean;
};
export type MappingRow = FieldRow | ComponentRow | RelationRow;

const field = (
  property: string,
  read: Pattern[],
  write: string,
  format?: 'date' | 'list',
): FieldRow => (format ? { kind: 'field', property, read, write, format } : { kind: 'field', property, read, write });

const component = (property: string, read: Pattern[], write: string, index: number): ComponentRow => ({
  kind: 'component',
  property,
  read,
  write,
  index,
});

const relation = (
  property: string,
  types: string[],
  mirror: string | undefined,
  single?: boolean,
): RelationRow => {
  const row: RelationRow = { kind: 'relation', property, types, write: `RELATED;TYPE=${types[0]}` };
  if (mirror !== undefined) row.mirror = mirror;
  if (single) row.single = true;
  return row;
};

const HOME_ADR: Pattern[] = ['ADR', 'ADR[HOME]'];
const WORK_ADR: Pattern[] = ['ADR[WORK]'];

export const DEFAULT_MAPPING: MappingRow[] = [
  field('name', ['FN'], 'FN'),
  component('firstname', ['N'], 'N', 1),
  component('middlename', ['N'], 'N', 2),
  component('lastname', ['N'], 'N', 0),
  field('nickname', ['NICKNAME'], 'NICKNAME'),
  field('mobile', ['TEL[CELL]'], 'TEL;TYPE=CELL'),
  field('phone', ['TEL', 'TEL[HOME]', 'TEL[MAIN]'], 'TEL;TYPE=HOME'),
  field('work-phone', ['TEL[WORK]'], 'TEL;TYPE=WORK'),
  field('email', ['EMAIL', 'EMAIL[HOME]'], 'EMAIL;TYPE=HOME'),
  field('work-email', ['EMAIL[WORK]'], 'EMAIL;TYPE=WORK'),
  field('website', ['URL', 'URL[HOME]'], 'URL'),
  field('work-website', ['URL[WORK]'], 'URL;TYPE=WORK'),
  component('company', ['ORG'], 'ORG', 0),
  field('title', ['TITLE'], 'TITLE'),
  field('role', ['ROLE'], 'ROLE'),
  field('birthday', ['BDAY'], 'BDAY', 'date'),
  field('anniversary', ['ANNIVERSARY'], 'ANNIVERSARY', 'date'),
  component('street', HOME_ADR, 'ADR;TYPE=HOME', 2),
  component('postcode', HOME_ADR, 'ADR;TYPE=HOME', 5),
  component('city', HOME_ADR, 'ADR;TYPE=HOME', 3),
  component('region', HOME_ADR, 'ADR;TYPE=HOME', 4),
  component('country', HOME_ADR, 'ADR;TYPE=HOME', 6),
  component('work-street', WORK_ADR, 'ADR;TYPE=WORK', 2),
  component('work-postcode', WORK_ADR, 'ADR;TYPE=WORK', 5),
  component('work-city', WORK_ADR, 'ADR;TYPE=WORK', 3),
  component('work-region', WORK_ADR, 'ADR;TYPE=WORK', 4),
  component('work-country', WORK_ADR, 'ADR;TYPE=WORK', 6),
  field('note', ['NOTE'], 'NOTE'),
  field('categories', ['CATEGORIES'], 'CATEGORIES', 'list'),
  field('photo', ['PHOTO[*]'], 'PHOTO'),
  field('uid', ['UID'], 'UID'),
  relation('spouse', ['spouse'], 'spouse', true),
  relation('children', ['child'], 'parents'),
  relation('parents', ['parent'], 'children'),
  relation('siblings', ['sibling'], 'siblings'),
  relation('family', ['kin'], 'family'),
  relation('friends', ['friend'], 'friends'),
  relation('colleagues', ['colleague', 'co-worker'], 'colleagues'),
  relation('neighbours', ['neighbor'], 'neighbours'),
  relation('housemates', ['co-resident'], 'housemates'),
  relation('acquaintances', ['acquaintance'], 'acquaintances'),
  relation('met', ['met'], 'met'),
  relation('emergency', ['emergency'], undefined),
];

type ParsedPattern = { name: string; types: string[] | '*' };

const PATTERN = /^([A-Za-z][A-Za-z0-9-]*)(?:\[([^\[\]]*)\])?$/;

function parsePattern(pattern: Pattern): ParsedPattern | undefined {
  const m = PATTERN.exec(pattern);
  if (!m) return undefined;
  const name = m[1].toUpperCase();
  if (m[2] === undefined) return { name, types: [] };
  if (m[2].trim() === '*') return { name, types: '*' };
  const types = m[2]
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t !== '');
  if (types.length === 0) return undefined;
  return { name, types: types.sort() };
}

export function matchesPattern(line: VCardLine, pattern: Pattern): boolean {
  const parsed = parsePattern(pattern);
  if (!parsed || parsed.name !== line.name) return false;
  if (parsed.types === '*') return true;
  const actual = matchTypes(line);
  return actual.length === parsed.types.length && actual.every((t, i) => t === (parsed.types as string[])[i]);
}

function rowMatchesLine(row: MappingRow, line: VCardLine): boolean {
  if (row.kind === 'relation') {
    if (line.name !== 'RELATED') return false;
    const lineTypes = typesOf(line);
    return row.types.some((t) => lineTypes.includes(t.toUpperCase()));
  }
  return row.read.some((p) => matchesPattern(line, p));
}

/** Rows for a line: all matching component rows for a structured line, else the first matching row (if any). */
export function rowForLine(line: VCardLine, rows: MappingRow[]): MappingRow[] {
  const matching = rows.filter((row) => rowMatchesLine(row, line));
  if (matching.length === 0) return [];
  if (matching[0].kind === 'component') return matching.filter((r) => r.kind === 'component');
  return [matching[0]];
}

/** `mobile` -> ordinal 1, `mobile-2` -> ordinal 2. */
export function rowForProperty(
  property: string,
  rows: MappingRow[],
): { row: MappingRow; ordinal: number } | undefined {
  const exact = rows.find((r) => r.property === property);
  if (exact) return { row: exact, ordinal: 1 };
  const m = /^(.+)-(\d+)$/.exec(property);
  if (!m) return undefined;
  const ordinal = Number(m[2]);
  if (ordinal < 2) return undefined;
  const row = rows.find((r) => r.property === m[1]);
  return row ? { row, ordinal } : undefined;
}

export function isMappedProperty(property: string, rows: MappingRow[]): boolean {
  return rowForProperty(property, rows) !== undefined;
}

const VCARD_NAMES = new Set([
  'BEGIN', 'END', 'VERSION', 'PRODID', 'REV', 'UID', 'FN', 'N', 'NICKNAME', 'PHOTO', 'BDAY', 'ANNIVERSARY',
  'ADR', 'LABEL', 'TEL', 'EMAIL', 'IMPP', 'LANG', 'TZ', 'GEO', 'TITLE', 'ROLE', 'LOGO', 'ORG', 'MEMBER',
  'RELATED', 'CATEGORIES', 'NOTE', 'SOUND', 'URL', 'KEY', 'FBURL', 'CALADRURI', 'CALURI', 'CLASS', 'MAILER',
  'AGENT', 'GENDER', 'KIND', 'SOURCE', 'XML', 'CLIENTPIDMAP',
]);

/** Human-readable problems with a mapping; empty when valid. */
export function validateMapping(rows: MappingRow[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.property.trim();
    if (key === '') errors.push('A property name is empty.');
    if (seen.has(key)) errors.push(`Duplicate property name: ${key}`);
    seen.add(key);
    // Friendly names are lower-case; only the upper-case spelling collides with a vCard key in old-style notes.
    if (VCARD_NAMES.has(key) || key.startsWith('X-')) {
      errors.push(`Property name "${key}" is a vCard name.`);
    }
    if (row.kind !== 'relation') {
      if (row.read.length === 0) errors.push(`Property "${key}" has no read pattern.`);
      for (const pattern of row.read) {
        if (!parsePattern(pattern)) errors.push(`Unparsable pattern for "${key}": ${pattern}`);
      }
    } else if (row.types.length === 0) {
      errors.push(`Relation "${key}" has no types.`);
    }
    if (row.write.trim() === '') errors.push(`Property "${key}" has no write key.`);
  }
  return errors;
}
