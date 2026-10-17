import { parseCard } from 'src/contacts/friendly/lines';
import {
  DEFAULT_MAPPING,
  isMappedProperty,
  matchesPattern,
  MappingRow,
  rowForLine,
  rowForProperty,
  renameRow,
  validateMapping,
} from 'src/contacts/friendly/mapping';
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
      'street',
      'postcode',
      'city',
      'region',
      'country',
    ]);
    expect(rowsFor('ADR;TYPE=WORK:;;a;b;c;d;e')).toEqual([
      'work-street',
      'work-postcode',
      'work-city',
      'work-region',
      'work-country',
    ]);
    expect(rowsFor('N:Vries;Jan;;;')).toEqual(['firstname', 'middlename', 'lastname']);
    expect(rowsFor('ORG:Acme;Sales')).toEqual(['company']);
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
    const rows = renameRow(DEFAULT_MAPPING, 'spouse', 'partner');
    expect(mirrorOf(rows, 'partner')).toBe('partner');
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
