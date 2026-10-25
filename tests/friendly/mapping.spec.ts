import { insertLabelledDateRow, labelledDateRow } from 'src/contacts/friendly/dateLabels';
import { parseCard } from 'src/contacts/friendly/lines';
import {
  addDefaultRows,
  APPLE_BUILTIN_LABELS,
  DEFAULT_MAPPING,
  DEFAULT_ROWS_SET,
  FIXED_PROPERTIES,
  isFixedProperty,
  isMappedProperty,
  lineIsSkipped,
  labelText,
  mappingRenames,
  migrateMapping,
  matchesPattern,
  MappingRow,
  rowForLine,
  rowForProperty,
  renameRow,
  syncRows,
  syncTurnedOff,
  validateMapping,
  withSync,
  writeKeyFor,
  writeLabel,
} from 'src/contacts/friendly/mapping';
import { RelationContext } from 'src/contacts/friendly/relations';
import { newCard } from 'src/contacts/friendly/translate';
import { readVcfFixture } from 'tests/fixtures/fixtures';
import { describe, expect, it } from 'vitest';

const lines = parseCard(readVcfFixture('appleV3.vcf'));
const line = (text: string) => parseCard(text)[0];
const names = (rows: MappingRow[]) => rows.map((r) => r.property);
const rowsFor = (text: string) => names(rowForLine(line(text), DEFAULT_MAPPING));

describe('friendly mapping', () => {
  it('matches apple types', () => {
    const tel = lines.find((l) => l.group === 'item1' && l.name === 'TEL')!;
    expect(names(rowForLine(tel, DEFAULT_MAPPING))).toEqual(['mobile']);
    expect(rowsFor('EMAIL;type=INTERNET:a@b.nl')).toEqual(['email']);
    expect(rowsFor('EMAIL;type=INTERNET;type=WORK:a@b.nl')).toEqual(['work-email']);
    expect(rowsFor('TEL;type=WORK;type=FAX:123')).toEqual([]);
    expect(rowsFor('item2.URL;type=pref:https://x.nl')).toEqual(['website']);
  });

  it('matches patterns', () => {
    expect(matchesPattern(line('TEL;TYPE=work,fax:1'), 'TEL[FAX,WORK]')).toBe(true);
    expect(matchesPattern(line('TEL;TYPE=WORK:1'), 'TEL')).toBe(false);
    expect(matchesPattern(line('TEL:1'), 'TEL')).toBe(true);
    expect(matchesPattern(line('PHOTO;TYPE=JPEG:x'), 'PHOTO[*]')).toBe(true);
    expect(matchesPattern(line('PHOTO:x'), 'PHOTO[*]')).toBe(true);
    expect(matchesPattern(line('TEL:1'), 'EMAIL')).toBe(false);
  });

  it('structured rows', () => {
    expect(rowsFor('ADR;type=HOME;type=pref:;;Dorpsstraat 1;Utrecht;;1234 AB;Nederland')).toEqual([
      'po-box',
      'address-extra',
      'street',
      'postcode',
      'city',
      'region',
      'country',
    ]);
    expect(rowsFor('ADR;TYPE=WORK:;;a;b;c;d;e')).toEqual([
      'work-po-box',
      'work-address-extra',
      'work-street',
      'work-postcode',
      'work-city',
      'work-region',
      'work-country',
    ]);
    expect(rowsFor('N:Vries;Jan;;;')).toEqual([
      'name-prefix', 'firstname', 'middlename', 'lastname', 'name-suffix',
    ]);
    expect(rowsFor('ORG:Acme;Sales')).toEqual(['company', 'department']);
  });

  it('has the specified component indexes and write keys', () => {
    const idx = (p: string) => (rowForProperty(p, DEFAULT_MAPPING)!.row as { index: number }).index;
    expect([idx('lastname'), idx('firstname'), idx('middlename')]).toEqual([0, 1, 2]);
    expect(['street', 'city', 'region', 'postcode', 'country'].map(idx)).toEqual([2, 3, 4, 5, 6]);
    expect(rowForProperty('work-city', DEFAULT_MAPPING)!.row).toMatchObject({ write: 'ADR;TYPE=WORK', index: 3 });
    expect(rowForProperty('categories', DEFAULT_MAPPING)!.row).toMatchObject({ format: 'list' });
    expect(rowForProperty('birthday', DEFAULT_MAPPING)!.row).toMatchObject({ format: 'date' });
    expect(rowForProperty('anniversary', DEFAULT_MAPPING)!.row).toMatchObject({ format: 'date' });
  });

  it('property ordinals', () => {
    const mobile = DEFAULT_MAPPING.find((r) => r.property === 'mobile');
    expect(rowForProperty('mobile', DEFAULT_MAPPING)).toEqual({ row: mobile, ordinal: 1 });
    expect(rowForProperty('mobile-2', DEFAULT_MAPPING)).toEqual({ row: mobile, ordinal: 2 });
    expect(rowForProperty('work-email-3', DEFAULT_MAPPING)?.ordinal).toBe(3);
    expect(rowForProperty('met-via', DEFAULT_MAPPING)).toBeUndefined();
    expect(isMappedProperty('mobile-2', DEFAULT_MAPPING)).toBe(true);
    expect(isMappedProperty('met-via', DEFAULT_MAPPING)).toBe(false);
  });

  it('relation rows', () => {
    expect(rowsFor('RELATED;TYPE=co-worker:urn:uuid:x')).toEqual(['colleagues']);
    expect(rowsFor('RELATED;TYPE=Child:urn:uuid:x')).toEqual(['children']);
    expect(rowsFor('RELATED;TYPE=crush:urn:uuid:x')).toEqual([]);
    const spouse = rowForProperty('spouse', DEFAULT_MAPPING)!.row;
    expect(spouse).toMatchObject({ kind: 'relation', single: true, mirror: 'spouse', write: 'RELATED;TYPE=spouse' });
    expect(rowForProperty('emergency', DEFAULT_MAPPING)!.row).not.toHaveProperty('mirror');
    expect(rowForProperty('children', DEFAULT_MAPPING)!.row).toMatchObject({ mirror: 'parents', types: ['child'] });
  });

  it('relation rows match X-ABRELATEDNAMES by the label of its group', () => {
    const labelled = (text: string, label?: string) => names(rowForLine(line(text), DEFAULT_MAPPING, label));
    expect(labelled('item1.X-ABRELATEDNAMES:Ger', '_$!<Father>!$_')).toEqual(['parents']);
    expect(labelled('item1.X-ABRELATEDNAMES:Pim', 'co-worker')).toEqual(['colleagues']);
    expect(labelled('item1.X-ABRELATEDNAMES:Sanne', 'Domestic-partner, Spouse')).toEqual(['spouse']);
    expect(labelled('item1.X-ABRELATEDNAMES:Kees', 'Godfather')).toEqual([]);
    expect(labelled('X-ABRELATEDNAMES;TYPE=other:Kees')).toEqual([]);
    // RELATED is still matched by its type; a label never makes another line a relation.
    expect(labelled('item1.RELATED;TYPE=friend:urn:uuid:x', '_$!<Father>!$_')).toEqual(['friends']);
    expect(labelled('item1.NOTE:x', '_$!<Father>!$_')).toEqual(['note']);
  });

  it('the anniversary row matches X-ABDATE with its date label only', () => {
    const labelled = (text: string, label?: string) => names(rowForLine(line(text), DEFAULT_MAPPING, label));
    expect(labelled('item1.X-ABDATE:2012-06-21', '_$!<Anniversary>!$_')).toEqual(['anniversary']);
    expect(labelled('item1.X-ABDATE:2012-06-21', 'ANNIVERSARY')).toEqual(['anniversary']);
    expect(labelled('item1.X-ABDATE:2012-06-21', '_$!<Other>!$_')).toEqual([]);
    expect(labelled('X-ABDATE:2012-06-21')).toEqual([]);
    expect(labelled('ANNIVERSARY:20120621')).toEqual(['anniversary']);
  });

  it('default mapping is valid', () => {
    expect(validateMapping(DEFAULT_MAPPING)).toEqual([]);
  });

  it('validates', () => {
    const rows: MappingRow[] = [
      { kind: 'field', property: 'mobile', read: ['TEL[CELL]'], write: 'TEL;TYPE=CELL' },
      { kind: 'field', property: 'mobile', read: ['TEL[HOME]'], write: 'TEL;TYPE=HOME' },
      { kind: 'field', property: 'TEL', read: ['TEL'], write: 'TEL' },
      { kind: 'field', property: 'broken', read: ['TEL[CELL'], write: 'TEL' },
    ];
    const errors = validateMapping(rows);
    expect(errors.some((e) => e.includes('mobile'))).toBe(true);
    expect(errors.some((e) => e.includes('TEL') && e.includes('vCard'))).toBe(true);
    expect(errors.some((e) => e.includes('TEL[CELL'))).toBe(true);
  });

  it.each([
    [false, true],
    ['False', true],
    [' false ', true],
    [true, false],
    [undefined, false],
    ['no', false],
  ])('syncTurnedOff(sync: %j) is %s', (value, off) =>
    expect(syncTurnedOff(value === undefined ? {} : { sync: value })).toBe(off),
  );

  it('a row named sync is refused', () =>
    expect(
      validateMapping([...DEFAULT_MAPPING, { kind: 'field', property: 'sync', read: ['X-SYNC'], write: 'X-SYNC' }]),
    ).toContain('`sync` is reserved for turning Sync off for a note.'));

  it('source is reserved', () => {
    const rows: MappingRow[] = [
      ...DEFAULT_MAPPING,
      { kind: 'field', property: 'source', read: ['X-SOURCE'], write: 'X-SOURCE' },
    ];
    expect(validateMapping(rows).some((e) => e.includes('`source` is reserved for the address book.'))).toBe(true);
  });

  it('reports a mirror that names no relation row', () => {
    const rows = DEFAULT_MAPPING.map((r) => (r.property === 'parents' ? { ...r, mirror: 'children2' } : r)) as MappingRow[];
    const errors = validateMapping(rows);
    expect(errors.some((e) => e.includes('parents') && e.includes('children2'))).toBe(true);
    const withField = DEFAULT_MAPPING.map((r) => (r.property === 'parents' ? { ...r, mirror: 'mobile' } : r)) as MappingRow[];
    expect(validateMapping(withField).some((e) => e.includes('mobile'))).toBe(true);
  });
});

describe('renameRow', () => {
  const mirrorOf = (rows: MappingRow[], property: string) => {
    const row = rows.find((r) => r.property === property);
    return row?.kind === 'relation' ? row.mirror : undefined;
  };

  it('renames the row and repoints the mirrors that named it', () => {
    const rows = renameRow(DEFAULT_MAPPING, 'children', 'kids');
    expect(names(rows)).toContain('kids');
    expect(names(rows)).not.toContain('children');
    expect(mirrorOf(rows, 'parents')).toBe('kids');
    expect(validateMapping(rows)).toEqual([]);
  });

  it('repoints self-mirrors too', () => {
    const rows = renameRow(DEFAULT_MAPPING, 'spouse', 'echtgenoot');
    expect(mirrorOf(rows, 'echtgenoot')).toBe('echtgenoot');
    expect(validateMapping(rows)).toEqual([]);
  });

  it('leaves other rows alone and does not mutate its input', () => {
    const before = structuredClone(DEFAULT_MAPPING);
    const rows = renameRow(DEFAULT_MAPPING, 'mobile', 'cell');
    expect(DEFAULT_MAPPING).toEqual(before);
    expect(names(rows).indexOf('cell')).toBe(names(DEFAULT_MAPPING).indexOf('mobile'));
    expect(mirrorOf(rows, 'siblings')).toBe('siblings');
  });
});

describe('fixed rows', () => {
  it('uid, name and photo cannot be renamed or removed', () => {
    expect(FIXED_PROPERTIES).toEqual(['uid', 'name', 'photo']);
    for (const property of FIXED_PROPERTIES) {
      expect(isFixedProperty(property)).toBe(true);
      const renamed = renameRow(DEFAULT_MAPPING, property, `my-${property}`);
      expect(validateMapping(renamed).some((e) => e.includes(`"${property}"`))).toBe(true);
      const removed = DEFAULT_MAPPING.filter((r) => r.property !== property);
      expect(validateMapping(removed).some((e) => e.includes(`"${property}"`))).toBe(true);
    }
    expect(isFixedProperty('mobile')).toBe(false);
  });
});

describe('mappingRenames', () => {
  it('lists the renamed rows, old name to new name', () => {
    const renamed = renameRow(renameRow(DEFAULT_MAPPING, 'mobile', 'cell'), 'children', 'kids');
    expect(mappingRenames(DEFAULT_MAPPING, renamed)).toEqual([
      { from: 'mobile', to: 'cell' },
      { from: 'children', to: 'kids' },
    ]);
    expect(mappingRenames(DEFAULT_MAPPING, DEFAULT_MAPPING)).toEqual([]);
  });

  it('Reset to defaults implies renaming every changed name back', () => {
    const current = renameRow(renameRow(DEFAULT_MAPPING, 'mobile', 'cell'), 'phone', 'mobile');
    expect(mappingRenames(current, DEFAULT_MAPPING)).toEqual([
      { from: 'cell', to: 'mobile' },
      { from: 'mobile', to: 'phone' },
    ]);
  });
});

const relationRows = (rows: MappingRow[]) =>
  rows.filter((r): r is Extract<MappingRow, { kind: 'relation' }> => r.kind === 'relation');
const labelsOf = (rows: MappingRow[], property: string) =>
  relationRows(rows).find((r) => r.property === property)?.labels;
/** A mapping as stored by an older version: no labels, no partner row, no anniversary label. */
const legacyMapping = (): MappingRow[] =>
  DEFAULT_MAPPING.filter((r) => r.property !== 'partner').map((row) => {
    const { labels: _labels, appleDateLabel: _date, ...rest } = row as any;
    return rest as MappingRow;
  });

describe('relationship labels', () => {
  it('default rows carry the labels of the spec table', () => {
    expect(Object.fromEntries(relationRows(DEFAULT_MAPPING).map((r) => [r.property, r.labels]))).toEqual({
      spouse: ['Spouse'],
      partner: ['Partner'],
      children: ['Child'],
      parents: ['Parent', 'Mother', 'Father'],
      siblings: ['Sibling', 'Brother', 'Sister'],
      family: ['Kin', 'Relative'],
      friends: ['Friend'],
      colleagues: ['Colleague', 'Co-worker', 'Assistant', 'Manager'],
      neighbours: ['Neighbor'],
      housemates: ['Co-resident'],
      acquaintances: ['Acquaintance'],
      met: ['Met'],
      emergency: ['Emergency'],
    });
  });

  it('has a partner row after spouse, single and mirrored by itself', () => {
    const order = names(DEFAULT_MAPPING);
    expect(order.indexOf('partner')).toBe(order.indexOf('spouse') + 1);
    const partner = relationRows(DEFAULT_MAPPING).find((r) => r.property === 'partner')!;
    expect(partner).toMatchObject({
      types: ['sweetheart', 'partner'],
      mirror: 'partner',
      single: true,
      write: 'RELATED;TYPE=sweetheart',
    });
  });

  it('the partner row reads RELATED;TYPE=partner too (DAVx5 writes Android\'s Partner so on 4.0)', () => {
    expect(rowsFor('RELATED;TYPE=sweetheart;VALUE=text:Sanne')).toEqual(['partner']);
    expect(rowsFor('RELATED;TYPE=partner;VALUE=text:Sanne')).toEqual(['partner']);
  });

  it('the anniversary row has the Apple date label', () => {
    const row = DEFAULT_MAPPING.find((r) => r.property === 'anniversary');
    expect(row).toMatchObject({ kind: 'field', appleDateLabel: 'Anniversary' });
  });

  it('knows the Apple built-in labels', () => {
    expect([...APPLE_BUILTIN_LABELS].sort()).toEqual(
      ['anniversary', 'assistant', 'brother', 'child', 'father', 'friend', 'manager', 'mother', 'parent', 'partner', 'sister', 'spouse'],
    );
  });

  it('label text from apple and plain labels', () => {
    expect(labelText('_$!<Spouse>!$_')).toEqual(['spouse']);
    expect(labelText('Domestic-partner, Spouse')).toEqual(['domestic-partner', 'spouse']);
    expect(labelText('  Co-worker ')).toEqual(['co-worker']);
    expect(labelText('_$!<Father>!$_, Mentor')).toEqual(['father', 'mentor']);
    expect(labelText('')).toEqual([]);
  });

  it('write label', () => {
    expect(writeLabel('Spouse')).toBe('_$!<Spouse>!$_');
    expect(writeLabel('Anniversary')).toBe('_$!<Anniversary>!$_');
    expect(writeLabel('mother')).toBe('_$!<mother>!$_');
    expect(writeLabel('Colleague')).toBe('Colleague');
    expect(writeLabel('Co-resident')).toBe('Co-resident');
  });

  it('renaming and resetting keep the labels and the date label', () => {
    const renamed = renameRow(DEFAULT_MAPPING, 'children', 'kids');
    expect(labelsOf(renamed, 'kids')).toEqual(['Child']);
    expect(renamed.find((r) => r.property === 'anniversary')).toMatchObject({ appleDateLabel: 'Anniversary' });
  });
});

describe('mapping migration', () => {
  it('migration adds partner and labels', () => {
    const migrated = migrateMapping(legacyMapping());
    expect(labelsOf(migrated, 'parents')).toEqual(['Parent', 'Mother', 'Father']);
    expect(labelsOf(migrated, 'colleagues')).toEqual(['Colleague', 'Co-worker', 'Assistant', 'Manager']);
    expect(labelsOf(migrated, 'partner')).toEqual(['Partner']);
    expect(migrated.find((r) => r.property === 'anniversary')).toMatchObject({ appleDateLabel: 'Anniversary' });
    expect(names(migrated).filter((n) => n === 'partner')).toHaveLength(1);
    expect(migrated).toEqual(expect.arrayContaining(DEFAULT_MAPPING));
    expect(validateMapping(migrated)).toEqual([]);
  });

  it('migration keeps renamed rows', () => {
    let stored = renameRow(legacyMapping(), 'children', 'kinderen');
    stored = renameRow(stored, 'parents', 'ouders');
    stored = stored.map((r) => (r.property === 'anniversary' ? { ...r, property: 'trouwdag', write: 'ANNIVERSARY' } : r));
    const migrated = migrateMapping(stored);
    expect(labelsOf(migrated, 'kinderen')).toEqual(['Child']);
    expect(labelsOf(migrated, 'ouders')).toEqual(['Parent', 'Mother', 'Father']);
    expect(migrated.find((r) => r.property === 'trouwdag')).toMatchObject({ appleDateLabel: 'Anniversary' });
    expect(names(migrated).filter((n) => n !== 'partner')).toEqual(names(stored));
    expect(names(migrated).indexOf('partner')).toBe(names(migrated).indexOf('spouse') + 1);
    expect(names(migrated)).not.toContain('children');
    expect(relationRows(migrated).find((r) => r.property === 'ouders')!.mirror).toBe('kinderen');
    expect(names(migrated)).toContain('partner');
    expect(validateMapping(migrated)).toEqual([]);
  });

  it('migration keeps labels the owner already has', () => {
    const stored = DEFAULT_MAPPING.map((r) => (r.property === 'friends' ? { ...r, labels: ['Buddy'] } : r)) as MappingRow[];
    expect(labelsOf(migrateMapping(stored), 'friends')).toEqual(['Buddy']);
  });

  it('migration is idempotent', () => {
    const once = migrateMapping(legacyMapping());
    expect(migrateMapping(once)).toEqual(once);
    expect(migrateMapping(DEFAULT_MAPPING)).toEqual(DEFAULT_MAPPING);
  });

  it('migration lets a migrated partner row read the partner type too, once', () => {
    const alpha7 = migrateMapping(legacyMapping()).map((r) =>
      r.kind === 'relation' && r.types[0] === 'sweetheart' ? { ...r, property: 'vriendin', mirror: 'vriendin', types: ['sweetheart'] } : r,
    );
    const migrated = migrateMapping(alpha7);
    expect(relationRows(migrated).find((r) => r.property === 'vriendin')!.types).toEqual(['sweetheart', 'partner']);
    expect(migrateMapping(migrated)).toEqual(migrated);
    expect(validateMapping(migrated)).toEqual([]);
    // Only the row that writes sweetheart; and not when another row already reads partner.
    expect(relationRows(migrated).filter((r) => r.types.includes('partner'))).toHaveLength(1);
    const taken = [
      ...alpha7,
      { kind: 'relation', property: 'lovers', types: ['partner'], write: 'RELATED;TYPE=partner', labels: ['Lover'] } as MappingRow,
    ];
    expect(relationRows(migrateMapping(taken)).find((r) => r.property === 'vriendin')!.types).toEqual(['sweetheart']);
    const added = migrateMapping([...legacyMapping(), taken[taken.length - 1]]);
    expect(relationRows(added).find((r) => r.property === 'partner')!.types).toEqual(['sweetheart']);
  });

  it('migration does not change its input', () => {
    const stored = legacyMapping();
    const before = structuredClone(stored);
    migrateMapping(stored);
    expect(stored).toEqual(before);
  });

  it('migration does not add a partner row when the name is taken', () => {
    const stored = [...legacyMapping(), { kind: 'field', property: 'partner', read: ['X-PARTNER'], write: 'X-PARTNER' } as MappingRow];
    const migrated = migrateMapping(stored);
    expect(names(migrated).filter((n) => n === 'partner')).toHaveLength(1);
    expect(validateMapping(migrated)).toEqual([]);
  });

  it('validateMapping accepts the new rows', () => {
    expect(validateMapping(DEFAULT_MAPPING)).toEqual([]);
    expect(validateMapping(migrateMapping(legacyMapping()))).toEqual([]);
  });
});

describe('migration order and scope', () => {
  it('an unrenamed migrated mapping has the order of the defaults', () => {
    expect(names(migrateMapping(legacyMapping()))).toEqual(names(DEFAULT_MAPPING));
  });

  it('puts a new row after the stored row of the row before it, whatever its name', () => {
    const migrated = migrateMapping(renameRow(legacyMapping(), 'spouse', 'echtgenoot'));
    const order = names(migrated);
    expect(order.indexOf('partner')).toBe(order.indexOf('echtgenoot') + 1);
  });

  it('reset after migrating a legacy mapping offers no renames', () => {
    expect(mappingRenames(migrateMapping(legacyMapping()), DEFAULT_MAPPING)).toEqual([]);
    const renamed = renameRow(migrateMapping(legacyMapping()), 'children', 'kinderen');
    expect(mappingRenames(renamed, DEFAULT_MAPPING)).toEqual([{ from: 'kinderen', to: 'children' }]);
  });

  it('rename diff pairs rows by identity', () => {
    const before = DEFAULT_MAPPING;
    const reordered = [...before.slice(0, 5), ...before.slice(-3), ...before.slice(5, -3)];
    const after = renameRow(reordered, 'mobile', 'cell');
    expect(mappingRenames(before, after)).toEqual([{ from: 'mobile', to: 'cell' }]);
    const withoutPartner = before.filter((r) => r.property !== 'partner');
    expect(mappingRenames(withoutPartner, before)).toEqual([]);
    // an edited write key is still the same row (fallback by position among the unpaired rows)
    const edited = before.map((r) => (r.property === 'mobile' ? { ...r, property: 'cell', write: 'TEL;TYPE=CELL,VOICE' } : r));
    expect(mappingRenames(before, edited)).toEqual([{ from: 'mobile', to: 'cell' }]);
  });

  it('does not bring back a default row the owner deleted', () => {
    const stored = migrateMapping(legacyMapping()).filter((r) => r.property !== 'emergency');
    expect(names(migrateMapping(stored))).not.toContain('emergency');
  });

  it('a custom relation row gets its type as label', () => {
    const custom = { kind: 'relation', property: 'mentors', types: ['mentor'], write: 'RELATED;TYPE=mentor' } as MappingRow;
    expect(labelsOf(migrateMapping([...legacyMapping(), custom]), 'mentors')).toEqual(['Mentor']);
  });
});

describe('labelled date rows in a mapping', () => {
  const dating = labelledDateRow('Verkering', 'dating');
  const withDating = insertLabelledDateRow(DEFAULT_MAPPING, dating);
  const renamed = (rows: MappingRow[], from: string, to: string) => renameRow(rows, from, to);

  it('is valid', () => {
    expect(validateMapping(withDating)).toEqual([]);
  });

  it('refuses a label that anniversary has', () => {
    expect(validateMapping(insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('anniversary', 'dating')))).toContain(
      'Two dates have the label "anniversary".',
    );
  });

  it('refuses two rows with one label, ignoring case', () => {
    const rows = insertLabelledDateRow(withDating, labelledDateRow('VERKERING', 'dating-b'));
    expect(validateMapping(rows)).toContain('Two dates have the label "VERKERING".');
  });

  it('refuses a comma and an empty label', () => {
    expect(validateMapping(insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('A, B', 'dating')))).toContain(
      'The label "A, B" cannot hold a comma.',
    );
    expect(validateMapping(insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('', 'dating')))).toContain(
      'A date has no label.',
    );
  });

  it('still wants a read pattern on other rows', () => {
    const rows = DEFAULT_MAPPING.map((r) => (r.property === 'title' ? { ...r, read: [] } : r));
    expect(validateMapping(rows)).toContain('Property "title" has no read pattern.');
  });

  it('renames a labelled row by its label, not its position', () => {
    const two = insertLabelledDateRow(withDating, labelledDateRow('Eerste kus', 'first-kiss'));
    expect(mappingRenames(two, renamed(two, 'dating', 'started-dating'))).toEqual([
      { from: 'dating', to: 'started-dating' },
    ]);
    expect(mappingRenames(DEFAULT_MAPPING, withDating)).toEqual([]);
    expect(mappingRenames(withDating, DEFAULT_MAPPING)).toEqual([]);
  });
});

describe('parts and the vCard 3.0 write key', () => {
  const row = (property: string) => DEFAULT_MAPPING.find((r) => r.property === property)!;
  const order = names(DEFAULT_MAPPING);
  const containsSequence = (sequence: string[]) => {
    const at = order.indexOf(sequence[0]);
    return at >= 0 && sequence.every((p, i) => order[at + i] === p);
  };

  it('writeKeyFor picks the 3.0 key only for versions other than 4.0', () => {
    const gender = row('gender') as Exclude<MappingRow, { kind: 'relation' }>;
    expect(writeKeyFor(gender, '3.0')).toBe('X-GENDER');
    expect(writeKeyFor(gender, '4.0')).toBe('GENDER');
    expect(writeKeyFor(gender, ' 4.0 ')).toBe('GENDER');
    expect(writeKeyFor({ ...gender, writeV3: '  ' }, '3.0')).toBe('GENDER');
    expect(writeKeyFor({ ...gender, writeV3: ' X-SEX ' }, '3.0')).toBe('X-SEX');
  });

  it('has the new rows in place', () => {
    expect(containsSequence(['name', 'name-prefix', 'firstname', 'middlename', 'lastname', 'name-suffix'])).toBe(true);
    expect(containsSequence(['company', 'department'])).toBe(true);
    expect(containsSequence(['role', 'gender', 'gender-identity'])).toBe(true);
    expect(containsSequence(['po-box', 'address-extra', 'street'])).toBe(true);
    expect(containsSequence(['work-po-box', 'work-address-extra', 'work-street'])).toBe(true);
  });

  it('gives the new rows their part and read/write keys', () => {
    expect(row('name-prefix')).toMatchObject({ kind: 'component', read: ['N'], write: 'N', index: 3 });
    expect(row('name-suffix')).toMatchObject({ kind: 'component', read: ['N'], write: 'N', index: 4 });
    expect(row('department')).toMatchObject({ kind: 'component', read: ['ORG'], write: 'ORG', index: 1 });
    expect(row('gender')).toMatchObject({
      read: ['GENDER', 'X-GENDER'], write: 'GENDER', writeV3: 'X-GENDER', index: 0,
    });
    expect(row('gender-identity')).toMatchObject({
      read: ['GENDER', 'X-GENDER'], write: 'GENDER', writeV3: 'X-GENDER', index: 1,
    });
    expect(row('po-box')).toMatchObject({ write: 'ADR;TYPE=HOME', index: 0 });
    expect(row('address-extra')).toMatchObject({ write: 'ADR;TYPE=HOME', index: 1 });
    expect(row('work-po-box')).toMatchObject({ write: 'ADR;TYPE=WORK', index: 0 });
    expect(row('work-address-extra')).toMatchObject({ write: 'ADR;TYPE=WORK', index: 1 });
  });

  it('marks only the new rows with sinceReader 3', () => {
    const added = [
      'name-prefix', 'name-suffix', 'department', 'gender', 'gender-identity',
      'po-box', 'address-extra', 'work-po-box', 'work-address-extra',
    ];
    for (const r of DEFAULT_MAPPING) {
      const since = (r as { sinceReader?: number }).sinceReader;
      if (added.includes(r.property)) expect(since, r.property).toBe(3);
      else expect(since, r.property).toBeUndefined();
    }
  });

  it('validates the defaults and the new fields', () => {
    expect(validateMapping(DEFAULT_MAPPING)).toEqual([]);
    const dept = (index: number) =>
      validateMapping(DEFAULT_MAPPING.map((r) => (r.property === 'department' ? { ...r, index } : r)) as MappingRow[]);
    expect(dept(-1)).toContain('Property "department" has an invalid part.');
    expect(dept(1.5)).toContain('Property "department" has an invalid part.');
    expect(dept(0)).toEqual([]);
    const gender = (writeV3: string) =>
      validateMapping(DEFAULT_MAPPING.map((r) => (r.write === 'GENDER' ? { ...r, writeV3 } : r)) as MappingRow[]);
    expect(gender(';TYPE=X')).toContain('Property "gender" has an invalid vCard 3.0 write key.');
    expect(gender('')).toEqual([]);
    expect(gender('  ')).toEqual([]);
    expect(gender('X-FOO;TYPE=X')).toEqual([]);
  });

  it('rows on the same field must agree on their vCard 3.0 write key', () => {
    const identity = (writeV3: string | undefined) =>
      validateMapping(
        DEFAULT_MAPPING.map((r) => (r.property === 'gender-identity' ? { ...r, writeV3 } : r)) as MappingRow[],
      );
    const message = 'Properties "gender" and "gender-identity" both write GENDER; give them the same vCard 3.0 write key.';
    expect(identity('X-SEX')).toEqual([message]);
    expect(identity(undefined)).toEqual([message]);
    expect(identity(' X-GENDER ')).toEqual([]);
    const department = validateMapping(
      DEFAULT_MAPPING.map((r) => (r.property === 'department' ? { ...r, writeV3: 'X-ORG' } : r)) as MappingRow[],
    );
    expect(department).toEqual(['Properties "company" and "department" both write ORG; give them the same vCard 3.0 write key.']);
  });

  it('default rows on the same field read and write alike', () => {
    const parts = DEFAULT_MAPPING.filter((r) => r.kind === 'component');
    for (const a of parts) {
      for (const b of parts.filter((r) => r.write === a.write)) {
        expect(b.read, `${a.property} / ${b.property}`).toEqual(a.read);
        expect(b.writeV3, `${a.property} / ${b.property}`).toEqual(a.writeV3);
      }
    }
  });
});

describe('adding the new default rows', () => {
  /** A mapping stored before the part rows existed. */
  const withoutNew = (): MappingRow[] => DEFAULT_MAPPING.filter((r) => (r as { sinceReader?: number }).sinceReader === undefined);
  const find = (rows: MappingRow[], property: string) => rows.find((r) => r.property === property);
  const after = (rows: MappingRow[], property: string) => names(rows)[names(rows).indexOf(property) + 1];
  const ctx: RelationContext = { uidToName: () => undefined, displayName: () => undefined, resolveLink: (name) => ({ text: name }) };

  it('adds the new rows to an old default mapping, in the default order', () => {
    const { rows, seen } = addDefaultRows(withoutNew(), 0);
    expect(DEFAULT_ROWS_SET).toBe(1);
    expect(rows).toStrictEqual(DEFAULT_MAPPING);
    expect(seen).toBe(1);
    expect(validateMapping(rows)).toEqual([]);
  });

  it('adds nothing once the set has been seen: a removed row does not come back', () => {
    const stored = withoutNew();
    const { rows, seen } = addDefaultRows(stored, 1);
    expect(rows).toEqual(withoutNew());
    expect(seen).toBe(1);
    expect(addDefaultRows(stored, 2).seen).toBe(2);
  });

  it('changes nothing the second time', () => {
    const once = addDefaultRows(withoutNew(), 0);
    expect(addDefaultRows(once.rows, once.seen)).toEqual(once);
    // Even when the record was lost: every new row is there by name.
    expect(addDefaultRows(once.rows, 0)).toEqual(once);
    expect(addDefaultRows(DEFAULT_MAPPING, 0)).toEqual({ rows: DEFAULT_MAPPING, seen: 1 });
  });

  it('a new address part follows the edited keys of its stored sibling, so the address stays one line', () => {
    const home = ['street', 'postcode', 'city', 'region', 'country'];
    const stored = withoutNew().map((r) =>
      home.includes(r.property) ? ({ ...r, write: 'ADR;TYPE=home', read: ['ADR[HOME]'] } as MappingRow) : r,
    );
    const { rows } = addDefaultRows(stored, 0);
    expect(find(rows, 'po-box')).toMatchObject({ kind: 'component', write: 'ADR;TYPE=home', read: ['ADR[HOME]'], index: 0, sinceReader: 3 });
    expect(find(rows, 'address-extra')).toMatchObject({ write: 'ADR;TYPE=home', read: ['ADR[HOME]'], index: 1 });
    expect((find(rows, 'po-box') as { read: string[] }).read).not.toBe((find(stored, 'street') as { read: string[] }).read);
    expect(find(rows, 'work-po-box')).toMatchObject({ write: 'ADR;TYPE=WORK', read: ['ADR[WORK]'], index: 0 });
    const card = newCard({ uid: 'a', name: 'Anna', 'po-box': 'PO 1', street: 'Main 1' }, rows, ctx);
    expect(card.lines.filter((l) => l.name === 'ADR')).toHaveLength(1);
  });

  it('a renamed sibling is found by its identity, an edited one by its default name', () => {
    const renamed = withoutNew().map((r) =>
      r.property === 'company' ? ({ ...r, property: 'firm', read: ['ORG', 'ORG[WORK]'], writeV3: 'X-ORG' } as MappingRow) : r,
    );
    const { rows } = addDefaultRows(renamed, 0);
    expect(after(rows, 'firm')).toBe('department');
    expect(find(rows, 'department')).toMatchObject({ read: ['ORG', 'ORG[WORK]'], write: 'ORG', writeV3: 'X-ORG', index: 1, sinceReader: 3 });

    const edited = withoutNew().map((r) => (r.property === 'company' ? ({ ...r, write: 'ORG;TYPE=WORK' } as MappingRow) : r));
    const fromName = addDefaultRows(edited, 0).rows;
    expect(after(fromName, 'company')).toBe('department');
    expect(find(fromName, 'department')).toMatchObject({ write: 'ORG;TYPE=WORK', index: 1 });
    expect(find(fromName, 'department')).not.toHaveProperty('writeV3');
  });

  it('does not add a row whose name or part the stored mapping already has', () => {
    const named: MappingRow = { kind: 'field', property: 'department', read: ['X-DEPARTMENT'], write: 'X-DEPARTMENT' };
    const byName = addDefaultRows([...withoutNew(), named], 0).rows;
    expect(names(byName).filter((n) => n === 'department')).toHaveLength(1);
    expect(find(byName, 'department')).toBe(named);

    const part: MappingRow = { kind: 'component', property: 'afdeling', read: ['ORG'], write: 'org', index: 1 };
    const byPart = addDefaultRows([...withoutNew(), part], 0).rows;
    expect(names(byPart)).not.toContain('department');
    expect(names(byPart)).toContain('name-prefix');
  });

  it('adds neither gender row when a stored row already reads GENDER or X-GENDER', () => {
    const xGender: MappingRow = { kind: 'field', property: 'sekse', read: ['X-GENDER'], write: 'X-GENDER' };
    const rows = addDefaultRows([...withoutNew(), xGender], 0).rows;
    expect(names(rows)).not.toContain('gender');
    expect(names(rows)).not.toContain('gender-identity');
    expect(names(rows)).toContain('department');

    const anyGender: MappingRow = { kind: 'component', property: 'sekse', read: ['gender[*]'], write: 'GENDER', index: 0 };
    expect(names(addDefaultRows([...withoutNew(), anyGender], 0).rows)).not.toContain('gender-identity');
  });

  it('copies keys only from a stored sibling of the same kind', () => {
    const company: MappingRow = { kind: 'field', property: 'company', read: ['X-COMPANY'], write: 'X-COMPANY' };
    const stored = withoutNew().map((r) => (r.property === 'company' ? company : r));
    const { rows } = addDefaultRows(stored, 0);
    expect(find(rows, 'department')).toMatchObject({ kind: 'component', read: ['ORG'], write: 'ORG', index: 1, sinceReader: 3 });
  });

  it('leaves the relation rows and the anniversary row as they are', () => {
    const stored = withoutNew();
    const { rows } = addDefaultRows(stored, 0);
    expect(rows.filter((r) => r.kind === 'relation')).toEqual(stored.filter((r) => r.kind === 'relation'));
    expect(find(rows, 'anniversary')).toEqual(find(stored, 'anniversary'));
  });
});

describe('Sync off', () => {
  const off = (rows: MappingRow[], ...properties: string[]): MappingRow[] =>
    rows.map((row) => (properties.includes(row.property) ? { ...row, sync: false as const } : row));
  const names = (found: MappingRow[]) => found.map((row) => row.property);

  it('syncRows marks rows with Sync off, never the fixed ones, and does not mutate its input', () => {
    const stored = off(DEFAULT_MAPPING, 'friends', 'uid', 'name', 'photo');
    const before = JSON.stringify(stored);
    const rows = syncRows(stored);
    expect(JSON.stringify(stored)).toBe(before);
    expect(rows).toHaveLength(stored.length);
    expect(rows.map((row) => row.property)).toEqual(stored.map((row) => row.property));
    expect(rows.filter((row) => row.skip).map((row) => row.property)).toEqual(['friends']);
    expect(rows.find((row) => row.property === 'friends')).toEqual({
      ...stored.find((row) => row.property === 'friends'),
      skip: true,
    });
    for (const property of ['uid', 'name', 'photo']) expect(rows.find((row) => row.property === property)?.skip).toBeUndefined();
    expect(rows.find((row) => row.property === 'colleagues')).toEqual(DEFAULT_MAPPING.find((row) => row.property === 'colleagues'));
  });

  it('a 4.0 RELATED line of a skipped row does not fall through to another row', () => {
    const related = line('RELATED;TYPE=friend,colleague:urn:uuid:abc');
    expect(names(rowForLine(related, DEFAULT_MAPPING))).toEqual(['friends']);
    expect(rowForLine(related, syncRows(off(DEFAULT_MAPPING, 'friends')))).toEqual([]);
    expect(lineIsSkipped(related, syncRows(off(DEFAULT_MAPPING, 'friends')))).toBe(true);
    expect(lineIsSkipped(related, DEFAULT_MAPPING)).toBe(false);
  });

  it('a 3.0 X-ABRELATEDNAMES line of a skipped row is skipped', () => {
    const friend = line('item1.X-ABRELATEDNAMES:Ann');
    const rows = syncRows(off(DEFAULT_MAPPING, 'friends'));
    expect(names(rowForLine(friend, DEFAULT_MAPPING, '_$!<Friend>!$_'))).toEqual(['friends']);
    expect(rowForLine(friend, rows, '_$!<Friend>!$_')).toEqual([]);
    expect(lineIsSkipped(friend, rows, '_$!<Friend>!$_')).toBe(true);
    expect(lineIsSkipped(friend, rows, '_$!<Colleague>!$_')).toBe(false);
  });

  it('an ORG line keeps only the parts that sync', () => {
    const org = line('ORG:Acme;Sales');
    expect(names(rowForLine(org, syncRows(off(DEFAULT_MAPPING, 'department'))))).toEqual(['company']);
    expect(lineIsSkipped(org, syncRows(off(DEFAULT_MAPPING, 'department')))).toBe(false);
    const both = syncRows(off(DEFAULT_MAPPING, 'company', 'department'));
    expect(rowForLine(org, both)).toEqual([]);
    expect(lineIsSkipped(org, both)).toBe(true);
  });

  it('rowForProperty finds a row with Sync off in the stored rows, not in the sync rows', () => {
    const stored = off(DEFAULT_MAPPING, 'friends');
    expect(rowForProperty('friends', syncRows(stored))).toBeUndefined();
    expect(rowForProperty('friends-2', syncRows(stored))).toBeUndefined();
    expect(rowForProperty('friends', stored)?.row.property).toBe('friends');
    expect(rowForProperty('friends', stored)?.row.skip).toBeUndefined();
  });

  it('validateMapping still checks rows with Sync off; migrate and rename keep the fields', () => {
    const stored = off(DEFAULT_MAPPING, 'friends').map((row) =>
      row.property === 'friends' ? { ...row, syncSince: 1234 } : row,
    );
    const clash = stored.map((row) => (row.property === 'met' ? { ...row, property: 'friends' } : row));
    expect(validateMapping(clash)).toContain('Duplicate property name: friends');
    expect(validateMapping(stored)).toEqual([]);
    const friends = (rows: MappingRow[]) => rows.find((row) => row.property === 'friends');
    expect(friends(migrateMapping(stored))).toMatchObject({ sync: false, syncSince: 1234 });
    expect(friends(renameRow(stored, 'colleagues', 'coworkers'))).toMatchObject({ sync: false, syncSince: 1234 });
    expect(friends(renameRow(stored, 'friends', 'pals'))).toBeUndefined();
    expect(renameRow(stored, 'friends', 'pals').find((row) => row.property === 'pals')).toMatchObject({
      sync: false,
      syncSince: 1234,
    });
    expect(friends(addDefaultRows(stored, 0).rows)).toMatchObject({ sync: false, syncSince: 1234 });
  });
});

describe('withSync', () => {
  const friends = (rows: MappingRow[]) => rows.find((row) => row.property === 'friends')!;

  it('off sets sync: false and removes syncSince', () => {
    const on = DEFAULT_MAPPING.map((r) => (r.property === 'friends' ? { ...r, syncSince: 1000 } : r));
    const index = on.findIndex((r) => r.property === 'friends');
    const next = withSync(on, index, false, 5000);
    expect(friends(next)).toMatchObject({ sync: false });
    expect('syncSince' in friends(next)).toBe(false);
    expect(next.filter((_, i) => i !== index)).toEqual(on.filter((_, i) => i !== index));
    expect(on[index]).toMatchObject({ syncSince: 1000 });
  });

  it('on removes sync and sets syncSince to now', () => {
    const off = withSync(DEFAULT_MAPPING, DEFAULT_MAPPING.findIndex((r) => r.property === 'friends'), false, 1);
    const next = withSync(off, off.findIndex((r) => r.property === 'friends'), true, 5000);
    expect('sync' in friends(next)).toBe(false);
    expect(friends(next)).toMatchObject({ syncSince: 5000 });
  });

  it('leaves a fixed row unchanged', () => {
    for (const property of FIXED_PROPERTIES) {
      const index = DEFAULT_MAPPING.findIndex((r) => r.property === property);
      expect(withSync(DEFAULT_MAPPING, index, false, 5000)).toEqual(DEFAULT_MAPPING);
      expect(withSync(DEFAULT_MAPPING, index, true, 5000)).toEqual(DEFAULT_MAPPING);
    }
  });
});
