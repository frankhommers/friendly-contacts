import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { addOtherSide, RelationMirror, removeRelation } from 'src/contacts/relationMirror';
import { makeEnv } from 'tests/fakes/mirrorEnv';
import { describe, expect, it } from 'vitest';

const rows = () => DEFAULT_MAPPING;

describe('RelationMirror', () => {
  it('adds inverse on change', async () => {
    const { env, files, calls } = makeEnv({ 'Jan.md': { name: 'Jan' }, 'Sem.md': { name: 'Sem' } });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Jan.md'].children = ['[[Sem]]'];
    await mirror.onChanged('Jan.md', files['Jan.md']);
    expect(calls).toEqual([{ path: 'Sem.md', property: 'parents', value: ['[[Jan]]'] }]);
  });

  it('appends to an existing list and skips when already linked', async () => {
    const { env, files, calls } = makeEnv({
      'Jan.md': { name: 'Jan' },
      'Sem.md': { name: 'Sem', parents: ['[[Piet]]'] },
      'Piet.md': { name: 'Piet' },
    });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Jan.md'].children = ['[[Sem]]'];
    await mirror.onChanged('Jan.md', files['Jan.md']);
    expect(files['Sem.md'].parents).toEqual(['[[Piet]]', '[[Jan]]']);
    expect(calls).toHaveLength(1);
  });

  it('echo does not loop', async () => {
    const { env, files, calls } = makeEnv({ 'Jan.md': { name: 'Jan' }, 'Sem.md': { name: 'Sem' } });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Jan.md'].children = ['[[Sem]]'];
    await mirror.onChanged('Jan.md', files['Jan.md']);
    expect(calls).toHaveLength(1);
    await mirror.onChanged('Sem.md', files['Sem.md']);
    expect(calls).toHaveLength(1);
  });

  it('removal mirrors only when pointing back', async () => {
    const { env, files, calls } = makeEnv({
      'Jan.md': { name: 'Jan', children: ['[[Sem]]', '[[Lot]]'] },
      'Sem.md': { name: 'Sem', parents: ['[[Jan]]', '[[Piet]]'] },
      'Lot.md': { name: 'Lot', parents: ['[[Piet]]'] },
      'Piet.md': { name: 'Piet' },
    });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Jan.md'].children = [];
    await mirror.onChanged('Jan.md', files['Jan.md']);
    expect(calls).toEqual([{ path: 'Sem.md', property: 'parents', value: ['[[Piet]]'] }]);
    expect(files['Lot.md'].parents).toEqual(['[[Piet]]']);
  });

  it('deletes the key when the list becomes empty', async () => {
    const { env, files, calls } = makeEnv({
      'Jan.md': { name: 'Jan', children: ['[[Sem]]'] },
      'Sem.md': { name: 'Sem', parents: ['[[Jan]]'] },
    });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    delete files['Jan.md'].children;
    await mirror.onChanged('Jan.md', files['Jan.md']);
    expect(calls).toEqual([{ path: 'Sem.md', property: 'parents', value: undefined }]);
    expect('parents' in files['Sem.md']).toBe(false);
  });

  it('new note picks up existing relationships', async () => {
    const { env, files, calls } = makeEnv({ 'Jan.md': { name: 'Jan', spouse: '[[Anna]]' } });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Anna.md'] = { name: 'Anna' };
    await mirror.onCreated('Anna.md');
    expect(calls).toEqual([{ path: 'Anna.md', property: 'spouse', value: '[[Jan]]' }]);
  });

  it('new note mirrors its own relations', async () => {
    const { env, files, calls } = makeEnv({ 'Sem.md': { name: 'Sem' } });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Jan.md'] = { name: 'Jan', children: ['[[Sem]]'] };
    await mirror.onCreated('Jan.md');
    expect(calls).toEqual([{ path: 'Sem.md', property: 'parents', value: ['[[Jan]]'] }]);
  });

  it('mirrors to the resolved note only', async () => {
    const { env, files, calls } = makeEnv({
      'People/Jan.md': { name: 'Jan' },
      'Old/Jan.md': { name: 'Jan' },
      'Sem.md': { name: 'Sem' },
    });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Sem.md'].parents = ['[[Jan]]'];
    await mirror.onChanged('Sem.md', files['Sem.md']);
    expect(calls).toEqual([{ path: 'People/Jan.md', property: 'children', value: ['[[Sem]]'] }]);
  });

  it('does not overwrite a spouse that points to someone else', async () => {
    const { env, files, calls } = makeEnv({
      'Jan.md': { name: 'Jan' },
      'Anna.md': { name: 'Anna', spouse: '[[Piet]]' },
      'Piet.md': { name: 'Piet' },
    });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Jan.md'].spouse = '[[Anna]]';
    await mirror.onChanged('Jan.md', files['Jan.md']);
    expect(calls).toEqual([]);
  });

  it('removes a spouse only when it points back', async () => {
    const { env, files, calls } = makeEnv({
      'Jan.md': { name: 'Jan', spouse: '[[Anna]]' },
      'Anna.md': { name: 'Anna', spouse: '[[Jan]]' },
    });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    delete files['Jan.md'].spouse;
    await mirror.onChanged('Jan.md', files['Jan.md']);
    expect(calls).toEqual([{ path: 'Anna.md', property: 'spouse', value: undefined }]);
  });

  it('rename keeps the snapshot consistent', async () => {
    const { env, files, calls } = makeEnv({
      'Jan.md': { name: 'Jan', children: ['[[Sem]]'] },
      'Sem.md': { name: 'Sem', parents: ['[[Jan]]'] },
    });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Johan.md'] = files['Jan.md'];
    delete files['Jan.md'];
    files['Sem.md'].parents = ['[[Johan]]'];
    files['Johan.md'].children = ['[[Sem]]'];
    mirror.onRenamed('Jan.md', 'Johan.md');
    await mirror.onChanged('Sem.md', files['Sem.md']);
    await mirror.onChanged('Johan.md', files['Johan.md']);
    expect(calls).toEqual([]);
  });

  it('resolves a link to a note created later', async () => {
    const { env, files, calls } = makeEnv({ 'Jan.md': { name: 'Jan', spouse: '[[Anna]]' } });
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Anna.md'] = { name: 'Anna' };
    await mirror.onCreated('Anna.md');
    expect(files['Anna.md'].spouse).toBe('[[Jan]]');
    expect(calls).toHaveLength(1);
    await mirror.onChanged('Anna.md', files['Anna.md']);
    expect(calls).toHaveLength(1);
  });

  it('does not lose updates when the cache is stale', async () => {
    const { env, files } = makeEnv(
      { 'Jan.md': { name: 'Jan' }, 'Anna.md': { name: 'Anna' }, 'Sem.md': { name: 'Sem' } },
      { stale: true },
    );
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Jan.md'].children = ['[[Sem]]'];
    files['Anna.md'].children = ['[[Sem]]'];
    await mirror.onChanged('Jan.md', files['Jan.md']);
    await mirror.onChanged('Anna.md', files['Anna.md']);
    expect(files['Sem.md'].parents).toEqual(['[[Jan]]', '[[Anna]]']);
  });

  it('one failing write does not skip the others and keeps its snapshot', async () => {
    const { env, files } = makeEnv(
      { 'Jan.md': { name: 'Jan' }, 'Sem.md': { name: 'Sem' }, 'Lot.md': { name: 'Lot' } },
      { failFor: 'Sem.md' },
    );
    const mirror = new RelationMirror(env, rows);
    mirror.init();
    files['Jan.md'].children = ['[[Sem]]', '[[Lot]]'];
    await expect(mirror.onChanged('Jan.md', files['Jan.md'])).rejects.toThrow(/cannot write Sem.md/);
    expect(files['Lot.md'].parents).toEqual(['[[Jan]]']);
    expect(files['Sem.md'].parents).toBeUndefined();
    // Sem's snapshot did not advance, so a later change to Sem is not mistaken for an echo.
    files['Sem.md'].parents = ['[[Jan]]'];
    await mirror.onChanged('Sem.md', files['Sem.md']);
    expect(files['Jan.md'].children).toEqual(['[[Sem]]', '[[Lot]]']);
  });
});

describe('fixing one-sided relations', () => {
  const item = { path: 'Jan.md', property: 'children', target: 'Sem.md' };

  it('adds the other side', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { children: ['[[Sem]]'] }, 'Sem.md': { parents: ['[[Piet]]'] } });
    expect(await addOtherSide(env, DEFAULT_MAPPING, item)).toBe('added');
    expect(files['Sem.md'].parents).toEqual(['[[Piet]]', '[[Jan]]']);
  });

  it('does not overwrite a single-valued other side', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { spouse: '[[Sem]]' }, 'Sem.md': { spouse: '[[Piet]]' } });
    expect(await addOtherSide(env, DEFAULT_MAPPING, { path: 'Jan.md', property: 'spouse', target: 'Sem.md' })).toBe('blocked');
    expect(files['Sem.md'].spouse).toBe('[[Piet]]');
  });

  it('removes the item and keeps the others', async () => {
    const { env, files } = makeEnv({
      'Jan.md': { children: ['[[Sem]]', '[[Lot]]'] },
      'Sem.md': {},
      'Lot.md': {},
    });
    await removeRelation(env, DEFAULT_MAPPING, item);
    expect(files['Jan.md'].children).toEqual(['[[Lot]]']);
  });

  it('deletes the property when the last item goes', async () => {
    const { env, files } = makeEnv({ 'Jan.md': { children: ['[[Sem]]'] }, 'Sem.md': {} });
    await removeRelation(env, DEFAULT_MAPPING, item);
    expect(files['Jan.md']).not.toHaveProperty('children');
  });
});
