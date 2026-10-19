import { MirrorEnv } from 'src/contacts/relationMirror';

export type Fm = Record<string, unknown>;

export type Value = string | string[] | undefined;

/**
 * In-memory vault: notes by path; `[[Name]]` resolves to the first note called Name (People/ first).
 * `listContacts` can serve a stale copy (like the metadata cache) while `updateProperty` works on live state.
 */
export function makeEnv(files: Record<string, Fm>, options: { stale?: boolean; failFor?: string } = {}) {
  const calls: { path: string; property: string; value: Value }[] = [];
  const cached = options.stale ? structuredClone(files) : undefined;
  const env: MirrorEnv = {
    listContacts: () =>
      Object.entries(cached ?? files).map(([path, frontmatter]) => ({ path, frontmatter: structuredClone(frontmatter) })),
    resolveLink: (linkpath) => {
      const paths = Object.keys(files).sort((a, b) => Number(b.startsWith('People/')) - Number(a.startsWith('People/')));
      return paths.find((p) => p === linkpath || p === `${linkpath}.md` || p.endsWith(`/${linkpath}.md`));
    },
    linkTo: (targetPath) => `[[${targetPath.replace(/^.*\//, '').replace(/\.md$/, '')}]]`,
    updateProperty: async (path, property, fn) => {
      if (path === options.failFor) throw new Error(`cannot write ${path}`);
      const value = fn(files[path][property]);
      if (value === files[path][property]) return;
      calls.push({ path, property, value });
      if (value === undefined) delete files[path][property];
      else files[path][property] = value;
    },
  };
  return { env, files, calls };
}
