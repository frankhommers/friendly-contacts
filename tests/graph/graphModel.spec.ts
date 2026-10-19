import { DEFAULT_MAPPING, renameRow } from "src/contacts/friendly/mapping";
import {
  buildGraph,
  ghostName,
  ghostTarget,
  GraphContact,
  lodTier,
  neighbourhood,
  relationKind,
  RelationKind,
} from "src/graph/graphModel";
import { RelationRow } from "src/contacts/friendly/mapping";
import { describe, expect, it } from "vitest";

const contact = (
  id: string,
  snapshot: GraphContact["snapshot"] = {},
): GraphContact => ({
  id,
  name: id.replace(/\.md$/, ""),
  snapshot,
});
const ALL = new Set<RelationKind>([
  "partner",
  "family",
  "friends",
  "work",
  "other",
]);
const rowFor = (property: string) =>
  DEFAULT_MAPPING.find(
    (r) => r.kind === "relation" && r.property === property,
  ) as RelationRow;
const ids = (g: { nodes: { id: string }[] }) => g.nodes.map((n) => n.id).sort();

describe("buildGraph", () => {
  it("mirrored pair is one edge", () => {
    const g = buildGraph(
      [
        contact("Jan.md", { children: ["Sem.md"] }),
        contact("Sem.md", { parents: ["Jan.md"] }),
      ],
      DEFAULT_MAPPING,
    );
    expect(g.edges).toEqual([
      {
        a: "Jan.md",
        b: "Sem.md",
        kind: "family",
        labelFromA: "child",
        labelFromB: "parent",
      },
    ]);
    expect(g.nodes.map((n) => n.ghost)).toEqual([false, false]);
  });

  it("mirrored pair is one edge whichever side comes first", () => {
    const g = buildGraph(
      [
        contact("Sem.md", { parents: ["Jan.md"] }),
        contact("Jan.md", { children: ["Sem.md"] }),
      ],
      DEFAULT_MAPPING,
    );
    expect(g.edges).toEqual([
      {
        a: "Sem.md",
        b: "Jan.md",
        kind: "family",
        labelFromA: "parent",
        labelFromB: "child",
      },
    ]);
  });

  it("a symmetric relation listed on both sides is one edge", () => {
    const g = buildGraph(
      [
        contact("A.md", { friends: ["B.md"] }),
        contact("B.md", { friends: ["A.md"] }),
      ],
      DEFAULT_MAPPING,
    );
    expect(g.edges).toEqual([
      {
        a: "A.md",
        b: "B.md",
        kind: "friends",
        labelFromA: "friend",
        labelFromB: "friend",
      },
    ]);
  });

  it("one-sided relation is an edge, labelled from B by the mirror's type", () => {
    const g = buildGraph(
      [contact("Jan.md", { children: ["Sem.md"] }), contact("Sem.md")],
      DEFAULT_MAPPING,
    );
    // Centred on Sem the edge must say "parent" (Jan is Sem's parent), never "child".
    expect(g.edges).toEqual([
      {
        a: "Jan.md",
        b: "Sem.md",
        kind: "family",
        labelFromA: "child",
        labelFromB: "parent",
      },
    ]);
  });

  it("a ghost two contacts link to gets the mirror's type from its side", () => {
    const g = buildGraph(
      [
        contact("A.md", { children: ["Piet"] }),
        contact("B.md", { colleagues: ["Piet"] }),
      ],
      DEFAULT_MAPPING,
    );
    expect(g.edges).toEqual([
      {
        a: "A.md",
        b: "ghost:Piet",
        kind: "family",
        labelFromA: "child",
        labelFromB: "parent",
      },
      {
        a: "B.md",
        b: "ghost:Piet",
        kind: "work",
        labelFromA: "colleague",
        labelFromB: "colleague",
      },
    ]);
  });

  it("a relation without a mirror has no label from B", () => {
    const g = buildGraph(
      [contact("Jan.md", { emergency: ["Piet.md"] }), contact("Piet.md")],
      DEFAULT_MAPPING,
    );
    expect(g.edges).toEqual([
      { a: "Jan.md", b: "Piet.md", kind: "other", labelFromA: "emergency" },
    ]);
  });

  it("a contradiction (both say the other is their child) is two edges", () => {
    const g = buildGraph(
      [
        contact("Jan.md", { children: ["Sem.md"] }),
        contact("Sem.md", { children: ["Jan.md"] }),
      ],
      DEFAULT_MAPPING,
    );
    expect(g.edges).toEqual([
      {
        a: "Jan.md",
        b: "Sem.md",
        kind: "family",
        labelFromA: "child",
        labelFromB: "parent",
      },
      {
        a: "Sem.md",
        b: "Jan.md",
        kind: "family",
        labelFromA: "child",
        labelFromB: "parent",
      },
    ]);
  });

  it("a relation without a mirror listed on both sides is two edges", () => {
    const g = buildGraph(
      [
        contact("Jan.md", { emergency: ["Piet.md"] }),
        contact("Piet.md", { emergency: ["Jan.md"] }),
      ],
      DEFAULT_MAPPING,
    );
    expect(g.edges.map((e) => [e.a, e.b])).toEqual([
      ["Jan.md", "Piet.md"],
      ["Piet.md", "Jan.md"],
    ]);
  });

  it("different kinds between the same pair are two edges", () => {
    const g = buildGraph(
      [
        contact("A.md", { colleagues: ["B.md"], friends: ["B.md"] }),
        contact("B.md"),
      ],
      DEFAULT_MAPPING,
    );
    expect(g.edges.map((e) => e.kind).sort()).toEqual(["friends", "work"]);
  });

  it("unresolved link becomes a ghost", () => {
    const g = buildGraph(
      [
        contact("A.md", { friends: ["Piet"] }),
        contact("B.md", { colleagues: ["Piet"] }),
        contact("Piet.md"),
      ],
      DEFAULT_MAPPING,
    );
    const ghosts = g.nodes.filter((n) => n.ghost);
    expect(ghosts).toEqual([{ id: "ghost:Piet", name: "Piet", ghost: true }]);
    expect(g.nodes.find((n) => n.id === "Piet.md")?.ghost).toBe(false);
    expect(g.edges.map((e) => [e.a, e.b]).sort()).toEqual([
      ["A.md", "ghost:Piet"],
      ["B.md", "ghost:Piet"],
    ]);
  });

  it("names a ghost by the link's alias, else by the last part of its path", () => {
    const g = buildGraph(
      [
        {
          ...contact("A.md", {
            friends: ["Contacts/Jan/index", "Contacts/Piet/index", "Lot", "constructor"],
          }),
          aliases: new Map([["Contacts/Jan/index", "Jan de Vries"]]),
        },
      ],
      DEFAULT_MAPPING,
    );
    expect(g.nodes.filter((n) => n.ghost)).toEqual([
      { id: "ghost:Contacts/Jan/index", name: "Jan de Vries", ghost: true },
      { id: "ghost:Contacts/Piet/index", name: "index", ghost: true },
      { id: "ghost:Lot", name: "Lot", ghost: true },
      { id: "ghost:constructor", name: "constructor", ghost: true },
    ]);
    expect(ghostTarget("ghost:Contacts/Jan/index")).toBe("Contacts/Jan/index");
    expect(ghostTarget("Contacts/Jan.md")).toBeUndefined();
  });

  it("keeps the photo on the node", () => {
    const g = buildGraph(
      [{ id: "A.md", name: "A", photo: "p.jpg", snapshot: {} }],
      DEFAULT_MAPPING,
    );
    expect(g.nodes[0]).toEqual({
      id: "A.md",
      name: "A",
      photo: "p.jpg",
      ghost: false,
    });
  });

  it("ignores a relation to itself and properties that are not relations", () => {
    const g = buildGraph(
      [
        contact("A.md", { friends: ["A.md"], nothing: ["B.md"] }),
        contact("B.md"),
      ],
      DEFAULT_MAPPING,
    );
    expect(g.edges).toEqual([]);
  });

  it("kind follows the vcard type, not the property", () => {
    const rows = renameRow(DEFAULT_MAPPING, "children", "kids");
    const g = buildGraph(
      [
        contact("Jan.md", { kids: ["Sem.md"] }),
        contact("Sem.md", { parents: ["Jan.md"] }),
      ],
      rows,
    );
    expect(g.edges).toEqual([
      {
        a: "Jan.md",
        b: "Sem.md",
        kind: "family",
        labelFromA: "child",
        labelFromB: "parent",
      },
    ]);
  });
});

describe("relationKind", () => {
  it("spouse is partner, friend is friends, colleague is work, neighbor is other", () => {
    expect(relationKind(rowFor("spouse"))).toBe("partner");
    expect(relationKind(rowFor("partner"))).toBe("partner");
    expect(relationKind(rowFor("friends"))).toBe("friends");
    expect(relationKind(rowFor("colleagues"))).toBe("work");
    expect(relationKind(rowFor("neighbours"))).toBe("other");
    for (const p of ["children", "parents", "siblings", "family"])
      expect(relationKind(rowFor(p))).toBe("family");
    for (const p of ["housemates", "acquaintances", "met", "emergency"])
      expect(relationKind(rowFor(p))).toBe("other");
  });

  it("maps co-worker to work", () => {
    expect(
      relationKind({ ...rowFor("colleagues"), types: ["co-worker"] }),
    ).toBe("work");
  });
});

describe("neighbourhood", () => {
  const chain = () =>
    buildGraph(
      [
        contact("A.md", { friends: ["B.md"] }),
        contact("B.md", { friends: ["C.md"] }),
        contact("C.md", { friends: ["D.md"] }),
        contact("D.md"),
      ],
      DEFAULT_MAPPING,
    );

  it("depth 1 and 2 from a centre", () => {
    const g = chain();
    const one = neighbourhood(g, "A.md", 1, ALL) as {
      graph: ReturnType<typeof buildGraph>;
    };
    expect(ids(one.graph)).toEqual(["A.md", "B.md"]);
    expect(one.graph.edges).toHaveLength(1);
    const two = neighbourhood(g, "A.md", 2, ALL) as {
      graph: ReturnType<typeof buildGraph>;
    };
    expect(ids(two.graph)).toEqual(["A.md", "B.md", "C.md"]);
    expect(two.graph.edges).toHaveLength(2);
  });

  it("walks edges in both directions", () => {
    const r = neighbourhood(chain(), "C.md", 1, ALL) as {
      graph: ReturnType<typeof buildGraph>;
    };
    expect(ids(r.graph)).toEqual(["B.md", "C.md", "D.md"]);
  });

  it("no centre or depth all is the whole graph", () => {
    const g = chain();
    expect(neighbourhood(g, undefined, 1, ALL)).toEqual({ graph: g });
    expect(neighbourhood(g, "A.md", "all", ALL)).toEqual({ graph: g });
  });

  it("the whole graph leaves out people without a relationship, except the centre", () => {
    const g = buildGraph(
      [
        contact("A.md", { friends: ["B.md"] }),
        contact("B.md", { colleagues: ["C.md"] }),
        contact("C.md"),
        contact("Alone.md"),
      ],
      DEFAULT_MAPPING,
    );
    const whole = neighbourhood(g, undefined, 1, ALL) as {
      graph: ReturnType<typeof buildGraph>;
    };
    expect(ids(whole.graph)).toEqual(["A.md", "B.md", "C.md"]);
    // C has only a work relation: with work filtered out it is alone too.
    const friends = neighbourhood(
      g,
      undefined,
      "all",
      new Set<RelationKind>(["friends"]),
    ) as { graph: ReturnType<typeof buildGraph> };
    expect(ids(friends.graph)).toEqual(["A.md", "B.md"]);
    const centred = neighbourhood(g, "Alone.md", "all", ALL) as {
      graph: ReturnType<typeof buildGraph>;
    };
    expect(ids(centred.graph)).toEqual(["A.md", "Alone.md", "B.md", "C.md"]);
  });

  it("people without a relationship do not count towards too many", () => {
    const contacts = [
      contact("A.md", { friends: ["B.md"] }),
      contact("B.md"),
      ...Array.from({ length: 600 }, (_, i) => contact(`Alone${i}.md`)),
    ];
    const r = neighbourhood(buildGraph(contacts, DEFAULT_MAPPING), undefined, "all", ALL) as {
      graph: ReturnType<typeof buildGraph>;
    };
    expect(ids(r.graph)).toEqual(["A.md", "B.md"]);
  });

  it("filtered kinds break paths", () => {
    const g = buildGraph(
      [
        contact("A.md", { friends: ["B.md"] }),
        contact("B.md", { colleagues: ["C.md"] }),
        contact("C.md"),
      ],
      DEFAULT_MAPPING,
    );
    const r = neighbourhood(
      g,
      "A.md",
      3,
      new Set<RelationKind>(["friends"]),
    ) as {
      graph: ReturnType<typeof buildGraph>;
    };
    expect(ids(r.graph)).toEqual(["A.md", "B.md"]);
    const whole = neighbourhood(
      g,
      undefined,
      "all",
      new Set<RelationKind>(["friends"]),
    ) as {
      graph: ReturnType<typeof buildGraph>;
    };
    expect(whole.graph.edges.map((e) => e.kind)).toEqual(["friends"]);
  });

  it("more than 500 nodes is too many", () => {
    const contacts = Array.from({ length: 501 }, (_, i) =>
      contact(`P${i}.md`, i < 500 ? { friends: [`P${i + 1}.md`] } : {}),
    );
    const g = buildGraph(contacts, DEFAULT_MAPPING);
    expect(neighbourhood(g, undefined, "all", ALL)).toEqual({ tooMany: 501 });
    expect(neighbourhood(g, "P0.md", "all", ALL)).toEqual({ tooMany: 501 });
    expect("graph" in neighbourhood(g, "P0.md", 2, ALL)).toBe(true);
    // 499 notes + 1 ghost = 500 nodes, still fine
    expect(
      "graph" in
        neighbourhood(
          buildGraph(contacts.slice(0, 499), DEFAULT_MAPPING),
          undefined,
          "all",
          ALL,
        ),
    ).toBe(true);
  });

  it("an unknown centre gives an empty graph", () => {
    expect(neighbourhood(chain(), "Nope.md", 2, ALL)).toEqual({
      graph: { nodes: [], edges: [] },
    });
  });
});

describe("ghostName", () => {
  it("is the alias, else the last part of the path without .md", () => {
    expect(ghostName("Contacts/Jan/index", " Jan ")).toBe("Jan");
    expect(ghostName("Contacts/Jan/index", "  ")).toBe("index");
    expect(ghostName("Contacts/Sem de Vries.md", undefined)).toBe("Sem de Vries");
    expect(ghostName("Piet", undefined)).toBe("Piet");
    expect(ghostName("Contacts/", undefined)).toBe("Contacts/");
  });
});

describe("lodTier", () => {
  it("lod tiers at 0.59, 0.6, 1.19, 1.2", () => {
    expect(lodTier(0.59)).toBe("dots");
    expect(lodTier(0.6)).toBe("names");
    expect(lodTier(1.19)).toBe("names");
    expect(lodTier(1.2)).toBe("photos");
  });
});
