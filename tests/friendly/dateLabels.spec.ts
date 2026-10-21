import {
  insertLabelledDateRow,
  isLabelledDateRow,
  labelledDateRow,
  NO_LOOKUPS,
  planDateFill,
  readableLabel,
  rowPropertyKeys,
  suggestPropertyName,
  unmappedDateLabels,
  withLabelledDateRows,
} from 'src/contacts/friendly/dateLabels';
import { parseCard } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING, MappingRow, renameRow } from 'src/contacts/friendly/mapping';
import { describe, expect, it } from 'vitest';

const dating = labelledDateRow('Verkering', 'dating');
const names = (rows: MappingRow[]) => rows.map((r) => r.property);
const card = (...lines: string[]) => parseCard(lines.join('\r\n'));

describe('labelled date rows', () => {
  it('builds a trimmed row', () => {
    expect(labelledDateRow(' Verkering ', ' dating ')).toEqual({
      kind: 'field',
      property: 'dating',
      read: [],
      write: 'X-ABDATE',
      format: 'date',
      appleDateLabel: 'Verkering',
    });
  });

  it('knows a labelled date row, not the anniversary row', () => {
    expect(isLabelledDateRow(dating)).toBe(true);
    expect(isLabelledDateRow(DEFAULT_MAPPING.find((r) => r.property === 'anniversary')!)).toBe(false);
    expect(isLabelledDateRow(DEFAULT_MAPPING.find((r) => r.property === 'birthday')!)).toBe(false);
  });

  it('suggests a mechanical property name', () => {
    expect(suggestPropertyName('Eerste  Kus')).toBe('eerste-kus');
    expect(suggestPropertyName(' Verkering ')).toBe('verkering');
  });

  it('unwraps Apple labels', () => {
    expect(readableLabel('_$!<Other>!$_')).toBe('Other');
    expect(readableLabel(' Verkering ')).toBe('Verkering');
  });
});

describe('inserting rows', () => {
  it('puts a row right after the last date row', () => {
    const one = insertLabelledDateRow(DEFAULT_MAPPING, dating);
    const at = names(one).indexOf('anniversary');
    expect(names(one)[at + 1]).toBe('dating');
    expect(DEFAULT_MAPPING.some((r) => r.property === 'dating')).toBe(false);
    const two = insertLabelledDateRow(one, labelledDateRow('Eerste kus', 'first-kiss'));
    expect(names(two).slice(at, at + 3)).toEqual(['anniversary', 'dating', 'first-kiss']);
  });

  it('puts a row at the end without a date row', () => {
    const rows = DEFAULT_MAPPING.filter((r) => r.kind !== 'field' || r.format !== 'date');
    expect(names(insertLabelledDateRow(rows, dating)).at(-1)).toBe('dating');
  });

  it('keeps the labelled rows of the current mapping on the defaults', () => {
    const current = renameRow(insertLabelledDateRow(DEFAULT_MAPPING, dating), 'mobile', 'cell');
    const merged = withLabelledDateRows(DEFAULT_MAPPING, current);
    expect(names(merged)).toEqual(names(insertLabelledDateRow(DEFAULT_MAPPING, dating)));
    expect(merged).toContainEqual(dating);
  });
});

describe('rowPropertyKeys', () => {
  it('lists the keys that belong to a row', () => {
    expect(rowPropertyKeys({ dating: 'x', 'dating-2': 'y', datings: 'z', name: 'A' }, dating)).toEqual([
      'dating',
      'dating-2',
    ]);
  });
});

describe('unmappedDateLabels', () => {
  const cards = [
    card('item1.X-ABDATE:2012-05-01', 'item1.X-ABLabel:Verkering', 'item2.X-ABDATE:2000-01-01', 'item2.X-ABLabel:verkering'),
    card('item1.X-ABDATE:2013-05-01', 'item1.X-ABLabel:Verkering', 'item2.X-ABDATE:2000-01-01', 'item2.X-ABLabel:_$!<Anniversary>!$_'),
    card('item1.X-ABDATE:2014-05-01', 'item1.X-ABLabel:_$!<Other>!$_', 'item2.X-ABDATE:2000-01-01', 'item2.X-ABLabel:A\\, B'),
    card('item1.X-ABDATE:2015-05-01', 'X-ABDATE:2016-01-01'),
  ];

  it('counts the labels without a row, once per card', () => {
    expect(unmappedDateLabels(cards, DEFAULT_MAPPING)).toEqual([
      { label: 'Verkering', contacts: 2 },
      { label: 'Other', contacts: 1 },
    ]);
  });

  it('leaves out a label that has a row', () => {
    expect(unmappedDateLabels(cards, insertLabelledDateRow(DEFAULT_MAPPING, dating))).toEqual([
      { label: 'Other', contacts: 1 },
    ]);
  });
});

describe('planDateFill', () => {
  const rows = insertLabelledDateRow(DEFAULT_MAPPING, dating);
  const base = (...lines: string[]) => lines.join('\r\n');
  const one = base('VERSION:4.0', 'item3.X-ABDATE:2012-05-01', 'item3.X-ABLabel:Verkering');

  it('fills the property from the base', () => {
    expect(planDateFill([{ path: 'a.md', frontmatter: {}, base: { raw: one, reader: 2 } }], rows, dating)).toEqual([
      { path: 'a.md', set: { dating: '2012-05-01' } },
    ]);
  });

  it('numbers several dates with the label', () => {
    const two = base(one, 'item4.X-ABDATE:2014-06-02', 'item4.X-ABLabel:verkering');
    expect(planDateFill([{ path: 'a.md', frontmatter: {}, base: { raw: two, reader: 2 } }], rows, dating)).toEqual([
      { path: 'a.md', set: { dating: '2012-05-01', 'dating-2': '2014-06-02' } },
    ]);
  });

  it('keeps a value the note holds', () => {
    const note = { path: 'a.md', frontmatter: { dating: '2013-01-01' }, base: { raw: one, reader: 2 as const } };
    expect(planDateFill([note], rows, dating)).toEqual([]);
  });

  it('reads the base with its reader', () => {
    expect(planDateFill([{ path: 'a.md', frontmatter: {}, base: { raw: one, reader: 1 } }], rows, dating)).toEqual([]);
  });

  it('skips a note without a base', () => {
    expect(planDateFill([{ path: 'a.md', frontmatter: {} }], rows, dating)).toEqual([]);
  });

  it('fills a year-less date of a 3.0 base', () => {
    const raw = base('VERSION:3.0', 'item3.X-ABDATE;X-APPLE-OMIT-YEAR=1604:1604-05-01', 'item3.X-ABLabel:Verkering');
    expect(planDateFill([{ path: 'a.md', frontmatter: {}, base: { raw, reader: 2 } }], rows, dating)).toEqual([
      { path: 'a.md', set: { dating: '--05-01' } },
    ]);
  });

  it('has lookups that find nothing', () => {
    expect(NO_LOOKUPS.uidToName('x')).toBeUndefined();
    expect(NO_LOOKUPS.displayName('x')).toBeUndefined();
    expect(NO_LOOKUPS.resolveLink('Jan')).toEqual({ text: 'Jan' });
  });
});
