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
  /** vCard 3.0 date written as `itemN.X-ABDATE` with this label (`Anniversary`); read with it too. */
  appleDateLabel?: string;
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
  /** Labels of the relationship on phones; the first one is written, all are read (ignoring case). */
  labels: string[];
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
  labels: string[],
  mirror: string | undefined,
  single?: boolean,
): RelationRow => {
  const row: RelationRow = { kind: 'relation', property, types, write: `RELATED;TYPE=${types[0]}`, labels };
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
  { ...field('anniversary', ['ANNIVERSARY'], 'ANNIVERSARY', 'date'), appleDateLabel: 'Anniversary' },
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
  relation('spouse', ['spouse'], ['Spouse'], 'spouse', true),
  relation('partner', ['sweetheart'], ['Partner'], 'partner', true),
  relation('children', ['child'], ['Child'], 'parents'),
  relation('parents', ['parent'], ['Parent', 'Mother', 'Father'], 'children'),
  relation('siblings', ['sibling'], ['Sibling', 'Brother', 'Sister'], 'siblings'),
  relation('family', ['kin'], ['Kin', 'Relative'], 'family'),
  relation('friends', ['friend'], ['Friend'], 'friends'),
  relation('colleagues', ['colleague', 'co-worker'], ['Colleague', 'Co-worker', 'Assistant', 'Manager'], 'colleagues'),
  relation('neighbours', ['neighbor'], ['Neighbor'], 'neighbours'),
  relation('housemates', ['co-resident'], ['Co-resident'], 'housemates'),
  relation('acquaintances', ['acquaintance'], ['Acquaintance'], 'acquaintances'),
  relation('met', ['met'], ['Met'], 'met'),
  relation('emergency', ['emergency'], ['Emergency'], undefined),
];

/** Apple's built-in label names (lower-case); on cards they are written `_$!<Label>!$_`. */
export const APPLE_BUILTIN_LABELS: ReadonlySet<string> = new Set([
  'spouse', 'partner', 'child', 'parent', 'mother', 'father', 'brother', 'sister', 'friend', 'assistant',
  'manager', 'anniversary',
]);

const APPLE_LABEL = /^_\$!<(.*)>!\$_$/;

/** The lower-case label names in a raw `X-ABLabel` value: `_$!<Spouse>!$_` -> spouse; comma separated labels split. */
export function labelText(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => {
      const text = part.trim();
      const apple = APPLE_LABEL.exec(text);
      return (apple ? apple[1] : text).trim().toLowerCase();
    })
    .filter((part) => part !== '');
}

/** The `X-ABLabel` value to write: Apple's form for a built-in label, else the label as is. */
export function writeLabel(label: string): string {
  return APPLE_BUILTIN_LABELS.has(label.trim().toLowerCase()) ? `_$!<${label}>!$_` : label;
}

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

/**
 * Renames the row `from` to `to`, and repoints every relation whose `mirror` named `from`
 * (also its own, e.g. `spouse`), so the mirrors stay valid.
 */
export function renameRow(rows: MappingRow[], from: string, to: string): MappingRow[] {
  return rows.map((row) => {
    const renamed = row.property === from ? { ...row, property: to } : { ...row };
    if (renamed.kind === 'relation' && renamed.mirror === from) renamed.mirror = to;
    return renamed;
  });
}

const defaultRelation = (types0: string): RelationRow | undefined =>
  DEFAULT_MAPPING.find((r): r is RelationRow => r.kind === 'relation' && r.types[0] === types0);

/**
 * Brings a stored mapping up to date: relation rows without `labels` get those of the default row with the same
 * first type, default relation rows that are absent (by first type, e.g. `partner`) are appended, and the row that
 * writes `ANNIVERSARY` gets its date label. Rows are never renamed or removed; running it again changes nothing.
 * A default row is not appended when its name is already used by another row (the mapping would be invalid).
 */
export function migrateMapping(stored: MappingRow[]): MappingRow[] {
  const rows: MappingRow[] = stored.map((row) => {
    if (row.kind === 'relation') {
      if (Array.isArray(row.labels)) return { ...row };
      return { ...row, labels: [...(defaultRelation(row.types[0])?.labels ?? [])] };
    }
    if (row.kind === 'field' && row.appleDateLabel === undefined && row.write.trim().toUpperCase() === 'ANNIVERSARY') {
      return { ...row, appleDateLabel: 'Anniversary' };
    }
    return { ...row };
  });
  const propertyOfType = (types0: string): string | undefined =>
    rows.find((r) => r.kind === 'relation' && r.types[0] === types0)?.property;
  for (const row of DEFAULT_MAPPING) {
    if (row.kind !== 'relation' || propertyOfType(row.types[0]) !== undefined) continue;
    if (rows.some((r) => r.property === row.property)) continue;
    const added: RelationRow = { ...row, types: [...row.types], labels: [...row.labels] };
    rows.push(added);
    if (row.mirror !== undefined) {
      // The mirror is named after the stored row of the mirrored type, which may have been renamed.
      const mirrored = DEFAULT_MAPPING.find((r): r is RelationRow => r.kind === 'relation' && r.property === row.mirror);
      const target = row.mirror === row.property ? added.property : mirrored && propertyOfType(mirrored.types[0]);
      if (target) added.mirror = target;
      else delete added.mirror;
    }
  }
  return rows;
}

/**
 * Rows whose names the code relies on (sync identity, card name, avatar): they cannot be renamed or removed.
 * Renaming `uid` would make Sync assign a new UID and create a duplicate card.
 */
export const FIXED_PROPERTIES = ['uid', 'name', 'photo'] as const;

/** The note property that names the address book; set by the plugin, never read from or written to a card. */
export const RESERVED_PROPERTY = 'source';

export function isFixedProperty(property: string): boolean {
  return (FIXED_PROPERTIES as readonly string[]).includes(property);
}

/** Property renames from `before` to `after`, row by row (the settings never add, remove or reorder rows). */
export function mappingRenames(before: MappingRow[], after: MappingRow[]): { from: string; to: string }[] {
  const renames: { from: string; to: string }[] = [];
  const count = Math.min(before.length, after.length);
  for (let i = 0; i < count; i++) {
    const from = before[i].property;
    const to = after[i].property;
    if (from !== to) renames.push({ from, to });
  }
  return renames;
}

/** Human-readable problems with a mapping; empty when valid. */
export function validateMapping(rows: MappingRow[]): string[] {
  const errors: string[] = [];
  for (const property of FIXED_PROPERTIES) {
    if (!rows.some((row) => row.kind === 'field' && row.property === property)) {
      errors.push(`The property "${property}" cannot be renamed or removed.`);
    }
  }
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.property.trim();
    if (key === '') errors.push('A property name is empty.');
    if (key === RESERVED_PROPERTY) errors.push('`source` is reserved for the address book.');
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
    } else {
      if (row.types.length === 0) errors.push(`Relation "${key}" has no types.`);
      if (row.mirror !== undefined && !rows.some((r) => r.kind === 'relation' && r.property === row.mirror)) {
        errors.push(`Relation "${key}" is mirrored by "${row.mirror}", which is not a relation.`);
      }
    }
    if (row.write.trim() === '') errors.push(`Property "${key}" has no write key.`);
  }
  return errors;
}
