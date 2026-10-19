import { describe, expect, it } from "vitest";
import { GRAPH_KINDS, kindColorVar } from "src/graph/graphColors";
import type { RelationKind } from "src/graph/graphModel";

describe("kindColorVar", () => {
  const kinds: RelationKind[] = ["partner", "family", "friends", "work", "other"];

  it("gives the theme variable of each kind", () => {
    expect(kinds.map(kindColorVar)).toEqual([
      "--color-pink",
      "--color-orange",
      "--color-green",
      "--color-blue",
      "--text-faint",
    ]);
  });

  it("gives every kind its own variable", () => {
    const vars = kinds.map(kindColorVar);
    expect(new Set(vars).size).toBe(kinds.length);
    for (const v of vars) expect(v).toMatch(/^--[a-z-]+$/);
  });

  it("lists every kind once, in pill order", () => {
    expect(GRAPH_KINDS).toEqual(kinds);
  });
});
