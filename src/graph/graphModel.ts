/** People graph model: contacts + relation snapshots -> nodes and edges. No obsidian / src/context imports. */

import { MappingRow, RelationRow } from "../contacts/friendly/mapping";
import { RelationSnapshot } from "../contacts/friendly/relations";

export type RelationKind = "partner" | "family" | "friends" | "work" | "other";

/** `id` is the note path. */
export interface GraphContact {
  id: string;
  name: string;
  photo?: string;
  snapshot: RelationSnapshot;
}

/** A ghost node (a link that does not resolve to a note) has id `ghost:<link text>`. */
export interface GraphNode {
  id: string;
  name: string;
  photo?: string;
  ghost: boolean;
}

/** `labelFromA` is the vCard type on A's side: Jan `children: Sem` -> a=Jan, b=Sem, labelFromA `child`. */
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
  const edgeByKey = new Map<string, GraphEdge>();

  for (const c of contacts) {
    for (const [property, targets] of Object.entries(c.snapshot)) {
      const row = relationRows.get(property);
      if (!row) continue;
      const label = row.types[0] ?? property;
      // A relation and its mirror are one edge: key by the pair and by the property pair.
      const group = [property, row.mirror ?? property].sort().join("\u0000");
      for (const target of targets) {
        if (target === c.id) continue;
        let other = target;
        if (!noteIds.has(target)) {
          other = GHOST + target;
          if (!nodes.has(other))
            nodes.set(other, { id: other, name: target, ghost: true });
        }
        const key = [c.id, other].sort().join("\u0000") + "\u0001" + group;
        const existing = edgeByKey.get(key);
        if (!existing) {
          const edge: GraphEdge = {
            a: c.id,
            b: other,
            kind: relationKind(row),
            labelFromA: label,
          };
          edgeByKey.set(key, edge);
          edges.push(edge);
        } else if (existing.a === other && existing.labelFromB === undefined) {
          existing.labelFromB = label;
        }
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/**
 * The part of the graph to draw. Edges of a kind not in `kinds` are ignored. From `centre`, breadth-first up to
 * `depth` steps; no centre or depth 'all' -> the whole filtered graph (ghosts left without an edge are dropped).
 * An unknown centre gives an empty graph. More than MAX_NODES nodes -> `{ tooMany: count }`.
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
        .filter((n) => !n.ghost || adjacent.has(n.id))
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
