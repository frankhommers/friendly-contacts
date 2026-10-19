/**
 * Editing a contact's relationships by contact (not by link text), and the sidebar's display model.
 * Works over MirrorEnv, so no Obsidian here; the mirroring then writes the other side.
 */

import { MappingRow } from 'src/contacts/friendly/mapping';
import { inverseProperty, linkTarget, resolveRemoteName } from 'src/contacts/friendly/relations';
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
/**
 * `replaces`: the name shown for the entry the add takes the place of (stored as `text`). `sameName`: that entry
 * is an unresolved name for the added contact itself, so nobody is lost by replacing it.
 */
export type AddResult = 'added' | 'exists' | { replaces: string; text: string; sameName: boolean };

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

const sameText = (a: string, b: string): boolean => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

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
  const targetName = nameOf(targetPath);
  const sameName = texts.find(
    (text) =>
      resolveEntry(env, text, path) === undefined &&
      (sameText(fallbackDisplay(text), targetName) || sameText(linkTarget(text.trim()), targetName)),
  );
  if (sameName !== undefined) return { replaces: fallbackDisplay(sameName), text: sameName, sameName: true };
  if (row.single === true && texts.length > 0) {
    return { replaces: personOf(env, path, texts[0], nameOf).display, text: texts[0], sameName: false };
  }
  return 'added';
}

/**
 * When `targetPath`'s side of a single relation (e.g. their `spouse`) already names someone other than `path`,
 * the mirror cannot write it: that property and the name it holds. Undefined when the other side is free.
 */
export function otherSideTaken(
  env: MirrorEnv,
  rows: MappingRow[],
  path: string,
  property: string,
  targetPath: string,
  targetFrontmatter: Record<string, unknown>,
  nameOf: (path: string) => string = baseName,
): { property: string; name: string } | undefined {
  const inverse = inverseProperty(property, rows);
  const inverseRow = rows.find((r): r is RelationRow => r.kind === 'relation' && r.property === inverse);
  if (inverse === undefined || inverseRow?.single !== true) return undefined;
  const texts = entryTexts(targetFrontmatter[inverse]);
  if (texts.length === 0 || texts.some((text) => resolveEntry(env, text, targetPath) === path)) return undefined;
  return { property: inverse, name: personOf(env, targetPath, texts[0], nameOf).display };
}

/**
 * Adds the contact under `property`; a single relation is replaced. The link text is the env's. `replacing`: the
 * stored text of the entry the link takes the place of (see `planAdd`); it is dropped when the contact is listed.
 * Entries that are not text are kept as they are.
 */
export async function addRelation(
  env: MirrorEnv,
  rows: MappingRow[],
  path: string,
  property: string,
  targetPath: string,
  replacing?: string,
): Promise<void> {
  const row = relationRow(rows, property);
  const replaced = (item: unknown) => replacing !== undefined && typeof item === 'string' && item.trim() === replacing.trim();
  await env.updateProperty(path, property, (current) => {
    const items = relationItems(current);
    const listed = items.some((item) => typeof item === 'string' && resolveEntry(env, item, path) === targetPath);
    if (listed) {
      if (!items.some(replaced)) return current as string | string[] | undefined;
      const kept = items.filter((item) => !replaced(item)) as string[];
      return row.single === true && kept.length === 1 ? kept[0] : kept;
    }
    const link = env.linkTo(targetPath, path);
    if (row.single === true) return link;
    const at = items.findIndex(replaced);
    return (at === -1 ? [...items, link] : items.map((item, i) => (i === at ? link : item))) as string[];
  });
}

/** Turns the unresolved entry stored as `text` into a link to the contact note `targetPath`, in its place. */
export function linkRelationEntry(
  env: MirrorEnv,
  rows: MappingRow[],
  path: string,
  property: string,
  text: string,
  targetPath: string,
): Promise<void> {
  return addRelation(env, rows, path, property, targetPath, text);
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

/**
 * The card on the server an unresolved entry names, when its text matches exactly one contact there (see
 * `resolveRemoteName`); undefined when there is none or the name is ambiguous.
 */
export function remoteCardFor<T extends { uid: string; fileName: string }>(text: string, remote: T[]): T | undefined {
  const name = linkTarget(text.trim()).trim();
  if (name === '') return undefined;
  const resolved = resolveRemoteName(name, remote);
  return 'uid' in resolved ? remote.find((r) => r.uid === resolved.uid) : undefined;
}

/**
 * What the sidebar offers for an unresolved entry: Import when its card (see `remoteCardFor`, judged on every card)
 * has no note yet, Link to the note when it has one (`notePathOf`: card UID -> note), nothing when that note is the
 * contact's own (`selfPath`).
 */
export function ghostAction<T extends { uid: string; fileName: string }>(
  text: string,
  remote: T[],
  notePathOf: (uid: string) => string | undefined,
  selfPath: string,
): { import: T } | { link: string } | undefined {
  const card = remoteCardFor(text, remote);
  if (card === undefined) return undefined;
  const notePath = notePathOf(card.uid);
  if (notePath === undefined) return { import: card };
  return notePath === selfPath ? undefined : { link: notePath };
}
