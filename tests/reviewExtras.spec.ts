import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { RelationSnapshot } from 'src/contacts/friendly/relations';
import { alsoChanges, MirrorLookup, renameTarget } from 'src/sync/reviewExtras';
import { describe, expect, it } from 'vitest';

const rows = DEFAULT_MAPPING;
const nameOf = (path: string) => path.split('/').pop()!.replace(/\.md$/, '');

describe('alsoChanges', () => {
  const paths: Record<string, string> = { Sem: 'People/Sem.md', Lotte: 'People/Lotte.md', Anna: 'People/Anna.md' };
  const snapshots: Record<string, RelationSnapshot> = {
    'People/Sem.md': { parents: ['People/Jan.md'] },
    'People/Lotte.md': {},
    'People/Anna.md': { spouse: ['People/Jan.md'] },
  };
  const lookup: MirrorLookup = {
    resolveLink: (link) => paths[link],
    snapshotOf: (path) => snapshots[path],
  };

  it('also changes lists the mirror writes', () => {
    const before = { name: 'Jan', children: ['[[Sem]]'], spouse: '[[Anna]]' };
    const after = { name: 'Jan', children: ['[[Lotte]]', '[[Ghost]]'], spouse: '[[Anna]]' };
    expect(alsoChanges('People/Jan.md', before, after, rows, lookup, nameOf)).toEqual([
      'Lotte: parents gets [[Jan]]',
      'Sem: parents loses [[Jan]]',
    ]);
  });

  it('lists nothing when the relationships do not change', () => {
    const props = { name: 'Jan', children: ['[[Sem]]'], mobile: '1' };
    expect(alsoChanges('People/Jan.md', props, { ...props, mobile: '2' }, rows, lookup, nameOf)).toEqual([]);
  });

  it('a relationship without a mirror property writes nothing elsewhere', () => {
    expect(alsoChanges('People/Jan.md', {}, { emergency: ['[[Lotte]]'] }, rows, lookup, nameOf)).toEqual([]);
  });
});

describe('renameTarget', () => {
  const jan = { name: 'Jan de Vries', firstname: 'Jan', lastname: 'de Vries', mobile: '06-1' };

  it('rename only when the computed name changes', () => {
    expect(renameTarget(jan, { ...jan, lastname: 'Bakker', name: 'Jan Bakker' }, rows)).toBe('Jan Bakker');
    expect(renameTarget(jan, { ...jan, mobile: '06-2' }, rows)).toBeUndefined();
  });

  it('hand-renamed note is not renamed when names are unchanged', () => {
    // The file is called "Jantje" by hand; only the computed names of before and after are compared.
    expect(renameTarget(jan, { ...jan }, rows)).toBeUndefined();
    expect(renameTarget(jan, { ...jan, email: 'jan@example.nl' }, rows)).toBeUndefined();
  });

  it('falls back to the full name without name parts', () => {
    expect(renameTarget({ name: 'Bakker BV' }, { name: 'Bakker & Zonen BV' }, rows)).toBe('Bakker & Zonen BV');
  });

  it('no computed name after: no rename', () => {
    expect(renameTarget(jan, {}, rows)).toBeUndefined();
  });
});
