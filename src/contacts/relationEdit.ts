/**
 * Editing a contact's relationships by contact (not by link text), and the sidebar's display model.
 * Works over MirrorEnv, so no Obsidian here; the mirroring then writes the other side.
 */

import { MappingRow } from 'src/contacts/friendly/mapping';
import { linkTarget } from 'src/contacts/friendly/relations';
import { MirrorEnv, relationItems, removeEntries } from 'src/contacts/relationMirror';

export interface RelationPerson {
  /** The stored value. */
  text: string;
  display: string;
  /** The contact note it resolves to; absent for an unresolved (ghost) entry. */
  path?: string;
}
export interface RelationGroup {
  property: string;
  type: string;
  people: RelationPerson[];
}
export type AddResult = 'added' | 'exists' | { replaces: string };

type RelationRow = Extract<MappingRow, { kind: 'relation' }>;

function relationRow(rows: MappingRow[], property: string): RelationRow {
  const row = rows.find((r): r is RelationRow => r.kind === 'relation' && r.property === property);
  if (!row) throw new Error(`${property} is not a relation property`);
  return row;
}

/** The non-empty stored texts of a relation property. */
const entryTexts = (value: unknown): string[] =>
  relationItems(value).filter((v): v is string => typeof v === 'string' && v.trim() !== '');

const resolveEntry = (env: MirrorEnv, text: string, fromPath: string): string | undefined =>
  env.resolveLink(linkTarget(text.trim()), fromPath);

/** `[[x|Alias]]` / `[Alias](x)` -> Alias, else the link target text. */
function fallbackDisplay(text: string): string {
  const value = text.trim();
  const alias = /^\[\[[^|\]]*\|([^\]]*)\]\]$/.exec(value)?.[1] ?? /^\[([^\]]+)\]\(/.exec(value)?.[1];
  return alias?.trim() || linkTarget(value);
}

const baseName = (path: string): string => path.replace(/^.*\//, '').replace(/\.md$/, '');

function personOf(env: MirrorEnv, fromPath: string, text: string, nameOf: (path: string) => string): RelationPerson {
  const path = resolveEntry(env, text, fromPath);
  return path === undefined ? { text, display: fallbackDisplay(text) } : { text, display: nameOf(path), path };
}

/** One group per relation row (mapping order) that has entries. */
export function relationGroups(
  env: MirrorEnv,
  rows: MappingRow[],
  path: string,
  frontmatter: Record<string, unknown>,
  nameOf: (path: string) => string,
): RelationGroup[] {
  const groups: RelationGroup[] = [];
  for (const row of rows) {
    if (row.kind !== 'relation') continue;
    const people = entryTexts(frontmatter[row.property]).map((text) => personOf(env, path, text, nameOf));
    if (people.length > 0) groups.push({ property: row.property, type: row.types[0], people });
  }
  return groups;
}

/** What adding `targetPath` under `property` would do. `nameOf` names the replaced contact (default: file name). */
export function planAdd(
  env: MirrorEnv,
  rows: MappingRow[],
  path: string,
  frontmatter: Record<string, unknown>,
  property: string,
  targetPath: string,
  nameOf: (path: string) => string = baseName,
): AddResult {
  const row = relationRow(rows, property);
  const texts = entryTexts(frontmatter[property]);
  if (texts.some((text) => resolveEntry(env, text, path) === targetPath)) return 'exists';
  if (row.single === true && texts.length > 0) return { replaces: personOf(env, path, texts[0], nameOf).display };
  return 'added';
}

/** Adds the contact under `property`; a single relation is replaced. The link text is the env's. */
export async function addRelation(
  env: MirrorEnv,
  rows: MappingRow[],
  path: string,
  property: string,
  targetPath: string,
): Promise<void> {
  const row = relationRow(rows, property);
  await env.updateProperty(path, property, (current) => {
    const items = relationItems(current);
    const listed = items.some((item) => typeof item === 'string' && resolveEntry(env, item, path) === targetPath);
    if (listed) return current as string | string[] | undefined;
    const link = env.linkTo(targetPath, path);
    return row.single === true ? link : [...(items.filter((i) => typeof i === 'string') as string[]), link];
  });
}

/** Removes the entry stored as `text`, or any entry resolving to the same note. */
export async function removeRelationEntry(
  env: MirrorEnv,
  rows: MappingRow[],
  path: string,
  property: string,
  text: string,
): Promise<void> {
  relationRow(rows, property);
  const wanted = text.trim();
  const note = resolveEntry(env, wanted, path);
  await removeEntries(
    env,
    rows,
    path,
    property,
    (entry) => entry.trim() === wanted || (note !== undefined && resolveEntry(env, entry, path) === note),
  );
}
