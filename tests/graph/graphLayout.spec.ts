import { describe, expect, it } from "vitest";
import {
  carryPositions,
  edgeLabel,
  hitTest,
  hopDistances,
  initials,
  normalizeGraphState,
  parallelOffsets,
  safeImageSrc,
} from "src/graph/graphLayout";
import type { Graph, GraphEdge } from "src/graph/graphModel";

const node = (id: string, ghost = false) => ({ id, name: id, ghost });
const edge = (a: string, b: string, labelFromA: string, labelFromB?: string, kind: GraphEdge["kind"] = "family"): GraphEdge =>
  labelFromB === undefined ? { a, b, kind, labelFromA } : { a, b, kind, labelFromA, labelFromB };

describe("hopDistances", () => {
  const graph: Graph = {
    nodes: [node("jan"), node("sem"), node("lot"), node("far")],
    edges: [edge("jan", "sem", "child"), edge("lot", "sem", "friend")],
  };

  it("counts steps from the centre, unreachable nodes are absent", () => {
    const d = hopDistances(graph, "jan");
    expect([...d.entries()].sort()).toEqual([["jan", 0], ["lot", 2], ["sem", 1]]);
  });

  it("is empty without a centre", () => {
    expect(hopDistances(graph, undefined).size).toBe(0);
  });
});

describe("edgeLabel", () => {
  const e = edge("jan", "sem", "child", "parent");

  it("uses A's label when A is nearer the centre", () => {
    expect(edgeLabel(e, new Map([["jan", 0], ["sem", 1]]))).toBe("child");
  });

  it("uses B's label when B is nearer the centre", () => {
    expect(edgeLabel(e, new Map([["jan", 1], ["sem", 0]]))).toBe("parent");
  });

  it("uses A's label on a tie or without a centre", () => {
    expect(edgeLabel(e, new Map([["jan", 2], ["sem", 2]]))).toBe("child");
    expect(edgeLabel(e, new Map())).toBe("child");
  });

  it("treats an unreachable end as farthest", () => {
    expect(edgeLabel(e, new Map([["sem", 3]]))).toBe("parent");
  });

  it("falls back to A's label when B's side is unknown (one-sided relation)", () => {
    expect(edgeLabel(edge("jan", "sem", "child"), new Map([["jan", 1], ["sem", 0]]))).toBe("child");
  });
});

describe("parallelOffsets", () => {
  it("is 0 for a single edge between two people", () => {
    expect(parallelOffsets([edge("a", "b", "x")])).toEqual([0]);
  });

  it("spreads edges of the same pair around 0, whatever their direction", () => {
    expect(parallelOffsets([edge("a", "b", "x"), edge("b", "a", "y"), edge("a", "c", "z")])).toEqual([-0.5, 0.5, 0]);
    expect(parallelOffsets([edge("a", "b", "x"), edge("a", "b", "y"), edge("b", "a", "z")])).toEqual([-1, 0, 1]);
  });

  it("gives the second edge of a reversed pair the opposite side as seen from a to b", () => {
    // Offsets are relative to the line from the pair's first id (sorted) to its second, so both edges never overlap.
    const [first, second] = parallelOffsets([edge("b", "a", "x"), edge("a", "b", "y")]);
    expect(first).not.toBe(second);
  });
});

describe("hitTest", () => {
  const nodes = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 10, y: 0 },
    { id: "c", x: 100, y: 100 },
    { id: "nowhere" },
  ];

  it("finds the nearest node within the radius", () => {
    expect(hitTest(nodes, 7, 0, 6)?.id).toBe("b");
    expect(hitTest(nodes, 2, 1, 6)?.id).toBe("a");
  });

  it("finds nothing outside every radius", () => {
    expect(hitTest(nodes, 50, 50, 6)).toBeUndefined();
  });

  it("accepts a radius per node", () => {
    expect(hitTest(nodes, 85, 100, (n) => (n.id === "c" ? 20 : 6))?.id).toBe("c");
  });
});

describe("carryPositions", () => {
  it("keeps the position, speed and pin of nodes that stay", () => {
    const previous = new Map([["a", { x: 5, y: 6, vx: 1, vy: 2, fx: 5, fy: 6 }]]);
    const nodes: { id: string; x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null }[] = [
      { id: "a" },
    ];
    carryPositions(previous, nodes, []);
    expect(nodes[0]).toEqual({ id: "a", x: 5, y: 6, vx: 1, vy: 2, fx: 5, fy: 6 });
  });

  it("places a new node next to a neighbour that was already drawn", () => {
    const previous = new Map([["a", { x: 100, y: -40 }]]);
    const nodes: { id: string; x?: number; y?: number }[] = [{ id: "a" }, { id: "new" }];
    const added = carryPositions(previous, nodes, [edge("new", "a", "friend")]);
    expect(added).toBe(1);
    expect(Math.hypot(nodes[1].x! - 100, nodes[1].y! + 40)).toBeGreaterThan(0);
    expect(Math.hypot(nodes[1].x! - 100, nodes[1].y! + 40)).toBeLessThan(60);
  });

  it("leaves a new node without a drawn neighbour to the simulation", () => {
    const nodes: { id: string; x?: number; y?: number }[] = [{ id: "lonely" }];
    expect(carryPositions(new Map(), nodes, [])).toBe(1);
    expect(nodes[0].x).toBeUndefined();
  });
});

describe("initials", () => {
  it("takes the first letters of the first and last word", () => {
    expect(initials("Jan de Vries")).toBe("JV");
    expect(initials("  sem ")).toBe("S");
    expect(initials("Émile Zola")).toBe("ÉZ");
  });

  it("keeps a letter outside the basic plane whole", () => {
    expect(initials("𝒜da Lovelace")).toBe("𝒜L");
  });

  it("is ? for an empty name", () => {
    expect(initials("   ")).toBe("?");
  });
});

describe("safeImageSrc", () => {
  it("passes image data URIs and http(s) URLs", () => {
    expect(safeImageSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(safeImageSrc("https://example.org/a.jpg")).toBe("https://example.org/a.jpg");
    expect(safeImageSrc("HTTP://example.org/a.jpg")).toBe("HTTP://example.org/a.jpg");
  });

  it("refuses anything else", () => {
    expect(safeImageSrc(undefined)).toBeUndefined();
    expect(safeImageSrc("data:text/html;base64,PHNjcmlwdD4=")).toBeUndefined();
    expect(safeImageSrc("javascript:alert(1)")).toBeUndefined();
    expect(safeImageSrc("app://local/photo.jpg")).toBeUndefined();
  });
});

describe("normalizeGraphState", () => {
  const all = ["partner", "family", "friends", "work", "other"];

  it("defaults to depth 2 and every kind", () => {
    expect(normalizeGraphState(undefined)).toEqual({ depth: 2, kinds: all });
    expect(normalizeGraphState({})).toEqual({ depth: 2, kinds: all });
  });

  it("keeps a valid state", () => {
    expect(normalizeGraphState({ centre: "People/Jan.md", depth: "all", kinds: ["work", "partner"] })).toEqual({
      centre: "People/Jan.md",
      depth: "all",
      kinds: ["partner", "work"],
    });
    expect(normalizeGraphState({ depth: 4, kinds: [] })).toEqual({ depth: 4, kinds: [] });
  });

  it("drops what it does not know", () => {
    expect(normalizeGraphState({ centre: 3, depth: 7, kinds: ["work", "enemies", "work"] })).toEqual({
      depth: 2,
      kinds: ["work"],
    });
    expect(normalizeGraphState({ centre: "", depth: "2", kinds: "work" })).toEqual({ depth: 2, kinds: all });
  });
});
