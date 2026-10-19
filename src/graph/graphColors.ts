/** Colours of the people graph: an Obsidian theme variable per relation kind. No obsidian / src/context imports. */

import type { RelationKind } from "./graphModel";

/** Every kind, in the order of the filter pills. */
export const GRAPH_KINDS: readonly RelationKind[] = ["partner", "family", "friends", "work", "other"];

const COLOR_VAR: Record<RelationKind, string> = {
  partner: "--color-pink",
  family: "--color-orange",
  friends: "--color-green",
  work: "--color-blue",
  other: "--text-faint",
};

/** The theme variable an edge of `kind` is drawn in (the renderer reads it with `getComputedStyle`). */
export function kindColorVar(kind: RelationKind): string {
  return COLOR_VAR[kind];
}
