import { foldText, groupImportItems, importAllQuestion, importName, importRowText, matchesImportQuery } from 'src/insights/importList';
import { importCandidates } from 'src/sync/sources';
import { describe, expect, it } from 'vitest';

const remote = (uid: string, fileName: string, sourceId = 's1') => ({
  uid, fileName, sourceId, href: `/${uid}.vcf`, etag: 'e',
});

describe('importCandidates', () => {
  it('offers only cards without a note', () => {
    const list = [remote('a', 'Anna'), remote('b', 'Bob'), remote('c', 'Cleo')];
    expect(importCandidates(list, ['b']).map((r) => r.uid)).toEqual(['a', 'c']);
  });

  it('offers a uid in two sources twice', () => {
    const list = [remote('a', 'Anna', 's1'), remote('a', 'Anna', 's2')];
    expect(importCandidates(list, []).map((r) => r.sourceId)).toEqual(['s1', 's2']);
    expect(importCandidates(list, ['a'])).toEqual([]);
  });

  it('sorts by name', () => {
    const list = [remote('c', 'Cleo'), remote('a', 'anna'), remote('b', 'Bob')];
    expect(importCandidates(list, []).map((r) => r.fileName)).toEqual(['anna', 'Bob', 'Cleo']);
  });

  it('keeps the input untouched', () => {
    const list = [remote('b', 'Bob'), remote('a', 'Anna')];
    importCandidates(list, []);
    expect(list.map((r) => r.uid)).toEqual(['b', 'a']);
  });
});

const item = (uid: string, fn: string | undefined, sourceId = 's1', org?: string, n?: string) => ({
  data: { uid, fn, n, org, sourceId },
});
const names: Record<string, string> = { s1: 'Work', s2: 'Family', s3: 'Archive' };
const nameOf = (id: string) => names[id];

describe('foldText', () => {
  it('lowercases and drops accents', () => {
    expect(foldText('René')).toBe('rene');
    expect(foldText('  ÅNGSTRÖM ')).toBe('angstrom');
  });

  it('folds a decomposed accent the same way', () => {
    expect(foldText('Rene\u0301')).toBe('rene');
  });
});

describe('importName', () => {
  it('uses the formatted name', () => {
    expect(importName({ fn: ' Anna Bos ', sourceId: 's1' })).toBe('Anna Bos');
  });

  it('builds a name from N when FN is missing', () => {
    expect(importName({ fn: undefined, n: 'Bos;Anna;;;', sourceId: 's1' })).toBe('Anna Bos');
    expect(importName({ fn: '', n: 'Bos;;;;', sourceId: 's1' })).toBe('Bos');
  });

  it('falls back to a placeholder', () => {
    expect(importName({ sourceId: 's1' })).toBe('(no name)');
  });
});

describe('importRowText', () => {
  it('adds the organisation after a dot', () => {
    expect(importRowText({ fn: 'Anna', org: 'Acme', sourceId: 's1' })).toBe('Anna · Acme');
    expect(importRowText({ fn: 'Anna', sourceId: 's1' })).toBe('Anna');
    expect(importRowText({ fn: 'Anna', org: '  ', sourceId: 's1' })).toBe('Anna');
  });
});

describe('matchesImportQuery', () => {
  const rene = { fn: 'René Visser', org: 'Café Zoë', sourceId: 's1' };

  it('matches everything on an empty query', () => {
    expect(matchesImportQuery(rene, '')).toBe(true);
    expect(matchesImportQuery(rene, '   ')).toBe(true);
  });

  it('ignores case and accents in both directions', () => {
    expect(matchesImportQuery(rene, 'Rene')).toBe(true);
    expect(matchesImportQuery(rene, 'RENÉ')).toBe(true);
    expect(matchesImportQuery({ fn: 'Rene Visser', sourceId: 's1' }, 'rené')).toBe(true);
  });

  it('matches the organisation too', () => {
    expect(matchesImportQuery(rene, 'cafe zoe')).toBe(true);
    expect(matchesImportQuery(rene, 'zoë')).toBe(true);
  });

  it('wants every word to match somewhere in the name or organisation', () => {
    expect(matchesImportQuery(rene, 'visser cafe')).toBe(true);
    expect(matchesImportQuery(rene, 'visser acme')).toBe(false);
  });

  it('does not match the uid or the address book', () => {
    expect(matchesImportQuery({ uid: 'abc-123', fn: 'Anna', sourceId: 's1' }, 'abc')).toBe(false);
  });
});

describe('groupImportItems', () => {
  const items = [
    item('1', 'Zed', 's1'),
    item('2', 'anna', 's2', 'Acme'),
    item('3', 'Bob', 's1'),
    item('4', 'Émile', 's2'),
  ];

  it('groups per address book, books and contacts sorted by name', () => {
    const groups = groupImportItems(items, nameOf, '');
    expect(groups.map((g) => [g.sourceId, g.name])).toEqual([['s2', 'Family'], ['s1', 'Work']]);
    expect(groups[0].items.map((i) => i.data.uid)).toEqual(['2', '4']);
    expect(groups[1].items.map((i) => i.data.uid)).toEqual(['3', '1']);
  });

  it('keeps the original objects', () => {
    expect(groupImportItems(items, nameOf, '')[0].items[0]).toBe(items[1]);
  });

  it('filters and drops books without a match', () => {
    const groups = groupImportItems(items, nameOf, 'emile');
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.data.uid)).toEqual(['4']);
    expect(groupImportItems(items, nameOf, 'acme').map((g) => g.name)).toEqual(['Family']);
    expect(groupImportItems(items, nameOf, 'nobody')).toEqual([]);
  });

  it('names a book that is gone', () => {
    const groups = groupImportItems([item('9', 'Eve', 'gone')], nameOf, '');
    expect(groups).toEqual([{ sourceId: 'gone', name: 'Unknown address book', items: [item('9', 'Eve', 'gone')] }]);
  });

  it('breaks ties on the uid so the order is stable', () => {
    const twins = [item('b', 'Sam'), item('a', 'Sam')];
    expect(groupImportItems(twins, nameOf, '')[0].items.map((i) => i.data.uid)).toEqual(['a', 'b']);
  });

  it('keeps the input untouched', () => {
    const copy = [...items];
    groupImportItems(items, nameOf, '');
    expect(items).toEqual(copy);
  });
});

describe('importAllQuestion', () => {
  it('names the numbers', () => {
    expect(importAllQuestion(12, 3)).toBe('Import 12 contacts from 3 address books?');
  });

  it('uses the singular', () => {
    expect(importAllQuestion(1, 1)).toBe('Import 1 contact from 1 address book?');
    expect(importAllQuestion(2, 1)).toBe('Import 2 contacts from 1 address book?');
  });
});
