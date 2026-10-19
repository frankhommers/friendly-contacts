/** Relationship helpers shared by the translators. No obsidian / src/context imports. */

import { MappingRow } from './mapping';

export interface RelationContext {
  /** Display name of the contact with this vCard UID, if known. */
  uidToName(uid: string): string | undefined;
  /** Resolves a link target (a name) to a contact UID, plain text, or "ambiguous". */
  resolveLink(name: string): { uid: string } | { text: string } | { ambiguous: true };
}

export function toLink(name: string): string {
  return `[[${name}]]`;
}

/**
 * Link text for a note whose file name does not say who it is (a fixed folder note name such as `index`):
 * `Contacts/Jan de Vries/index` -> `Contacts/Jan de Vries/index|Jan de Vries`. The link text as it is when its last
 * path segment already is the display name (or the name cannot be used as an alias). Characters that would break
 * a link (`|`, `[`, `]`) are left out of the alias.
 */
export function linkWithAlias(linktext: string, displayName: string): string {
  const alias = displayName.replace(/[|[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  const last = linktext.slice(linktext.lastIndexOf('/') + 1);
  return alias === '' || last === alias ? linktext : `${linktext}|${alias}`;
}

/**
 * Link text -> link path. `[[Path/Name|alias]]` / `[[Path/Name#heading]]` -> `Path/Name`;
 * `[Alias](Path/Name%20X.md)` -> `Path/Name X`; plain text passes through.
 */
export function linkTarget(value: string): string {
  const wiki = /^\[\[([\s\S]*)\]\]$/.exec(value);
  if (wiki) return wiki[1].split('|')[0].split('#')[0];
  const md = /^\[[^\]]*\]\(([\s\S]+)\)$/.exec(value);
  if (md) {
    let target = md[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    try {
      target = decodeURIComponent(target);
    } catch {
      // keep the undecoded target
    }
    return target.replace(/\.md$/i, '');
  }
  return value;
}

/** Relation property -> sorted, unique link targets (file paths when resolvable). */
export type RelationSnapshot = Record<string, string[]>;

export function relationSnapshot(
  props: Record<string, unknown>,
  rows: MappingRow[],
  resolve?: (linkpath: string) => string | undefined,
): RelationSnapshot {
  const snapshot: RelationSnapshot = {};
  for (const row of rows) {
    if (row.kind !== 'relation') continue;
    const raw = props[row.property];
    const values = (Array.isArray(raw) ? raw : [raw]).filter((v): v is string => typeof v === 'string');
    const entries = new Set<string>();
    for (const value of values) {
      const target = linkTarget(value.trim());
      if (target === '') continue;
      entries.add(resolve?.(target) ?? target);
    }
    if (entries.size > 0) snapshot[row.property] = [...entries].sort();
  }
  return snapshot;
}

/** The property that mirrors `property` on the other contact; undefined when it has no mirror. */
export function inverseProperty(property: string, rows: MappingRow[]): string | undefined {
  const row = rows.find((r) => r.kind === 'relation' && r.property === property);
  return row?.kind === 'relation' ? row.mirror : undefined;
}

export interface MirrorWrite {
  targetPath: string;
  property: string;
  /** Link text to add to / remove from the target's property. */
  link: string;
  op: 'add' | 'remove';
}

export function planMirrorWrites(
  sourcePath: string,
  sourceLink: string,
  before: RelationSnapshot,
  after: RelationSnapshot,
  resolve: (entry: string) => { path: string; snapshot: RelationSnapshot } | undefined,
  rows: MappingRow[],
): MirrorWrite[] {
  const writes: MirrorWrite[] = [];
  for (const property of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const inverse = inverseProperty(property, rows);
    if (inverse === undefined) continue;
    const old = before[property] ?? [];
    const now = after[property] ?? [];
    const changes: [string, 'add' | 'remove'][] = [
      ...now.filter((e) => !old.includes(e)).map((e): [string, 'add' | 'remove'] => [e, 'add']),
      ...old.filter((e) => !now.includes(e)).map((e): [string, 'add' | 'remove'] => [e, 'remove']),
    ];
    for (const [entry, op] of changes) {
      const target = resolve(entry);
      if (!target) continue;
      const pointsBack = (target.snapshot[inverse] ?? []).includes(sourcePath);
      if (op === 'add' ? pointsBack : !pointsBack) continue;
      writes.push({ targetPath: target.path, property: inverse, link: sourceLink, op });
    }
  }
  return writes;
}

/** Relation entries whose target (among `all`) does not list the source back under the inverse property. */
export function findOneSided(
  all: { path: string; snapshot: RelationSnapshot }[],
  rows: MappingRow[],
): { path: string; property: string; target: string }[] {
  const byPath = new Map(all.map((c) => [c.path, c.snapshot]));
  const result: { path: string; property: string; target: string }[] = [];
  for (const { path, snapshot } of all) {
    for (const [property, entries] of Object.entries(snapshot)) {
      const inverse = inverseProperty(property, rows);
      if (inverse === undefined) continue;
      for (const target of entries) {
        const other = byPath.get(target);
        if (other && !(other[inverse] ?? []).includes(path)) result.push({ path, property, target });
      }
    }
  }
  return result;
}

/**
 * Resolves a relation name from the server to a contact by its file name; exact match only.
 * Entries are deduped by UID first (one contact in several address books counts once); a UID that
 * has different file names across sources is ambiguous for each of those names.
 */
export function resolveRemoteName(
  name: string,
  remote: { uid: string; fileName: string }[],
): { uid: string } | { text: string } | { ambiguous: true } {
  const namesOf = new Map<string, Set<string>>();
  for (const r of remote) namesOf.set(r.uid, (namesOf.get(r.uid) ?? new Set()).add(r.fileName));
  const uids = [...namesOf].filter(([, names]) => names.has(name));
  if (uids.length === 0) return { text: name };
  if (uids.length > 1 || uids[0][1].size > 1) return { ambiguous: true };
  return { uid: uids[0][0] };
}
