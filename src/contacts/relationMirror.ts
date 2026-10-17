/**
 * Keeps relationship properties mirrored between contact notes (`children` on one note,
 * `parents` on the other). Stateful, but free of Obsidian: the vault is reached through MirrorEnv.
 */

import { MappingRow } from 'src/contacts/friendly/mapping';
import {
  inverseProperty,
  linkTarget,
  MirrorWrite,
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
  /** Sets a property; `undefined` deletes it. */
  setProperty(path: string, property: string, value: string | string[] | undefined): Promise<void>;
}

const asItems = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

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
    await this.apply(path, before, after, () => this.currentFrontmatter(path, frontmatter));
  }

  async onCreated(path: string): Promise<void> {
    // Links that did not resolve before may resolve now.
    this.rebuild();
    const current = this.currentFrontmatter();
    const loaded = () => current;
    const rows = this.rows();
    for (const [other, snapshot] of this.snapshots) {
      if (other === path) continue;
      for (const [property, entries] of Object.entries(snapshot)) {
        const inverse = inverseProperty(property, rows);
        if (inverse !== undefined && entries.includes(path)) {
          await this.applyWrite({ source: other, targetPath: path, property: inverse, op: 'add' }, current);
        }
      }
    }
    await this.apply(path, {}, this.snapshots.get(path) ?? {}, loaded);
  }

  onRenamed(_oldPath: string, _newPath: string): void {
    // Obsidian rewrites the links itself; only the path-keyed snapshots need rebuilding.
    this.rebuild();
  }

  private rebuild(): void {
    this.snapshots = new Map(this.env.listContacts().map((c) => [c.path, this.snapshotOf(c.path, c.frontmatter)]));
  }

  private snapshotOf(path: string, frontmatter: Frontmatter): RelationSnapshot {
    return relationSnapshot(frontmatter, this.rows(), (link) => this.env.resolveLink(link, path));
  }

  private currentFrontmatter(path?: string, frontmatter?: Frontmatter): Map<string, Frontmatter> {
    const map = new Map(this.env.listContacts().map((c) => [c.path, { ...c.frontmatter }]));
    if (path !== undefined && frontmatter) map.set(path, { ...frontmatter });
    return map;
  }

  private async apply(
    sourcePath: string,
    before: RelationSnapshot,
    after: RelationSnapshot,
    loadCurrent: () => Map<string, Frontmatter>,
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
    if (writes.length === 0) return;
    const current = loadCurrent();
    for (const write of writes) await this.applyWrite({ ...write, source: sourcePath }, current);
  }

  private async applyWrite(
    write: Pick<MirrorWrite, 'targetPath' | 'property' | 'op'> & { source: string },
    current: Map<string, Frontmatter>,
  ): Promise<void> {
    const { source, targetPath, property, op } = write;
    const target = current.get(targetPath);
    if (!target) return;
    const row = this.rows().find((r) => r.kind === 'relation' && r.property === property);
    const single = row?.kind === 'relation' && row.single === true;
    const items = asItems(target[property]);
    const pointsToSource = (item: unknown) =>
      typeof item === 'string' && this.env.resolveLink(linkTarget(item.trim()), targetPath) === source;

    let value: string | string[] | undefined;
    if (op === 'add') {
      if (items.some(pointsToSource)) return;
      const link = this.env.linkTo(source, targetPath);
      if (single) {
        if (items.some((i) => typeof i === 'string' && i.trim() !== '')) return;
        value = link;
      } else {
        value = [...(items as string[]), link];
      }
    } else {
      const kept = items.filter((item) => !pointsToSource(item));
      if (kept.length === items.length) return;
      value = kept.length === 0 ? undefined : single ? (kept[0] as string) : (kept as string[]);
    }

    // Record the expected state first: the `changed` event of this write must diff to nothing.
    const next = { ...target };
    if (value === undefined) delete next[property];
    else next[property] = value;
    current.set(targetPath, next);
    this.snapshots.set(targetPath, this.snapshotOf(targetPath, next));
    await this.env.setProperty(targetPath, property, value);
  }
}
