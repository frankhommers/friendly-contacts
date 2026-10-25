import {
  baseLeavesOut,
  insertLabelledDateRow,
  isLabelledDateRow,
  labelledDateRow,
  mappingWithLabelledDate,
  NO_LOOKUPS,
  planDateFill,
  readableLabel,
  rowPropertyKeys,
  rowsForBase,
  suggestPropertyName,
  unmappedDateLabels,
  withLabelledDateRows,
  withFilledLeftOut,
  withUnfilledDates,
} from 'src/contacts/friendly/dateLabels';
import { parseCard } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING, MappingRow, renameRow, syncRows, validateMapping } from 'src/contacts/friendly/mapping';
import { patch, toFriendly } from 'src/contacts/friendly/translate';
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

  it('records since when it is given', () => {
    expect(labelledDateRow('Verkering', 'dating', 2000)).toEqual({ ...dating, since: 2000 });
    expect(dating).not.toHaveProperty('since');
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

  it('keeps when a labelled row was added', () => {
    const since = labelledDateRow('Verkering', 'dating', 2000);
    expect(withLabelledDateRows(DEFAULT_MAPPING, insertLabelledDateRow(DEFAULT_MAPPING, since))).toContainEqual(since);
  });

  it('a reset whose labelled row took a default name is invalid', () => {
    // The owner renamed birthday and named a labelled date birthday: the defaults bring birthday back.
    const current = insertLabelledDateRow(renameRow(DEFAULT_MAPPING, 'birthday', 'born'), labelledDateRow('Verkering', 'birthday'));
    expect(validateMapping(current)).toEqual([]);
    expect(validateMapping(withLabelledDateRows(DEFAULT_MAPPING, current))).toEqual(['Duplicate property name: birthday']);
  });
});

describe('rowsForBase', () => {
  const rows = (since?: number) => insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('Verkering', 'dating', since));

  it('keeps a row without since', () => {
    expect(rowsForBase(rows(), { storedAt: 1000 })).toEqual(rows());
    expect(rowsForBase(rows(), undefined)).toEqual(rows());
  });

  it('keeps a row added before or when the base was stored', () => {
    expect(rowsForBase(rows(500), { storedAt: 1000 })).toEqual(rows(500));
    expect(rowsForBase(rows(1000), { storedAt: 1000 })).toEqual(rows(1000));
  });

  it('drops a row added after the base was stored', () => {
    expect(rowsForBase(rows(2000), { storedAt: 1000 })).toEqual(DEFAULT_MAPPING);
  });

  it('a base without storedAt is older than every row with since', () => {
    expect(rowsForBase(rows(1), undefined)).toEqual(DEFAULT_MAPPING);
  });

  it('a base stored by reader 2 or 1 is read without the rows of reader 3', () => {
    const marked = DEFAULT_MAPPING.filter((r) => r.kind !== 'relation' && r.sinceReader === 3).map((r) => r.property);
    expect(marked).toEqual(expect.arrayContaining(['department', 'name-prefix', 'gender']));
    for (const reader of [1, 2] as const) {
      const kept = names(rowsForBase(DEFAULT_MAPPING, undefined, reader));
      expect(kept).not.toContain('department');
      expect(kept.filter((p) => marked.includes(p))).toEqual([]);
      expect(kept).toEqual(names(DEFAULT_MAPPING).filter((p) => !marked.includes(p)));
    }
    expect(rowsForBase(DEFAULT_MAPPING, undefined, 3)).toEqual(DEFAULT_MAPPING);
    expect(rowsForBase(DEFAULT_MAPPING, undefined)).toEqual(DEFAULT_MAPPING);
  });

  it('filters dates with a label by since whatever the reader', () => {
    const withoutMarked = rowsForBase(DEFAULT_MAPPING, undefined, 2);
    expect(rowsForBase(rows(2000), { storedAt: 1000 }, 2)).toEqual(withoutMarked);
    expect(names(rowsForBase(rows(500), { storedAt: 1000 }, 2))).toContain('dating');
  });

  it('keeps a relation row whatever its mark (only fields and components carry one)', () => {
    const spouse = DEFAULT_MAPPING.find((r) => r.kind === 'relation')!;
    expect(rowsForBase([{ ...spouse, sinceReader: 3 } as unknown as MappingRow], undefined, 1)).toHaveLength(1);
  });

  it('never drops other rows', () => {
    // Only a labelled row has a since; one on another row (a hand-edited data.json) is ignored.
    const anniversary = DEFAULT_MAPPING.find((r) => r.property === 'anniversary')!;
    expect(rowsForBase([{ ...anniversary, since: 5000 } as unknown as MappingRow], { storedAt: 1000 })).toHaveLength(1);
  });
});

describe('withUnfilledDates', () => {
  const rows = insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('Verkering', 'dating', 2000));
  const base = { name: 'Dora', dating: '2012-05-01', 'dating-2': '2014-06-02', birthday: '1990-01-01' };

  it('takes the dates of a row added after the base was stored that the note does not hold', () => {
    expect(withUnfilledDates({ name: 'Dora' }, base, rows, { storedAt: 1000 })).toEqual({
      name: 'Dora',
      dating: '2012-05-01',
      'dating-2': '2014-06-02',
    });
  });

  it('keeps what the note holds', () => {
    expect(withUnfilledDates({ name: 'Dora', dating: '2013-01-01', 'dating-2': '' }, base, rows, { storedAt: 1000 })).toEqual({
      name: 'Dora',
      dating: '2013-01-01',
      'dating-2': '2014-06-02',
    });
  });

  it('changes nothing for a base stored after the row was added', () => {
    expect(withUnfilledDates({ name: 'Dora' }, base, rows, { storedAt: 3000 })).toEqual({ name: 'Dora' });
  });

  it('takes the parts a reader-2 base was read without that the note leaves empty', () => {
    const parts = { name: 'Jan', company: 'Acme', department: 'Sales', 'name-prefix': 'Dr' };
    expect(withUnfilledDates({ name: 'Jan', company: 'Acme' }, parts, DEFAULT_MAPPING, { storedAt: 1000 }, 2)).toEqual(parts);
    expect(withUnfilledDates({ name: 'Jan', company: 'Acme', department: 'HR' }, parts, DEFAULT_MAPPING, { storedAt: 1000 }, 2)).toEqual({
      ...parts,
      department: 'HR',
    });
    expect(withUnfilledDates({ name: 'Jan', company: 'Acme' }, parts, DEFAULT_MAPPING, { storedAt: 1000 }, 3)).toEqual({ name: 'Jan', company: 'Acme' });
  });

  it('an export over a reader-2 base keeps the parts the note does not have yet', () => {
    const raw = ['BEGIN:VCARD', 'VERSION:3.0', 'UID:u1', 'FN:Jan Jansen', 'N:Jansen;Jan;;Dr;', 'ORG:Acme;Sales', 'END:VCARD'].join('\r\n');
    const baseLines = parseCard(raw);
    const before = toFriendly(baseLines, DEFAULT_MAPPING, NO_LOOKUPS, { reader: 2 });
    const note = { uid: 'u1', name: 'Jan Jansen', firstname: 'Jan', lastname: 'Jansen', company: 'Acme' };
    const out = patch(baseLines, before, withUnfilledDates(note, before.props, DEFAULT_MAPPING, { storedAt: 1000 }, 2), DEFAULT_MAPPING, NO_LOOKUPS);
    expect(out.lines.map((l) => `${l.name}:${l.value}`)).toEqual(expect.arrayContaining(['ORG:Acme;Sales', 'N:Jansen;Jan;;Dr;']));
  });
});

describe('a row with Sync turned back on (syncSince)', () => {
  const friendsRow = DEFAULT_MAPPING.find((r) => r.property === 'friends')!;
  const since = (syncSince?: number): MappingRow[] => [syncSince === undefined ? friendsRow : { ...friendsRow, syncSince }];
  const withSince = (syncSince: number) =>
    DEFAULT_MAPPING.map((r) => (r.property === 'friends' ? { ...r, syncSince } : r));
  const FRIENDS = ['[[Anna]]', '[[Bram]]', '[[Cor]]'];

  it('rowsForBase marks it skip for a base stored before then, in place', () => {
    expect(rowsForBase(since(2000), { storedAt: 1000 })).toEqual([{ ...friendsRow, syncSince: 2000, skip: true }]);
    expect(rowsForBase(since(2000), undefined)).toEqual([{ ...friendsRow, syncSince: 2000, skip: true }]);
    expect(rowsForBase(withSince(2000), { storedAt: 1000 })).toHaveLength(DEFAULT_MAPPING.length);
  });

  it('rowsForBase leaves it unmarked for a later base, and a row without syncSince', () => {
    expect(rowsForBase(since(2000), { storedAt: 3000 })).toEqual(since(2000));
    expect(rowsForBase(since(2000), { storedAt: 2000 })).toEqual(since(2000));
    expect(rowsForBase(since(), { storedAt: 1000 })).toEqual(since());
  });

  it('baseLeavesOut', () => {
    expect(baseLeavesOut(since(2000), { storedAt: 1000 })).toBe(true);
    expect(baseLeavesOut(since(2000), { storedAt: 3000 })).toBe(false);
    expect(baseLeavesOut(since(), { storedAt: 1000 })).toBe(false);
    expect(baseLeavesOut(DEFAULT_MAPPING, { storedAt: 1000 })).toBe(false);
  });

  it('baseLeavesOut is true for the existing reasons too', () => {
    expect(baseLeavesOut(insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('Verkering', 'dating', 2000)), { storedAt: 1000 })).toBe(true);
    expect(baseLeavesOut(DEFAULT_MAPPING, undefined, 2)).toBe(true);
  });

  it('a row with Sync off is not left out by the base: it is skipped everywhere', () => {
    const off = syncRows([{ ...friendsRow, sync: false, syncSince: 2000 }]);
    expect(rowsForBase(off, { storedAt: 1000 })).toEqual(off);
    expect(baseLeavesOut(off, { storedAt: 1000 })).toBe(false);
  });

  it('withFilledLeftOut never puts it back, even when the note holds the same value', () => {
    const full = { name: 'Dora', friends: FRIENDS };
    const result = withFilledLeftOut({ name: 'Dora' }, full, { name: 'Dora', friends: FRIENDS }, withSince(2000), { storedAt: 1000 });
    expect(result).toEqual({ name: 'Dora' });
    expect(result).not.toHaveProperty('friends');
  });

  it('withUnfilledDates never patches it in', () => {
    const full = { name: 'Dora', friends: FRIENDS };
    expect(withUnfilledDates({ name: 'Dora' }, full, withSince(2000), { storedAt: 1000 })).toEqual({ name: 'Dora' });
  });

  it('neither function patches a row with Sync off', () => {
    const off = syncRows(DEFAULT_MAPPING.map((r) => (r.property === 'friends' ? { ...r, sync: false as const } : r)));
    const full = { name: 'Dora', friends: FRIENDS };
    expect(withUnfilledDates({ name: 'Dora' }, full, off, { storedAt: 1000 })).toEqual({ name: 'Dora' });
    expect(withFilledLeftOut({ name: 'Dora' }, full, { name: 'Dora', friends: FRIENDS }, off, { storedAt: 1000 })).toEqual({ name: 'Dora' });
    // Also when a labelled date leaves rows out of the same base.
    const dated = insertLabelledDateRow(off, labelledDateRow('Verkering', 'dating', 2000));
    expect(withUnfilledDates({ name: 'Dora' }, { ...full, dating: '2012-05-01' }, dated, { storedAt: 1000 })).toEqual({ name: 'Dora', dating: '2012-05-01' });
  });

  it('a labelled date added later is still patched next to a row turned back on', () => {
    const rows = insertLabelledDateRow(withSince(2000), labelledDateRow('Verkering', 'dating', 2000));
    const full = { name: 'Dora', friends: FRIENDS, dating: '2012-05-01' };
    expect(withUnfilledDates({ name: 'Dora' }, full, rows, { storedAt: 1000 })).toEqual({ name: 'Dora', dating: '2012-05-01' });
    expect(
      withFilledLeftOut({ name: 'Dora' }, full, { name: 'Dora', friends: FRIENDS, dating: '2012-05-01' }, rows, { storedAt: 1000 }),
    ).toEqual({ name: 'Dora', dating: '2012-05-01' });
  });
});

describe('a base whose dates were brought up to date (datesAt, set by touch)', () => {
  const friendsRow = DEFAULT_MAPPING.find((r) => r.property === 'friends')!;
  const rows = insertLabelledDateRow(
    DEFAULT_MAPPING.map((r) => (r.property === 'friends' ? { ...r, syncSince: 2000 } : r)),
    labelledDateRow('Verkering', 'dating', 2500),
  );
  const touched = { storedAt: 1000, datesAt: 3000 };
  const FRIENDS = ['[[Anna]]', '[[Bram]]', '[[Cor]]'];

  it('reads a date with a label added before datesAt', () => {
    expect(names(rowsForBase(rows, touched))).toContain('dating');
    expect(names(rowsForBase(rows, { storedAt: 1000 }))).not.toContain('dating');
  });

  it('still skips a row Sync was turned back on for after storedAt: touching changes no card', () => {
    expect(rowsForBase(rows, touched).find((r) => r.property === 'friends')).toEqual({ ...friendsRow, syncSince: 2000, skip: true });
    expect(baseLeavesOut(rows, touched)).toBe(true);
    expect(baseLeavesOut(rows, { storedAt: 3000 })).toBe(false);
  });

  it('a base without storedAt that was touched: dates by datesAt, Sync since still stale', () => {
    const read = rowsForBase(rows, { datesAt: 3000 });
    expect(names(read)).toContain('dating');
    expect(read.find((r) => r.property === 'friends')).toMatchObject({ skip: true });
  });

  it('a datesAt older than storedAt changes nothing', () => {
    expect(rowsForBase(rows, { storedAt: 3000, datesAt: 1000 })).toEqual(rowsForBase(rows, { storedAt: 3000 }));
  });

  it('neither patch function puts the friends back, nor the date it now reads', () => {
    const full = { name: 'Dora', friends: FRIENDS, dating: '2012-05-01' };
    expect(withUnfilledDates({ name: 'Dora' }, full, rows, touched)).toEqual({ name: 'Dora' });
    expect(withFilledLeftOut({ name: 'Dora' }, full, { name: 'Dora', friends: FRIENDS }, rows, touched)).toEqual({ name: 'Dora' });
  });
});

describe('mappingWithLabelledDate', () => {
  it('adds the row to the mapping it is given, so a rename saved meanwhile is kept', () => {
    const renamed = renameRow(DEFAULT_MAPPING, 'birthday', 'born');
    const result = mappingWithLabelledDate(renamed, dating);
    expect(result).toEqual({ rows: insertLabelledDateRow(renamed, dating) });
    expect('rows' in result && names(result.rows)).toContain('born');
    expect('rows' in result && names(result.rows)).not.toContain('birthday');
  });

  it('refuses a row that no longer fits that mapping', () => {
    const taken = renameRow(DEFAULT_MAPPING, 'birthday', 'dating');
    expect(mappingWithLabelledDate(taken, dating)).toEqual({ errors: ['Duplicate property name: dating'] });
    const labelled = insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('verkering', 'courting'));
    expect(mappingWithLabelledDate(labelled, dating)).toEqual({ errors: ['Two dates have the label "Verkering".'] });
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
