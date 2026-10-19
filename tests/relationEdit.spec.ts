import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import {
  addRelation,
  linkRelationEntry,
  otherSideTaken,
  planAdd,
  relationGroups,
  removeRelationEntry,
} from 'src/contacts/relationEdit';
import { makeEnv } from 'tests/fakes/mirrorEnv';
import { describe, expect, it } from 'vitest';

const rows = DEFAULT_MAPPING;
const nameOf = (path: string) => path.replace(/\.md$/, '').replace(/^.*\//, '').toUpperCase();

describe('relationGroups', () => {
  it('groups in mapping order with names', () => {
    const { env, files } = makeEnv({
      'Jan.md': { friends: ['[[Piet]]'], spouse: '[[Sem]]', children: ['[[Lot]]', '[[Piet|Pietje]]'], name: 'Jan' },
      'Sem.md': {},
      'Lot.md': {},
      'Piet.md': {},
    });
    expect(relationGroups(env, rows, 'Jan.md', files['Jan.md'], nameOf)).toEqual([
      { property: 'spouse', type: 'spouse', people: [{ text: '[[Sem]]', display: 'SEM', path: 'Sem.md' }] },
      {
        property: 'children',
        type: 'child',
        people: [
          { text: '[[Lot]]', display: 'LOT', path: 'Lot.md' },
          { text: '[[Piet|Pietje]]', display: 'PIET', path: 'Piet.md' },
        ],
      },
      { property: 'friends', type: 'friend', people: [{ text: '[[Piet]]', display: 'PIET', path: 'Piet.md' }] },
    ]);
  });

  it('unresolved entry shows its alias or text', () => {
    const { env, files } = makeEnv({ 'Jan.md': { friends: ['[[Ghost]]', '[[Nobody/Sam|Sam B]]'] } });
    const [group] = relationGroups(env, rows, 'Jan.md', files['Jan.md'], nameOf);
    expect(group.people).toEqual([
      { text: '[[Ghost]]', display: 'Ghost' },
      { text: '[[Nobody/Sam|Sam B]]', display: 'Sam B' },
    ]);
  });

  it('reads a single string and an unquoted wikilink', () => {
    const { env, files } = makeEnv({ 'Jan.md': { friends: '[[Piet]]', siblings: [['Sem']] }, 'Piet.md': {}, 'Sem.md': {} });
    const groups = relationGroups(env, rows, 'Jan.md', files['Jan.md'], nameOf);
    expect(groups.map((g) => [g.property, g.people.map((p) => p.text)])).toEqual([
      ['siblings', ['[[Sem]]']],
      ['friends', ['[[Piet]]']],
    ]);
  });
});

describe('planAdd', () => {
  it('existing link by another text is a no-op', async () => {
    const { env, files, calls } = makeEnv({ 'Jan.md': { friends: ['[[People/Sem]]'] }, 'People/Sem.md': {} });
    expect(planAdd(env, rows, 'Jan.md', files['Jan.md'], 'friends', 'People/Sem.md')).toBe('exists');
    await addRelation(env, rows, 'Jan.md', 'friends', 'People/Sem.md');
    expect(calls).toEqual([]);
    expect(files['Jan.md'].friends).toEqual(['[[People/Sem]]']);
  });

  it('single relation is replaced, not appended', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { spouse: '[[Sem]]' }, 'Sem.md': {}, 'Lot.md': {} });
    expect(planAdd(env, rows, 'Jan.md', files['Jan.md'], 'spouse', 'Lot.md', nameOf)).toEqual({
      replaces: 'SEM',
      text: '[[Sem]]',
      sameName: false,
    });
    await addRelation(env, rows, 'Jan.md', 'spouse', 'Lot.md');
    expect(files['Jan.md'].spouse).toBe('[[Lot]]');
  });

  it('plans added for a new entry and for an empty single relation', () => {
    const { env, files } = makeEnv({ 'Jan.md': { spouse: '', friends: ['[[Piet]]'] }, 'Sem.md': {}, 'Piet.md': {} });
    expect(planAdd(env, rows, 'Jan.md', files['Jan.md'], 'spouse', 'Sem.md')).toBe('added');
    expect(planAdd(env, rows, 'Jan.md', files['Jan.md'], 'friends', 'Sem.md')).toBe('added');
  });

  it('names a replaced ghost by its text', () => {
    const { env, files } = makeEnv({ 'Jan.md': { spouse: '[[Ghost|Gina]]' }, 'Sem.md': {} });
    expect(planAdd(env, rows, 'Jan.md', files['Jan.md'], 'spouse', 'Sem.md')).toEqual({
      replaces: 'Gina',
      text: '[[Ghost|Gina]]',
      sameName: false,
    });
  });

  it('an unresolved entry with the contact\'s name is replaced, not duplicated', async () => {
    const semName = (path: string) => (path === 'People/Sem.md' ? 'Sem de Vries' : nameOf(path));
    const { env, files } = makeEnv({
      'Jan.md': { friends: ['[[Piet]]', '[[sem de vries]]'] },
      'Piet.md': {},
      'People/Sem.md': {},
    });
    const plan = planAdd(env, rows, 'Jan.md', files['Jan.md'], 'friends', 'People/Sem.md', semName);
    expect(plan).toEqual({ replaces: 'sem de vries', text: '[[sem de vries]]', sameName: true });
    await addRelation(env, rows, 'Jan.md', 'friends', 'People/Sem.md', '[[sem de vries]]');
    expect(files['Jan.md'].friends).toEqual(['[[Piet]]', '[[Sem]]']);
  });

  it('an unresolved entry whose alias is the contact\'s name counts as the same person', () => {
    const { env, files } = makeEnv({ 'Jan.md': { spouse: '[[Ghost|Sem]]' }, 'Sem.md': {} });
    expect(planAdd(env, rows, 'Jan.md', files['Jan.md'], 'spouse', 'Sem.md')).toEqual({
      replaces: 'Sem',
      text: '[[Ghost|Sem]]',
      sameName: true,
    });
  });
});

describe('otherSideTaken', () => {
  it('names who already holds the new person\'s single relation', () => {
    const { env, files } = makeEnv({ 'Jan.md': {}, 'Lot.md': { spouse: '[[Piet]]' }, 'Piet.md': {} });
    expect(otherSideTaken(env, rows, 'Jan.md', 'spouse', 'Lot.md', files['Lot.md'], nameOf)).toEqual({
      property: 'spouse',
      name: 'PIET',
    });
  });

  it('an unresolved entry also takes it', () => {
    const { env, files } = makeEnv({ 'Jan.md': {}, 'Lot.md': { spouse: '[[Ghost|Gina]]' } });
    expect(otherSideTaken(env, rows, 'Jan.md', 'spouse', 'Lot.md', files['Lot.md'], nameOf)).toEqual({
      property: 'spouse',
      name: 'Gina',
    });
  });

  it('is undefined when free, pointing back, or a list', () => {
    const { env, files } = makeEnv({
      'Jan.md': {},
      'Lot.md': { spouse: '[[Jan]]', parents: ['[[Piet]]'] },
      'Sem.md': { spouse: '' },
      'Piet.md': {},
    });
    expect(otherSideTaken(env, rows, 'Jan.md', 'spouse', 'Lot.md', files['Lot.md'], nameOf)).toBeUndefined();
    expect(otherSideTaken(env, rows, 'Jan.md', 'spouse', 'Sem.md', files['Sem.md'], nameOf)).toBeUndefined();
    expect(otherSideTaken(env, rows, 'Jan.md', 'children', 'Lot.md', files['Lot.md'], nameOf)).toBeUndefined();
    expect(otherSideTaken(env, rows, 'Jan.md', 'emergency', 'Lot.md', files['Lot.md'], nameOf)).toBeUndefined();
  });
});

describe('addRelation', () => {
  it('appends to a list', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { friends: ['[[Piet]]'] }, 'Piet.md': {}, 'Sem.md': {} });
    await addRelation(env, rows, 'Jan.md', 'friends', 'Sem.md');
    expect(files['Jan.md'].friends).toEqual(['[[Piet]]', '[[Sem]]']);
  });

  it('creates the property', async () => {
    const { env, files } = makeEnv({ 'Jan.md': {}, 'Sem.md': {} });
    await addRelation(env, rows, 'Jan.md', 'friends', 'Sem.md');
    expect(files['Jan.md'].friends).toEqual(['[[Sem]]']);
  });

  it('adds to a property holding one string', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { friends: '[[Piet]]' }, 'Piet.md': {}, 'Sem.md': {} });
    await addRelation(env, rows, 'Jan.md', 'friends', 'Sem.md');
    expect(files['Jan.md'].friends).toEqual(['[[Piet]]', '[[Sem]]']);
  });

  it('keeps an unquoted wikilink when adding', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { friends: [['Piet']] }, 'Piet.md': {}, 'Sem.md': {} });
    await addRelation(env, rows, 'Jan.md', 'friends', 'Sem.md');
    expect(files['Jan.md'].friends).toEqual(['[[Piet]]', '[[Sem]]']);
  });

  it('keeps entries that are not text', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { friends: ['[[Piet]]', 42] }, 'Piet.md': {}, 'Sem.md': {} });
    await addRelation(env, rows, 'Jan.md', 'friends', 'Sem.md');
    expect(files['Jan.md'].friends).toEqual(['[[Piet]]', 42, '[[Sem]]']);
  });

  it('uses the link text the env writes', async () => {
    const { env, files } = makeEnv({ 'Jan.md': {}, 'Sem/index.md': {} });
    env.linkTo = (target) => `[[${target.replace(/\.md$/, '')}|Sem]]`;
    await addRelation(env, rows, 'Jan.md', 'friends', 'Sem/index.md');
    expect(files['Jan.md'].friends).toEqual(['[[Sem/index|Sem]]']);
  });

  it('refuses a property that is not a relation', async () => {
    const { env } = makeEnv({ 'Jan.md': {}, 'Sem.md': {} });
    await expect(addRelation(env, rows, 'Jan.md', 'name', 'Sem.md')).rejects.toThrow(/not a relation/);
  });
});

describe('removeRelationEntry', () => {
  it('removes an unresolved entry by text', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { friends: ['[[Ghost]]', '[[Piet]]'] }, 'Piet.md': {} });
    await removeRelationEntry(env, rows, 'Jan.md', 'friends', '[[Ghost]]');
    expect(files['Jan.md'].friends).toEqual(['[[Piet]]']);
  });

  it('removes an entry that resolves to the same note', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { friends: ['[[People/Sem]]', '[[Piet]]'] }, 'People/Sem.md': {}, 'Piet.md': {} });
    await removeRelationEntry(env, rows, 'Jan.md', 'friends', '[[People/Sem|Sem]]');
    expect(files['Jan.md'].friends).toEqual(['[[Piet]]']);
  });

  it('emptied list removes the property', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { friends: ['[[Piet]]'], spouse: '[[Sem]]' }, 'Piet.md': {}, 'Sem.md': {} });
    await removeRelationEntry(env, rows, 'Jan.md', 'friends', '[[Piet]]');
    await removeRelationEntry(env, rows, 'Jan.md', 'spouse', '[[Sem]]');
    expect(files['Jan.md']).not.toHaveProperty('friends');
    expect(files['Jan.md']).not.toHaveProperty('spouse');
  });

  it('removes from a property holding one string, and an unknown text changes nothing', async () => {
    const { env, files, calls } = makeEnv({ 'Jan.md': { friends: '[[Piet]]' }, 'Piet.md': {} });
    await removeRelationEntry(env, rows, 'Jan.md', 'friends', '[[Other]]');
    expect(calls).toEqual([]);
    await removeRelationEntry(env, rows, 'Jan.md', 'friends', '[[Piet]]');
    expect(files['Jan.md']).not.toHaveProperty('friends');
  });
});

describe('linkRelationEntry', () => {
  it('link replaces the unresolved entry', async () => {
    const { env, files } = makeEnv({
      'Jan.md': { friends: ['[[Sem de Vries]]', '[[Piet]]'], spouse: '[[Lotje]]' },
      'Piet.md': {},
      'People/Sem.md': {},
      'Lot.md': {},
    });
    await linkRelationEntry(env, rows, 'Jan.md', 'friends', '[[Sem de Vries]]', 'People/Sem.md');
    expect(files['Jan.md'].friends).toEqual(['[[Sem]]', '[[Piet]]']);
    await linkRelationEntry(env, rows, 'Jan.md', 'spouse', '[[Lotje]]', 'Lot.md');
    expect(files['Jan.md'].spouse).toBe('[[Lot]]');
  });

  it('drops the unresolved entry when the note is already listed', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { friends: ['[[Sem]]', '[[Sem de Vries]]'] }, 'Sem.md': {} });
    await linkRelationEntry(env, rows, 'Jan.md', 'friends', '[[Sem de Vries]]', 'Sem.md');
    expect(files['Jan.md'].friends).toEqual(['[[Sem]]']);
  });

  it('never drops an entry that already links the contact', async () => {
    const { env, files, calls } = makeEnv({ 'Jan.md': { friends: ['[[Sem]]'], spouse: '[[Sem]]' }, 'Sem.md': {} });
    await linkRelationEntry(env, rows, 'Jan.md', 'friends', '[[Sem]]', 'Sem.md');
    await addRelation(env, rows, 'Jan.md', 'spouse', 'Sem.md', '[[Sem]]');
    expect(calls).toEqual([]);
    expect(files['Jan.md']).toMatchObject({ friends: ['[[Sem]]'], spouse: '[[Sem]]' });
  });

  it('keeps an unquoted entry and appends when the unresolved entry is gone', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { friends: [[['Piet']]] }, 'Piet.md': {}, 'Sem.md': {} });
    await linkRelationEntry(env, rows, 'Jan.md', 'friends', '[[Sem de Vries]]', 'Sem.md');
    expect(files['Jan.md'].friends).toEqual(['[[Piet]]', '[[Sem]]']);
  });
});
