/**
 * What a reviewed result does besides the card and the note: the mirror writes on other notes ("Also changes")
 * and the note's new file name. Pure; no obsidian / src/context imports.
 */

import { MappingRow } from '../contacts/friendly/mapping';
import { planMirrorWrites, relationSnapshot, RelationSnapshot, toLink } from '../contacts/friendly/relations';
import { FriendlyValue, newCard } from '../contacts/friendly/translate';
import { contactFileName } from '../contacts/friendly/fileName';

type Props = Record<string, FriendlyValue>;

/** The vault as the relationship mirroring sees it. */
export interface MirrorLookup {
  /** The contact note a link path (from the synced note) points to; undefined when it is no contact note. */
  resolveLink(linkpath: string): string | undefined;
  /** The relationship snapshot of the contact note at `path`; undefined when there is none. */
  snapshotOf(path: string): RelationSnapshot | undefined;
}

/**
 * The mirror writes the result would trigger on other notes when the note at `path` goes from `before` to
 * `after`, worded "<other name>: <property> gets <link>" / "... loses ...".
 */
export function alsoChanges(
  path: string,
  before: Props,
  after: Props,
  rows: MappingRow[],
  resolve: MirrorLookup,
  nameOf: (path: string) => string,
): string[] {
  const link = (linkpath: string) => resolve.resolveLink(linkpath);
  const writes = planMirrorWrites(
    path,
    toLink(nameOf(path)),
    relationSnapshot(before, rows, link),
    relationSnapshot(after, rows, link),
    (entry) => {
      const snapshot = entry === path ? undefined : resolve.snapshotOf(entry);
      return snapshot ? { path: entry, snapshot } : undefined;
    },
    rows,
  );
  return writes.map((w) => `${nameOf(w.targetPath)}: ${w.property} ${w.op === 'add' ? 'gets' : 'loses'} ${w.link}`);
}

/** No relationship lookups: only the name lines matter here. */
const NO_RELATIONS = { uidToName: () => undefined, resolveLink: (name: string) => ({ text: name }) };

/** The file name a contact with these properties gets (`contactFileName` from its N parts, else FN). */
function computedName(props: Props, rows: MappingRow[]): string | undefined {
  const { lines } = newCard(props, rows, NO_RELATIONS);
  const value = (name: string) => lines.find((line) => !line.group && line.name === name)?.value;
  return contactFileName(value('N'), value('FN'));
}

/**
 * The note's new file name when the result changes the computed name; undefined otherwise. Only computed names
 * are compared, never the actual file name: a note renamed by hand stays as it is unless its names change.
 */
export function renameTarget(before: Props, after: Props, rows: MappingRow[]): string | undefined {
  const to = computedName(after, rows);
  if (to === undefined) return undefined;
  return to === computedName(before, rows) ? undefined : to;
}
