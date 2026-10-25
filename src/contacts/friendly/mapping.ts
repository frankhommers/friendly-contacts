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
  /** Written instead of `write` on a vCard 3.0 card (see `writeKeyFor`); blank or absent: same as `write`. */
  writeV3?: string;
  /** The reader version that added this row (see `sinceReader` in the migration and sync bases); absent: always there. */
  sinceReader?: number;
  format?: 'date' | 'list';
  /** vCard 3.0 date written as `itemN.X-ABDATE` with this label (`Anniversary`); read with it too. */
  appleDateLabel?: string;
  /** Sync turned off for this row: its card lines are neither read nor written. Absent: on. Stored. */
  sync?: false;
  /** When Sync was last turned on (ms since epoch); a sync base stored before then is read without the row. Absent: always on. Stored. */
  syncSince?: number;
  /** Set by `syncRows` on a row with Sync off, never stored: the row's card lines are skipped. */
  skip?: true;
};
export type ComponentRow = {
  kind: 'component';
  property: string;
  read: Pattern[];
  write: string;
  /** Written instead of `write` on a vCard 3.0 card (see `writeKeyFor`); blank or absent: same as `write`. */
  writeV3?: string;
  /** The reader version that added this row (see `sinceReader` in the migration and sync bases); absent: always there. */
  sinceReader?: number;
  /** 0-based position of the part in the structured value. */
  index: number;
  /** Sync turned off for this row: its card lines are neither read nor written. Absent: on. Stored. */
  sync?: false;
  /** When Sync was last turned on (ms since epoch); a sync base stored before then is read without the row. Absent: always on. Stored. */
  syncSince?: number;
  /** Set by `syncRows` on a row with Sync off, never stored: the row's card lines are skipped. */
  skip?: true;
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
  /** Sync turned off for this row: its card lines are neither read nor written. Absent: on. Stored. */
  sync?: false;
  /** When Sync was last turned on (ms since epoch); a sync base stored before then is read without the row. Absent: always on. Stored. */
  syncSince?: number;
  /** Set by `syncRows` on a row with Sync off, never stored: the row's card lines are skipped. */
  skip?: true;
};
export type MappingRow = FieldRow | ComponentRow | RelationRow;

/** A date the owner named in the settings: written `itemN.X-ABDATE` + `itemN.X-ABLabel`, read by its label alone. */
export type LabelledDateRow = FieldRow & {
  format: 'date';
  write: 'X-ABDATE';
  appleDateLabel: string;
  /**
   * When the row was added (ms since epoch); absent: always there. A sync base stored before then was read without
   * the row, so the note may never have been filled from it (see `rowsForBase`).
   */
  since?: number;
};

const field = (
  property: string,
  read: Pattern[],
  write: string,
  format?: 'date' | 'list',
): FieldRow => (format ? { kind: 'field', property, read, write, format } : { kind: 'field', property, read, write });

const component = (
  property: string,
  read: Pattern[],
  write: string,
  index: number,
  extra: Partial<ComponentRow> = {},
): ComponentRow => ({
  kind: 'component',
  property,
  read,
  write,
  index,
  ...extra,
});

/** The reader version that added the part rows (prefix, suffix, department, gender, PO box, extra address line). */
const PARTS_READER = 3;
const GENDER_READ: Pattern[] = ['GENDER', 'X-GENDER'];

/** The key to write a row's line under: `writeV3` on a card that is not vCard 4.0, else `write`. */
export function writeKeyFor(row: FieldRow | ComponentRow, version: string): string {
  const v3 = row.writeV3?.trim();
  return version.trim() !== '4.0' && v3 ? v3 : row.write;
}

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
  component('name-prefix', ['N'], 'N', 3, { sinceReader: PARTS_READER }),
  component('firstname', ['N'], 'N', 1),
  component('middlename', ['N'], 'N', 2),
  component('lastname', ['N'], 'N', 0),
  component('name-suffix', ['N'], 'N', 4, { sinceReader: PARTS_READER }),
  field('nickname', ['NICKNAME'], 'NICKNAME'),
  field('mobile', ['TEL[CELL]'], 'TEL;TYPE=CELL'),
  field('phone', ['TEL', 'TEL[HOME]', 'TEL[MAIN]'], 'TEL;TYPE=HOME'),
  field('work-phone', ['TEL[WORK]'], 'TEL;TYPE=WORK'),
  field('email', ['EMAIL', 'EMAIL[HOME]'], 'EMAIL;TYPE=HOME'),
  field('work-email', ['EMAIL[WORK]'], 'EMAIL;TYPE=WORK'),
  field('website', ['URL', 'URL[HOME]'], 'URL'),
  field('work-website', ['URL[WORK]'], 'URL;TYPE=WORK'),
  component('company', ['ORG'], 'ORG', 0),
  component('department', ['ORG'], 'ORG', 1, { sinceReader: PARTS_READER }),
  field('title', ['TITLE'], 'TITLE'),
  field('role', ['ROLE'], 'ROLE'),
  component('gender', GENDER_READ, 'GENDER', 0, { writeV3: 'X-GENDER', sinceReader: PARTS_READER }),
  component('gender-identity', GENDER_READ, 'GENDER', 1, { writeV3: 'X-GENDER', sinceReader: PARTS_READER }),
  field('birthday', ['BDAY'], 'BDAY', 'date'),
  { ...field('anniversary', ['ANNIVERSARY'], 'ANNIVERSARY', 'date'), appleDateLabel: 'Anniversary' },
  component('po-box', HOME_ADR, 'ADR;TYPE=HOME', 0, { sinceReader: PARTS_READER }),
  component('address-extra', HOME_ADR, 'ADR;TYPE=HOME', 1, { sinceReader: PARTS_READER }),
  component('street', HOME_ADR, 'ADR;TYPE=HOME', 2),
  component('postcode', HOME_ADR, 'ADR;TYPE=HOME', 5),
  component('city', HOME_ADR, 'ADR;TYPE=HOME', 3),
  component('region', HOME_ADR, 'ADR;TYPE=HOME', 4),
  component('country', HOME_ADR, 'ADR;TYPE=HOME', 6),
  component('work-po-box', WORK_ADR, 'ADR;TYPE=WORK', 0, { sinceReader: PARTS_READER }),
  component('work-address-extra', WORK_ADR, 'ADR;TYPE=WORK', 1, { sinceReader: PARTS_READER }),
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
  // Written as `sweetheart` (vCard 4.0); `partner` is read too: DAVx5 writes Android's Partner so on a 4.0 card.
  relation('partner', ['sweetheart', 'partner'], ['Partner'], 'partner', true),
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

/** A label as shown to people: Apple's `_$!<Other>!$_` unwrapped, trimmed, case kept. */
export function readableLabel(raw: string): string {
  const text = raw.trim();
  const apple = APPLE_LABEL.exec(text);
  return (apple ? apple[1] : text).trim();
}

/** True for a date row of the "Dates with a label" table; the anniversary row (which writes `ANNIVERSARY`) is not one. */
export function isLabelledDateRow(row: MappingRow): row is LabelledDateRow {
  return (
    row.kind === 'field' &&
    row.format === 'date' &&
    row.write.trim().toUpperCase() === 'X-ABDATE' &&
    row.appleDateLabel !== undefined
  );
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

/** True when one of `names` (lower-case, from `labelText`) is `label`, ignoring case. */
const hasLabel = (names: string[], label: string): boolean => names.includes(label.trim().toLowerCase());

/**
 * `RELATED` matches a relation row by its type, `X-ABRELATEDNAMES` by its group's label (any of the row's labels);
 * `X-ABDATE` matches the field row whose `appleDateLabel` is its group's label.
 */
function rowMatchesLine(row: MappingRow, line: VCardLine, labels: string[]): boolean {
  if (row.kind === 'relation') {
    if (line.name === 'X-ABRELATEDNAMES') return (row.labels ?? []).some((label) => hasLabel(labels, label));
    if (line.name !== 'RELATED') return false;
    const lineTypes = typesOf(line);
    return row.types.some((t) => lineTypes.includes(t.toUpperCase()));
  }
  if (row.kind === 'field' && line.name === 'X-ABDATE' && row.appleDateLabel !== undefined) {
    if (hasLabel(labels, row.appleDateLabel)) return true;
  }
  return row.read.some((p) => matchesPattern(line, p));
}

/** The rows matching a line, before `skip` is looked at: all component rows of a structured line, else the first. */
function matchingRows(line: VCardLine, rows: MappingRow[], label?: string): MappingRow[] {
  const labels = label === undefined ? [] : labelText(label);
  const matching = rows.filter((row) => rowMatchesLine(row, line, labels));
  if (matching.length === 0) return [];
  if (matching[0].kind === 'component') return matching.filter((r) => r.kind === 'component');
  return [matching[0]];
}

/**
 * Rows for a line: all matching component rows for a structured line, else the first matching row (if any).
 * Rows with `skip` (see `syncRows`) still match, so their lines do not fall through to another row; they are left out
 * of the result.
 * `label` is the raw `X-ABLabel` value of the line's group, if it has one.
 */
export function rowForLine(line: VCardLine, rows: MappingRow[], label?: string): MappingRow[] {
  return matchingRows(line, rows, label).filter((row) => !row.skip);
}

/** True when rows with `skip` decide the line: the first matching row is skipped, or every matching part row is. */
export function lineIsSkipped(line: VCardLine, rows: MappingRow[], label?: string): boolean {
  const matching = matchingRows(line, rows, label);
  return matching.length > 0 && matching.every((row) => row.skip);
}

/**
 * A copy of the stored rows where each row with Sync off (except the fixed rows) has `skip`. The sync works on these
 * rows; the stored ones never carry `skip`.
 */
export function syncRows(rows: MappingRow[]): MappingRow[] {
  return rows.map((row) => (row.sync === false && !isFixedProperty(row.property) ? { ...row, skip: true as const } : row));
}

/** `mobile` -> ordinal 1, `mobile-2` -> ordinal 2. A row with `skip` is not found. */
export function rowForProperty(
  property: string,
  rows: MappingRow[],
): { row: MappingRow; ordinal: number } | undefined {
  const exact = rows.find((r) => r.property === property);
  if (exact) return exact.skip ? undefined : { row: exact, ordinal: 1 };
  const m = /^(.+)-(\d+)$/.exec(property);
  if (!m) return undefined;
  const ordinal = Number(m[2]);
  if (ordinal < 2) return undefined;
  const row = rows.find((r) => r.property === m[1]);
  return row && !row.skip ? { row, ordinal } : undefined;
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

/** Default relation rows (by first type) introduced since stored mappings were first written; only these are added. */
const ROWS_NEW_IN_PART_6 = ['sweetheart'];

const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Types a stored row with this first type reads besides its own, added once by the migration. */
const TYPES_READ_SINCE: Record<string, string[]> = { sweetheart: ['partner'] };

/**
 * Brings a stored mapping up to date: relation rows without `labels` get those of the default row with the same
 * first type (a custom type: itself, capitalised), the rows introduced by this release (`partner`) are added right
 * after the stored row of the default row before them, and the row that writes `ANNIVERSARY` gets its date label.
 * The row that writes `sweetheart` reads `partner` too (unless another row already reads it).
 * Rows are never renamed or removed; running it again changes nothing, and a default row the owner deleted is not
 * brought back (only the rows in `ROWS_NEW_IN_PART_6` are ever added).
 * A new row is not added when its name is already used by another row (the mapping would be invalid).
 */
export function migrateMapping(stored: MappingRow[]): MappingRow[] {
  const reads = (type: string): boolean => stored.some((r) => r.kind === 'relation' && r.types.includes(type));
  const rows: MappingRow[] = stored.map((row) => {
    if (row.kind === 'relation') {
      const extra = (TYPES_READ_SINCE[row.types[0]] ?? []).filter((type) => !reads(type));
      const types = extra.length > 0 ? [...row.types, ...extra] : [...row.types];
      if (Array.isArray(row.labels)) return { ...row, types };
      const labels = defaultRelation(row.types[0])?.labels ?? (row.types[0] ? [capitalised(row.types[0])] : []);
      return { ...row, types, labels: [...labels] };
    }
    if (row.kind === 'field' && row.appleDateLabel === undefined && row.write.trim().toUpperCase() === 'ANNIVERSARY') {
      return { ...row, appleDateLabel: 'Anniversary' };
    }
    return { ...row };
  });
  const indexOfType = (types0: string): number =>
    rows.findIndex((r) => r.kind === 'relation' && r.types[0] === types0);
  const defaults = DEFAULT_MAPPING.filter((r): r is RelationRow => r.kind === 'relation');
  for (const [d, row] of defaults.entries()) {
    if (!ROWS_NEW_IN_PART_6.includes(row.types[0]) || indexOfType(row.types[0]) >= 0) continue;
    if (rows.some((r) => r.property === row.property)) continue;
    // A type another row already reads stays that row's.
    const types = row.types.filter((type, i) => i === 0 || !reads(type));
    const added: RelationRow = { ...row, types, labels: [...row.labels] };
    if (row.mirror !== undefined) {
      // The mirror is named after the stored row of the mirrored type, which may have been renamed.
      const mirrored = defaults.find((r) => r.property === row.mirror);
      const at = mirrored && mirrored !== row ? indexOfType(mirrored.types[0]) : -1;
      if (mirrored === row) added.mirror = added.property;
      else if (at >= 0) added.mirror = rows[at].property;
      else delete added.mirror;
    }
    // Right after the stored row of the nearest default relation row before it, so the order stays that of the defaults.
    let insertAt = rows.length;
    for (let i = d - 1; i >= 0; i--) {
      const at = indexOfType(defaults[i].types[0]);
      if (at >= 0) {
        insertAt = at + 1;
        break;
      }
    }
    rows.splice(insertAt, 0, added);
  }
  return rows;
}

/** The set of default rows a stored mapping has had added (`friendly.defaultRowsSeen`); set 1: the part rows. */
export const DEFAULT_ROWS_SET = 1;

type KeyedRow = FieldRow | ComponentRow;

/** A default row of set 1 (it is added once by `addDefaultRows`). */
const isNewInSet = (row: MappingRow): row is KeyedRow => row.kind !== 'relation' && row.sinceReader === PARTS_READER;

/** The same row by `rowIdentity`, write keys compared ignoring case. */
const sameIdentity = (a: MappingRow, b: MappingRow): boolean =>
  rowIdentity(a).toUpperCase() === rowIdentity(b).toUpperCase();

/** Two default rows on the same vCard field: same write key and read patterns. */
const sameField = (a: KeyedRow, b: KeyedRow): boolean =>
  a.write === b.write && a.read.length === b.read.length && a.read.every((p, i) => p === b.read[i]);

/**
 * Adds the default rows of set `DEFAULT_ROWS_SET` (marked `sinceReader`) to a stored mapping, once: with `seen` at or
 * above the set nothing changes, so a row the owner removed does not come back. A new row
 * - is skipped when a row has its name, or (after copying, below) its identity; and when no older default row reads
 *   its field (it maps a field new to the mapping, e.g. gender) while a stored row reads one of its field names;
 * - copies read patterns and both write keys from its sibling, the first older default row on the same field (else
 *   the nearest new one before it, e.g. `gender` for `gender-identity`), as stored: the row with the sibling's
 *   identity, else with its name, when it is of the same kind (else the row keeps its own keys). So a part follows
 *   an edited write key and the field stays one line;
 * - goes right after the stored counterpart of the nearest default row before it, else at the end.
 */
export function addDefaultRows(stored: MappingRow[], seen: number): { rows: MappingRow[]; seen: number } {
  if (seen >= DEFAULT_ROWS_SET) return { rows: stored, seen };
  const rows = [...stored];
  const storedReads = (pattern: Pattern): boolean => {
    const name = parsePattern(pattern)?.name;
    return (
      name !== undefined && stored.some((r) => r.kind !== 'relation' && r.read.some((p) => parsePattern(p)?.name === name))
    );
  };
  const added = new Map<MappingRow, MappingRow>(); // default row -> the row added for it
  const counterpart = (row: MappingRow): MappingRow | undefined =>
    added.get(row) ?? rows.find((r) => sameIdentity(r, row)) ?? rows.find((r) => r.property === row.property);
  DEFAULT_MAPPING.forEach((row, d) => {
    if (!isNewInSet(row) || rows.some((r) => r.property === row.property)) return;
    const onField = DEFAULT_MAPPING.filter((r, i): r is KeyedRow => i !== d && r.kind !== 'relation' && sameField(r, row));
    const older = onField.find((r) => !isNewInSet(r));
    if (!older && row.read.some(storedReads)) return;
    const sibling = older ?? onField.filter((r) => DEFAULT_MAPPING.indexOf(r) < d).pop();
    const found = sibling && counterpart(sibling);
    const keys = found && found.kind === row.kind ? found : row;
    const next: KeyedRow = { ...row, read: [...keys.read], write: keys.write };
    if (keys.writeV3 !== undefined) next.writeV3 = keys.writeV3;
    else delete next.writeV3;
    if (rows.some((r) => sameIdentity(r, next))) return;
    let insertAt = rows.length;
    for (let i = d - 1; i >= 0; i--) {
      const before = counterpart(DEFAULT_MAPPING[i]);
      if (before) {
        insertAt = rows.indexOf(before) + 1;
        break;
      }
    }
    rows.splice(insertAt, 0, next);
    added.set(row, next);
  });
  return { rows, seen: DEFAULT_ROWS_SET };
}

/**
 * Rows whose names the code relies on (sync identity, card name, avatar): they cannot be renamed or removed.
 * Renaming `uid` would make Sync assign a new UID and create a duplicate card.
 */
export const FIXED_PROPERTIES = ['uid', 'name', 'photo'] as const;

/**
 * The rows with Sync set for row `index`: off stores `sync: false` and drops `syncSince`; on drops `sync` and stores
 * `syncSince: now` (a sync base stored before then is read without the row, see `rowsForBase`). A fixed row, or an
 * index outside the rows, is left as it is.
 */
export function withSync(rows: MappingRow[], index: number, on: boolean, now: number): MappingRow[] {
  const row = rows[index];
  if (!row || isFixedProperty(row.property)) return rows;
  const { sync: _sync, syncSince: _since, ...rest } = row;
  const next = (on ? { ...rest, syncSince: now } : { ...rest, sync: false }) as MappingRow;
  return rows.map((r, i) => (i === index ? next : r));
}

/** The note property that names the address book; set by the plugin, never read from or written to a card. */
export const RESERVED_PROPERTY = 'source';

/** The note property that turns Sync off for a note: `sync: false`. Reserved like `source`. */
export const SYNC_OFF_PROPERTY = 'sync';

/** True when the note says `sync: false` (a boolean, or the text "false" in any case). */
export function syncTurnedOff(frontmatter: Record<string, unknown>): boolean {
  const value = frontmatter[SYNC_OFF_PROPERTY];
  return value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'false');
}

export function isFixedProperty(property: string): boolean {
  return (FIXED_PROPERTIES as readonly string[]).includes(property);
}

/** What makes a row the same row when its name changes: its vCard identity, not its place in the table. */
function rowIdentity(row: MappingRow): string {
  if (row.kind === 'relation') return `relation|${row.types.join(',')}`;
  if (row.kind === 'component') return `component|${row.write}|${row.index}`;
  // They all write `X-ABDATE`; the label tells them apart.
  if (isLabelledDateRow(row)) return `date-label|${readableLabel(row.appleDateLabel).toLowerCase()}`;
  return `field|${row.write}`;
}

/**
 * Property renames from `before` to `after`. Rows are paired by identity (kind, write key, types or index); the rows
 * left unpaired (an identity that is ambiguous, or was edited) are paired by position, when as many are left on both
 * sides. The settings never add, remove or reorder rows, but a migrated mapping may differ in order from the defaults.
 */
export function mappingRenames(before: MappingRow[], after: MappingRow[]): { from: string; to: string }[] {
  const pairs = pairRows(before, after);
  const renames: { from: string; to: string }[] = [];
  after.forEach((row, i) => {
    const from = pairs.get(i)?.property;
    if (from !== undefined && from !== row.property) renames.push({ from, to: row.property });
  });
  return renames;
}

/** The row of `before` each row of `after` is (by index of `after`), paired as `mappingRenames` describes. */
function pairRows(before: MappingRow[], after: MappingRow[]): Map<number, MappingRow> {
  const count = (rows: MappingRow[], key: string) => rows.filter((r) => rowIdentity(r) === key).length;
  const pairs = new Map<number, MappingRow>(); // after index -> before row
  const usedBefore = new Set<number>();
  after.forEach((row, i) => {
    const key = rowIdentity(row);
    if (count(after, key) !== 1 || count(before, key) !== 1) return;
    const j = before.findIndex((b) => rowIdentity(b) === key);
    pairs.set(i, before[j]);
    usedBefore.add(j);
  });
  const restAfter = after.map((_, i) => i).filter((i) => !pairs.has(i));
  const restBefore = before.map((_, j) => j).filter((j) => !usedBefore.has(j));
  if (restAfter.length === restBefore.length) restAfter.forEach((i, k) => pairs.set(i, before[restBefore[k]]));
  return pairs;
}

/**
 * `defaults` (the rows Reset to defaults saves) with Sync on for every row, made safe against the `saved` rows they
 * replace. A row whose saved counterpart (paired as in `mappingRenames`) had Sync off gets `syncSince: now`, as
 * ticking Sync again does (see `withSync`): a sync base stored before then may still hold the row's old lines while
 * the card was cleaned, so it is read without the row (see `rowsForBase`). A row whose counterpart was on keeps that
 * row's `syncSince`, for the same reason. Fixed rows are always synced and get none.
 */
export function syncSafeReset(defaults: MappingRow[], saved: MappingRow[], now: number): MappingRow[] {
  const pairs = pairRows(saved, defaults);
  return defaults.map((row, i) => {
    const { sync: _sync, syncSince: _since, ...rest } = row;
    const was = pairs.get(i);
    if (isFixedProperty(row.property) || was === undefined) return rest as MappingRow;
    if (was.sync === false) return { ...rest, syncSince: now } as MappingRow;
    return (was.syncSince === undefined ? rest : { ...rest, syncSince: was.syncSince }) as MappingRow;
  });
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
  const labels = new Set<string>();
  const doubled = new Set<string>();
  // The first part row per write key; the parts of one field are one line, so they share its 3.0 key too.
  const firstPart = new Map<string, ComponentRow>();
  for (const row of rows) {
    const key = row.property.trim();
    if (key === '') errors.push('A property name is empty.');
    if (key === RESERVED_PROPERTY) errors.push('`source` is reserved for the address book.');
    if (key === SYNC_OFF_PROPERTY) errors.push('`sync` is reserved for turning Sync off for a note.');
    if (seen.has(key)) errors.push(`Duplicate property name: ${key}`);
    seen.add(key);
    // Friendly names are lower-case; only the upper-case spelling collides with a vCard key in old-style notes.
    if (VCARD_NAMES.has(key) || key.startsWith('X-')) {
      errors.push(`Property name "${key}" is a vCard name.`);
    }
    if (isLabelledDateRow(row)) {
      const label = readableLabel(row.appleDateLabel);
      if (label === '') errors.push('A date has no label.');
      else if (label.includes(',')) errors.push(`The label "${label}" cannot hold a comma.`);
    }
    if (row.kind === 'field' && row.appleDateLabel !== undefined) {
      const label = readableLabel(row.appleDateLabel);
      const lower = label.toLowerCase();
      if (label !== '' && labels.has(lower) && !doubled.has(lower)) {
        doubled.add(lower);
        errors.push(`Two dates have the label "${label}".`);
      }
      labels.add(lower);
    }
    if (row.kind !== 'relation') {
      if (row.read.length === 0 && !isLabelledDateRow(row)) errors.push(`Property "${key}" has no read pattern.`);
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
    if (row.kind !== 'relation') {
      const v3 = row.writeV3?.trim() ?? '';
      if (v3 !== '' && v3.split(';')[0].trim() === '') {
        errors.push(`Property "${key}" has an invalid vCard 3.0 write key.`);
      }
    }
    if (row.kind === 'component' && !(Number.isInteger(row.index) && row.index >= 0)) {
      errors.push(`Property "${key}" has an invalid part.`);
    }
    if (row.kind === 'component') {
      const first = firstPart.get(row.write);
      if (!first) firstPart.set(row.write, row);
      else if ((first.writeV3?.trim() ?? '') !== (row.writeV3?.trim() ?? '')) {
        const other = first.property.trim();
        errors.push(`Properties "${other}" and "${key}" both write ${row.write}; give them the same vCard 3.0 write key.`);
      }
    }
  }
  return errors;
}
