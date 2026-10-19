/** People graph model: contacts + relation snapshots -> nodes and edges. No obsidian / src/context imports. */

import { MappingRow, RelationRow } from "../contacts/friendly/mapping";
import { RelationSnapshot } from "../contacts/friendly/relations";

export type RelationKind = "partner" | "family" | "friends" | "work" | "other";

/** `id` is the note path. `aliases`: an unresolved link target -> the label written in the link (`[[x|Label]]`). */
export interface GraphContact {
  id: string;
  name: string;
  photo?: string;
  snapshot: RelationSnapshot;
  aliases?: Map<string, string>;
}

/** A ghost node (a link that does not resolve to a note) has id `ghost:<link text>`. */
export interface GraphNode {
  id: string;
  name: string;
  photo?: string;
  ghost: boolean;
}

/**
 * `labelFromA` is the vCard type on A's side: Jan `children: Sem` -> a=Jan, b=Sem, labelFromA `child` (what B is to
 * A). `labelFromB` is the type of the relation's mirror (`parent`, what A is to B), also when B does not list it;
 * absent for a relation without a mirror (`emergency`).
 */
export interface GraphEdge {
  a: string;
  b: string;
  kind: RelationKind;
  labelFromA: string;
  labelFromB?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const MAX_NODES = 500;
export const LOD_NAMES_ZOOM = 0.6;
export const LOD_PHOTOS_ZOOM = 1.2;

const KIND_BY_TYPE: Record<string, RelationKind> = {
  spouse: "partner",
  child: "family",
  parent: "family",
  sibling: "family",
  kin: "family",
  friend: "friends",
  colleague: "work",
  "co-worker": "work",
};

/** The kind follows the row's vCard type (the first type that has a kind), never the property name. */
export function relationKind(row: RelationRow): RelationKind {
  for (const type of row.types) {
    const kind = KIND_BY_TYPE[type.trim().toLowerCase()];
    if (kind) return kind;
  }
  return "other";
}

const GHOST = "ghost:";

/** The link target of a ghost node's id; undefined for a contact note. */
export function ghostTarget(id: string): string | undefined {
  return id.startsWith(GHOST) ? id.slice(GHOST.length) : undefined;
}

/** A ghost's name: the link's alias, else the last part of the link target (without `.md`). */
export function ghostName(target: string, alias: string | undefined): string {
  const label = alias?.trim();
  if (label) return label;
  const last = target.split("/").pop()?.replace(/\.md$/i, "").trim();
  return last || target;
}

/**
 * One key for a relation and its mirror seen from the other side: (from, to, property) is the same edge as
 * (to, from, mirror). Without a mirror only the same direction is the same edge.
 */
function directedKey(from: string, to: string, property: string, mirror: string | undefined): string {
  const forward = [from, to, property].join("\u0000");
  if (mirror === undefined) return forward;
  const backward = [to, from, mirror].join("\u0000");
  return forward < backward ? forward : backward;
}

export function buildGraph(
  contacts: GraphContact[],
  rows: MappingRow[],
): Graph {
  const relationRows = new Map<string, RelationRow>();
  for (const row of rows)
    if (row.kind === "relation") relationRows.set(row.property, row);

  const nodes = new Map<string, GraphNode>();
  for (const c of contacts) {
    const node: GraphNode = { id: c.id, name: c.name, ghost: false };
    if (c.photo !== undefined) node.photo = c.photo;
    nodes.set(c.id, node);
  }
  const noteIds = new Set(nodes.keys());

  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  for (const c of contacts) {
    for (const [property, targets] of Object.entries(c.snapshot)) {
      const row = relationRows.get(property);
      if (!row) continue;
      const label = row.types[0] ?? property;
      const mirrorRow =
        row.mirror !== undefined ? relationRows.get(row.mirror) : undefined;
      const mirrorLabel = mirrorRow && (mirrorRow.types[0] ?? mirrorRow.property);
      for (const target of targets) {
        if (target === c.id) continue;
        let other = target;
        if (!noteIds.has(target)) {
          other = GHOST + target;
          if (!nodes.has(other))
            nodes.set(other, {
              id: other,
              name: ghostName(target, c.aliases?.get(target)),
              ghost: true,
            });
        }
        // Jan `children: Sem` and Sem `parents: Jan` are one edge; Jan and Sem both `children` of the other are two.
        const key = directedKey(c.id, other, property, mirrorRow?.property);
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        const edge: GraphEdge = {
          a: c.id,
          b: other,
          kind: relationKind(row),
          labelFromA: label,
        };
        if (mirrorLabel !== undefined) edge.labelFromB = mirrorLabel;
        edges.push(edge);
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/**
 * The part of the graph to draw. Edges of a kind not in `kinds` are ignored. From `centre`, breadth-first up to
 * `depth` steps; no centre or depth 'all' -> the whole filtered graph, without the people (and ghosts) left without
 * an edge, except the centre. An unknown centre gives an empty graph. More than MAX_NODES nodes ->
 * `{ tooMany: count }`.
 */
export function neighbourhood(
  graph: Graph,
  centre: string | undefined,
  depth: number | "all",
  kinds: Set<RelationKind>,
): { graph: Graph } | { tooMany: number } {
  const edges = graph.edges.filter((e) => kinds.has(e.kind));
  const adjacent = new Map<string, string[]>();
  for (const e of edges) {
    (adjacent.get(e.a) ?? adjacent.set(e.a, []).get(e.a)!).push(e.b);
    (adjacent.get(e.b) ?? adjacent.set(e.b, []).get(e.b)!).push(e.a);
  }

  let keep: Set<string>;
  if (centre === undefined || depth === "all") {
    keep = new Set(
      graph.nodes
        .filter((n) => adjacent.has(n.id) || n.id === centre)
        .map((n) => n.id),
    );
  } else {
    keep = new Set();
    if (graph.nodes.some((n) => n.id === centre)) {
      keep.add(centre);
      let frontier = [centre];
      for (let step = 0; step < depth && frontier.length > 0; step++) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const nb of adjacent.get(id) ?? []) {
            if (!keep.has(nb)) {
              keep.add(nb);
              next.push(nb);
            }
          }
        }
        frontier = next;
      }
    }
  }

  if (keep.size > MAX_NODES) return { tooMany: keep.size };
  return {
    graph: {
      nodes: graph.nodes.filter((n) => keep.has(n.id)),
      edges: edges.filter((e) => keep.has(e.a) && keep.has(e.b)),
    },
  };
}

export function lodTier(zoom: number): "dots" | "names" | "photos" {
  if (zoom < LOD_NAMES_ZOOM) return "dots";
  return zoom < LOD_PHOTOS_ZOOM ? "names" : "photos";
}
