import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { MirrorEnv, RelationMirror } from 'src/contacts/relationMirror';
import { describe, expect, it } from 'vitest';

type Fm = Record<string, unknown>;

/** In-memory vault: notes by path; `[[Name]]` resolves to the first note called Name (People/ first). */
function makeEnv(files: Record<string, Fm>) {
  const calls: { path: string; property: string; value: string | string[] | undefined }[] = [];
  const env: MirrorEnv = {
    listContacts: () => Object.entries(files).map(([path, frontmatter]) => ({ path, frontmatter })),
    resolveLink: (linkpath) => {
      const paths = Object.keys(files).sort((a, b) => Number(b.startsWith('People/')) - Number(a.startsWith('People/')));
      return paths.find((p) => p === linkpath || p === `${linkpath}.md` || p.endsWith(`/${linkpath}.md`));
    },
    linkTo: (targetPath) => `[[${targetPath.replace(/^.*\//, '').replace(/\.md$/, '')}]]`,
    setProperty: async (path, property, value) => {
      calls.push({ path, property, value });
      if (value === undefined) delete files[path][property];
      else files[path][property] = value;
    },
  };
  return { env, files, calls };
}

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
});
