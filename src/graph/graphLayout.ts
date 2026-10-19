/**
 * Pure helpers of the people graph view: distances from the centre, edge labels and where they go, hit-testing,
 * position carry-over, initials, photo sources and the view state (and its centre). No obsidian / src/context imports.
 */

import { GRAPH_KINDS } from "./graphColors";
import type { Graph, GraphEdge, RelationKind } from "./graphModel";

export const DEFAULT_DEPTH = 2;
export const DEPTH_CHOICES: readonly (number | "all")[] = [1, 2, 3, 4, "all"];

/** Steps from `centre` to every node it reaches; empty without a centre. */
export function hopDistances(graph: Graph, centre: string | undefined): Map<string, number> {
  const distances = new Map<string, number>();
  if (centre === undefined || !graph.nodes.some((n) => n.id === centre)) return distances;
  const adjacent = new Map<string, string[]>();
  for (const e of graph.edges) {
    (adjacent.get(e.a) ?? adjacent.set(e.a, []).get(e.a)!).push(e.b);
    (adjacent.get(e.b) ?? adjacent.set(e.b, []).get(e.b)!).push(e.a);
  }
  distances.set(centre, 0);
  let frontier = [centre];
  for (let step = 1; frontier.length > 0; step++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adjacent.get(id) ?? []) {
        if (!distances.has(nb)) {
          distances.set(nb, step);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return distances;
}

/** Labels whose one-way form is not just "<type> of". */
const ONE_WAY: Record<string, string> = { emergency: "emergency contact of" };

/**
 * The label of a relation without a mirror read from its other end: Jan `emergency: Piet` seen from Piet is
 * "emergency contact of" (Jan), any other type `t` is "t of".
 */
export function oneWayLabel(type: string): string {
  return ONE_WAY[type.trim().toLowerCase()] ?? `${type} of`;
}

/**
 * The label of `edge` as seen from the end nearer the centre, and the node it describes (the other end, where it is
 * drawn). B's view when B is strictly nearer, else A's (also on a tie and without a centre). An end missing from
 * `distances` counts as farthest. B's label is the mirror's type; a relation without a mirror reads `oneWayLabel`.
 */
export function edgeLabel(edge: GraphEdge, distances: Map<string, number>): { text: string; towards: string } {
  const da = distances.get(edge.a) ?? Infinity;
  const db = distances.get(edge.b) ?? Infinity;
  if (db < da) return { text: edge.labelFromB ?? oneWayLabel(edge.labelFromA), towards: edge.a };
  return { text: edge.labelFromA, towards: edge.b };
}

/** How far along its edge (from the viewing end) a label is drawn: near the node it describes. */
export const LABEL_T = 0.68;

interface Point {
  x: number;
  y: number;
}

/** The point at `t` (0..1) on the quadratic curve from `s` through control point `c` to `e`. */
export function quadraticPoint(s: Point, c: Point, e: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * s.x + 2 * u * t * c.x + t * t * e.x, y: u * u * s.y + 2 * u * t * c.y + t * t * e.y };
}

/**
 * The centre to draw around: `centre` while it is a contact in `graph`; `fallback()` once it is gone (deleted, or
 * now a ghost). An empty graph (the notes are not read yet) keeps it, so a saved centre is not lost at startup.
 */
export function keptCentre(centre: string | undefined, graph: Graph, fallback: () => string | undefined): string | undefined {
  if (centre === undefined || graph.nodes.length === 0) return centre;
  return graph.nodes.some((n) => n.id === centre && !n.ghost) ? centre : fallback();
}

/**
 * Per edge, its place among the edges between the same two people, centred on 0 (one edge: 0; two: -0.5, 0.5).
 * The side is relative to the line from the pair's smaller id to its larger id.
 */
export function parallelOffsets(edges: GraphEdge[]): number[] {
  const pairKey = (e: GraphEdge) => (e.a < e.b ? `${e.a}\u0000${e.b}` : `${e.b}\u0000${e.a}`);
  const counts = new Map<string, number>();
  for (const e of edges) counts.set(pairKey(e), (counts.get(pairKey(e)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return edges.map((e) => {
    const key = pairKey(e);
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    return index - ((counts.get(key) ?? 1) - 1) / 2;
  });
}

/** The node nearest to (x, y) within its radius; nodes without a position are skipped. */
export function hitTest<T extends { x?: number; y?: number }>(
  nodes: T[],
  x: number,
  y: number,
  radius: number | ((node: T) => number),
): T | undefined {
  let best: T | undefined;
  let bestDistance = Infinity;
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    const r = typeof radius === "number" ? radius : radius(n);
    if (d <= r && d < bestDistance) {
      best = n;
      bestDistance = d;
    }
  }
  return best;
}

export interface SimPosition {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

const POSITION_KEYS = ["x", "y", "vx", "vy", "fx", "fy"] as const;

/**
 * Gives `nodes` the positions they had (`previous`, by id), so a rebuild does not shuffle the drawing. A new node
 * with an already placed neighbour starts next to it; other new nodes are left for the simulation to place.
 * Returns the number of new nodes.
 */
export function carryPositions<T extends { id: string } & SimPosition>(
  previous: Map<string, SimPosition>,
  nodes: T[],
  edges: GraphEdge[],
): number {
  const fresh: T[] = [];
  for (const n of nodes) {
    const old = previous.get(n.id);
    if (old === undefined || old.x === undefined || old.y === undefined) {
      fresh.push(n);
      continue;
    }
    for (const key of POSITION_KEYS) {
      const value = old[key];
      if (value !== undefined) (n as Record<string, unknown>)[key] = value;
    }
  }
  for (const [i, n] of fresh.entries()) {
    const neighbour = edges
      .flatMap((e) => (e.a === n.id ? [e.b] : e.b === n.id ? [e.a] : []))
      .map((id) => previous.get(id))
      .find((p) => p?.x !== undefined && p.y !== undefined);
    if (neighbour === undefined) continue;
    // A fixed spread around the neighbour (golden angle), so new siblings do not start on one spot.
    const angle = (i + 1) * 2.399963;
    n.x = neighbour.x! + 30 * Math.cos(angle);
    n.y = neighbour.y! + 30 * Math.sin(angle);
  }
  return fresh.length;
}

/** The first letter of the first and of the last word, upper case; `?` for an empty name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return "?";
  const first = (w: string) => Array.from(w)[0] ?? "";
  const letters = words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
  return letters.toUpperCase();
}

/** A photo the graph may load as an image: only image data URIs and http(s) URLs. */
export function safeImageSrc(photo: string | undefined): string | undefined {
  if (photo === undefined) return undefined;
  const text = photo.trim();
  return /^data:image\/[a-z0-9.+-]+[;,]/i.test(text) || /^https?:\/\//i.test(text) ? text : undefined;
}

export interface GraphViewState {
  centre?: string;
  depth: number | "all";
  kinds: RelationKind[];
}

/** The view state from a saved (unknown) value: depth 1-4 or 'all' (default 2), known kinds (default all). */
export function normalizeGraphState(raw: unknown): GraphViewState {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const depth = DEPTH_CHOICES.includes(value.depth as number | "all") ? (value.depth as number | "all") : DEFAULT_DEPTH;
  const kinds = Array.isArray(value.kinds)
    ? GRAPH_KINDS.filter((k) => (value.kinds as unknown[]).includes(k))
    : [...GRAPH_KINDS];
  const state: GraphViewState = { depth, kinds };
  if (typeof value.centre === "string" && value.centre !== "") state.centre = value.centre;
  return state;
}
