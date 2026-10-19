/**
 * Keeps relationship properties mirrored between contact notes (`children` on one note,
 * `parents` on the other). Stateful, but free of Obsidian: the vault is reached through MirrorEnv.
 */

import { recoverWikilink } from 'src/contacts/friendly/merge';
import { MappingRow } from 'src/contacts/friendly/mapping';
import {
  inverseProperty,
  linkTarget,
  planMirrorWrites,
  relationSnapshot,
  RelationSnapshot,
} from 'src/contacts/friendly/relations';

type Frontmatter = Record<string, unknown>;

export interface MirrorEnv {
  listContacts(): { path: string; frontmatter: Frontmatter }[];
  /** Path of the contact note a link path points to, seen from `fromPath`. */
  resolveLink(linkpath: string, fromPath: string): string | undefined;
  /** `[[...]]` link to `targetPath`, as written in a note at `fromPath`. */
  linkTo(targetPath: string, fromPath: string): string;
  /**
   * Rewrites one property. `fn` receives the live value (read inside the write, not from a cache) and returns
   * the new one; `undefined` deletes the key. Returning `current` unchanged is a no-op.
   */
  updateProperty(
    path: string,
    property: string,
    fn: (current: unknown) => string | string[] | undefined,
  ): Promise<void>;
}

type Op = 'add' | 'remove';

const asItems = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

/**
 * The entries of a relation property as the user may have left it: a list, a single string, or the
 * `[["Name"]]` YAML makes of an unquoted `[[Name]]` (recovered as the link text).
 */
export function relationItems(value: unknown): unknown[] {
  const whole = recoverWikilink(value);
  return (whole !== undefined ? [whole] : asItems(value)).map((item) => recoverWikilink(item) ?? item);
}

export class RelationMirror {
  private snapshots = new Map<string, RelationSnapshot>();

  constructor(
    private env: MirrorEnv,
    private rows: () => MappingRow[],
  ) {}

  init(): void {
    this.rebuild();
  }

  async onChanged(path: string, frontmatter: Frontmatter): Promise<void> {
    const before = this.snapshots.get(path) ?? {};
    const after = this.snapshotOf(path, frontmatter);
    this.snapshots.set(path, after);
    await this.mirrorChanges(path, before, after);
  }

  /** Call once the new note is visible to the env (listed, resolvable). */
  async onCreated(path: string): Promise<void> {
    // Links that did not resolve before may resolve now; this also records the new note's own snapshot.
    this.rebuild();
    const rows = this.rows();
    const errors: unknown[] = [];
    for (const [other, snapshot] of [...this.snapshots]) {
      if (other === path) continue;
      for (const [property, entries] of Object.entries(snapshot)) {
        const inverse = inverseProperty(property, rows);
        if (inverse !== undefined && entries.includes(path)) {
          await this.attempt({ source: other, targetPath: path, property: inverse, op: 'add' }, errors);
        }
      }
    }
    await this.mirrorChanges(path, {}, this.snapshots.get(path) ?? {}, errors);
  }

  onRenamed(_oldPath: string, _newPath: string): void {
    // Obsidian rewrites the links itself; only the path-keyed snapshots need rebuilding.
    this.rebuild();
  }

  /** Snapshots of every contact note, from scratch (e.g. after the contacts folder changed). */
  rebuild(): void {
    this.snapshots = new Map(this.env.listContacts().map((c) => [c.path, this.snapshotOf(c.path, c.frontmatter)]));
  }

  private snapshotOf(path: string, frontmatter: Frontmatter): RelationSnapshot {
    return relationSnapshot(frontmatter, this.rows(), (link) => this.env.resolveLink(link, path));
  }

  private async mirrorChanges(
    sourcePath: string,
    before: RelationSnapshot,
    after: RelationSnapshot,
    errors: unknown[] = [],
  ): Promise<void> {
    const writes = planMirrorWrites(
      sourcePath,
      '',
      before,
      after,
      (entry) => {
        const snapshot = entry === sourcePath ? undefined : this.snapshots.get(entry);
        return snapshot ? { path: entry, snapshot } : undefined;
      },
      this.rows(),
    );
    for (const write of writes) {
      await this.attempt({ source: sourcePath, targetPath: write.targetPath, property: write.property, op: write.op }, errors);
    }
    if (errors.length > 0) {
      const messages = errors.map((e) => (e instanceof Error ? e.message : String(e))).join('; ');
      throw new Error(`${errors.length} relationship write(s) failed: ${messages}`);
    }
  }

  /** One failing write must not stop the others; the failure is collected in `errors`. */
  private async attempt(
    write: { source: string; targetPath: string; property: string; op: Op },
    errors: unknown[],
  ): Promise<void> {
    const previous = this.snapshots.get(write.targetPath);
    try {
      await this.applyWrite(write);
    } catch (error) {
      // The note was not changed after all: keep the snapshot as it was.
      if (previous) this.snapshots.set(write.targetPath, previous);
      else this.snapshots.delete(write.targetPath);
      errors.push(error);
    }
  }

  private async applyWrite(write: { source: string; targetPath: string; property: string; op: Op }): Promise<void> {
    const { source, targetPath, property, op } = write;
    const row = this.rows().find((r) => r.kind === 'relation' && r.property === property);
    const single = row?.kind === 'relation' && row.single === true;
    const pointsToSource = (item: unknown) =>
      typeof item === 'string' && this.env.resolveLink(linkTarget(item.trim()), targetPath) === source;

    await this.env.updateProperty(targetPath, property, (current) => {
      const items = asItems(current);
      let value: string | string[] | undefined;
      if (op === 'add') {
        if (items.some(pointsToSource)) return current as string | string[] | undefined;
        const link = this.env.linkTo(source, targetPath);
        if (single) {
          if (items.some((i) => typeof i === 'string' && i.trim() !== '')) return current as string | string[] | undefined;
          value = link;
        } else {
          value = [...(items as string[]), link];
        }
      } else {
        const kept = items.filter((item) => !pointsToSource(item));
        if (kept.length === items.length) return current as string | string[] | undefined;
        value = kept.length === 0 ? undefined : single ? (kept[0] as string) : (kept as string[]);
      }
      // Record the expected state before the file is written: the `changed` event of this write must diff to nothing.
      const snapshot = { ...(this.snapshots.get(targetPath) ?? {}) };
      const entries = relationSnapshot({ [property]: value }, this.rows(), (link) => this.env.resolveLink(link, targetPath))[property];
      if (entries) snapshot[property] = entries;
      else delete snapshot[property];
      this.snapshots.set(targetPath, snapshot);
      return value;
    });
  }
}

export interface OneSidedItem {
  /** Note holding the relation. */
  path: string;
  property: string;
  /** Note it points to, which does not point back. */
  target: string;
}

/** Writes the missing side of a one-sided relation. 'blocked': the other side is single-valued and taken. */
export async function addOtherSide(env: MirrorEnv, rows: MappingRow[], item: OneSidedItem): Promise<'added' | 'blocked'> {
  const inverse = inverseProperty(item.property, rows);
  if (inverse === undefined) throw new Error(`${item.property} has no mirror property`);
  const inverseRow = rows.find((r) => r.kind === 'relation' && r.property === inverse);
  const single = inverseRow?.kind === 'relation' && inverseRow.single === true;
  const pointsToSource = (entry: unknown) =>
    typeof entry === 'string' && env.resolveLink(linkTarget(entry.trim()), item.target) === item.path;
  let result: 'added' | 'blocked' = 'added';
  await env.updateProperty(item.target, inverse, (current) => {
    const items = asItems(current);
    if (items.some(pointsToSource)) return current as string | string[] | undefined;
    if (single && items.some((i) => typeof i === 'string' && i.trim() !== '')) {
      result = 'blocked';
      return current as string | string[] | undefined;
    }
    const link = env.linkTo(item.path, item.target);
    return single ? link : [...(items as string[]), link];
  });
  return result;
}

/**
 * Removes the entries of a relation property that `matches`; the last one going removes the property.
 * Nothing is written when nothing matches.
 */
export async function removeEntries(
  env: MirrorEnv,
  rows: MappingRow[],
  path: string,
  property: string,
  matches: (entry: string) => boolean,
): Promise<void> {
  const row = rows.find((r) => r.kind === 'relation' && r.property === property);
  const single = row?.kind === 'relation' && row.single === true;
  await env.updateProperty(path, property, (current) => {
    const items = relationItems(current);
    const kept = items.filter((entry) => !(typeof entry === 'string' && matches(entry)));
    if (kept.length === items.length) return current as string | string[] | undefined;
    if (kept.length === 0) return undefined;
    return single ? (kept[0] as string) : (kept as string[]);
  });
}

/** Removes the item's target from the relation property of the note holding it. */
export async function removeRelation(env: MirrorEnv, rows: MappingRow[], item: OneSidedItem): Promise<void> {
  await removeEntries(
    env,
    rows,
    item.path,
    item.property,
    (entry) => env.resolveLink(linkTarget(entry.trim()), item.path) === item.target,
  );
}
