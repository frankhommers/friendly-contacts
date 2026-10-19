import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import {
  findOneSided,
  inverseProperty,
  linkAlias,
  linkTarget,
  planMirrorWrites,
  relationSnapshot,
  resolveRemoteName,
  RelationSnapshot,
} from 'src/contacts/friendly/relations';
import { describe, expect, it } from 'vitest';

const rows = DEFAULT_MAPPING;
const snap = (s: RelationSnapshot): { path: string; snapshot: RelationSnapshot } => ({ path: 'Sem.md', snapshot: s });

describe('linkTarget', () => {
  it('strips wikilink alias and heading', () => {
    expect(linkTarget('[[Anna|A]]')).toBe('Anna');
    expect(linkTarget('[[Anna#Work]]')).toBe('Anna');
    expect(linkTarget('Anna')).toBe('Anna');
  });

  it('wikilink with path and alias', () => {
    expect(linkTarget('[[People/Anna de Vries|Anna]]')).toBe('People/Anna de Vries');
  });

  it('markdown link target', () => {
    expect(linkTarget('[Anna](People/Anna%20de%20Vries.md)')).toBe('People/Anna de Vries');
    expect(linkTarget('[Anna](<People/Anna de Vries.md>)')).toBe('People/Anna de Vries');
  });
});

describe('linkAlias', () => {
  it('is the label of a wikilink or a markdown link', () => {
    expect(linkAlias('[[Contacts/Jan/index|Jan de Vries]]')).toBe('Jan de Vries');
    expect(linkAlias('[[Contacts/Jan/index| Jan ]]')).toBe('Jan');
    expect(linkAlias('[Anna](People/Anna%20de%20Vries.md)')).toBe('Anna');
  });

  it('is undefined without a label', () => {
    expect(linkAlias('[[Contacts/Jan/index]]')).toBeUndefined();
    expect(linkAlias('[[Jan| ]]')).toBeUndefined();
    expect(linkAlias('Jan')).toBeUndefined();
  });
});

describe('inverseProperty', () => {
  it('maps via mirror', () => {
    expect(inverseProperty('children', rows)).toBe('parents');
    expect(inverseProperty('spouse', rows)).toBe('spouse');
    expect(inverseProperty('emergency', rows)).toBeUndefined();
    expect(inverseProperty('mobile', rows)).toBeUndefined();
  });
});

describe('relationSnapshot', () => {
  it('collects sorted unique targets of relation properties only', () => {
    const s = relationSnapshot(
      { children: ['[[Sem]]', '[[Lotte|L]]', '[[Sem]]'], spouse: '[[Anna]]', mobile: '1', emergency: [] },
      rows,
    );
    expect(s).toEqual({ children: ['Lotte', 'Sem'], spouse: ['Anna'] });
  });

  it('resolves link paths to file paths when possible', () => {
    const s = relationSnapshot({ children: ['[[Sem]]', '[[Ghost]]'] }, rows, (p) => (p === 'Sem' ? 'People/Sem.md' : undefined));
    expect(s).toEqual({ children: ['Ghost', 'People/Sem.md'] });
  });
});

describe('planMirrorWrites', () => {
  const plan = (before: RelationSnapshot, after: RelationSnapshot, target: RelationSnapshot | undefined) =>
    planMirrorWrites('Jan.md', '[[Jan]]', before, after, (e) => (target && e === 'Sem.md' ? snap(target) : undefined), rows);

  it('child adds parent', () => {
    expect(plan({}, { children: ['Sem.md'] }, {})).toEqual([
      { targetPath: 'Sem.md', property: 'parents', link: '[[Jan]]', op: 'add' },
    ]);
  });

  it('already mirrored is a no-op', () => {
    expect(plan({}, { children: ['Sem.md'] }, { parents: ['Jan.md'] })).toEqual([]);
  });

  it('unresolved target does nothing', () => {
    expect(plan({}, { children: ['Sem.md'] }, undefined)).toEqual([]);
  });

  it('remove only when pointing back', () => {
    const resolve = (s: RelationSnapshot) => (e: string) => (e === 'Anna.md' ? { path: 'Anna.md', snapshot: s } : undefined);
    const before = { spouse: ['Anna.md'] };
    expect(planMirrorWrites('Jan.md', '[[Jan]]', before, {}, resolve({ spouse: ['Piet.md'] }), rows)).toEqual([]);
    expect(planMirrorWrites('Jan.md', '[[Jan]]', before, {}, resolve({ spouse: ['Jan.md'] }), rows)).toEqual([
      { targetPath: 'Anna.md', property: 'spouse', link: '[[Jan]]', op: 'remove' },
    ]);
  });

  it('emergency has no mirror', () => {
    expect(plan({}, { emergency: ['Sem.md'] }, {})).toEqual([]);
  });

  it('unchanged entries produce nothing', () => {
    expect(plan({ children: ['Sem.md'] }, { children: ['Sem.md'] }, {})).toEqual([]);
  });
});

describe('findOneSided', () => {
  it('reports entries whose target lacks the inverse', () => {
    const all: { path: string; snapshot: RelationSnapshot }[] = [
      { path: 'Jan.md', snapshot: { children: ['Sem.md'] } },
      { path: 'Sem.md', snapshot: {} },
    ];
    expect(findOneSided(all, rows)).toEqual([{ path: 'Jan.md', property: 'children', target: 'Sem.md' }]);
  });

  it('ignores mirrored, unknown and mirror-less entries', () => {
    const all: { path: string; snapshot: RelationSnapshot }[] = [
      { path: 'Jan.md', snapshot: { children: ['Sem.md'], emergency: ['Sem.md'], friends: ['Ghost.md'] } },
      { path: 'Sem.md', snapshot: { parents: ['Jan.md'] } },
    ];
    expect(findOneSided(all, rows)).toEqual([]);
  });
});

describe('resolveRemoteName', () => {
  const remote = [
    { uid: '1', fileName: 'Jan de Vries' },
    { uid: '2', fileName: 'Jan de Vries' },
    { uid: '3', fileName: 'Anna' },
  ];
  it('same uid same name in two sources is not ambiguous', () => {
    const twice = [
      { uid: '3', fileName: 'Anna' },
      { uid: '3', fileName: 'Anna' },
    ];
    expect(resolveRemoteName('Anna', twice)).toEqual({ uid: '3' });
  });
  it('same uid different names is ambiguous', () => {
    const differing = [
      { uid: '3', fileName: 'Anna' },
      { uid: '3', fileName: 'Anna Jansen' },
    ];
    expect(resolveRemoteName('Anna', differing)).toEqual({ ambiguous: true });
    expect(resolveRemoteName('Anna Jansen', differing)).toEqual({ ambiguous: true });
  });
  it('ambiguous remote name resolves to ambiguous', () => {
    expect(resolveRemoteName('Jan de Vries', remote)).toEqual({ ambiguous: true });
  });
  it('single match gives uid, no match gives text', () => {
    expect(resolveRemoteName('Anna', remote)).toEqual({ uid: '3' });
    expect(resolveRemoteName('Piet', remote)).toEqual({ text: 'Piet' });
  });
});
