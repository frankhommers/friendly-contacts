import { describe, expect, it } from "vitest";

import { moveNotice, planMoves } from "src/contacts/moveContacts";

const none = () => false;

describe("planMoves", () => {
  it("keeps relative sub-folders", () => {
    const plan = planMoves(["People/Jan.md", "People/Family/Sem.md"], "People", "Areas/People", none);
    expect(plan.moves).toEqual([
      { from: "People/Jan.md", to: "Areas/People/Jan.md" },
      { from: "People/Family/Sem.md", to: "Areas/People/Family/Sem.md" },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips existing targets", () => {
    const plan = planMoves(["People/Jan.md", "People/Sem.md"], "People", "Areas/People", (p) => p === "Areas/People/Jan.md");
    expect(plan.moves).toEqual([{ from: "People/Sem.md", to: "Areas/People/Sem.md" }]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].from).toBe("People/Jan.md");
    expect(plan.skipped[0].reason).toContain("exists");
  });

  it("vault root as source", () => {
    const plan = planMoves(["Jan.md", "Family/Sem.md"], "", "People", none);
    expect(plan.moves).toEqual([
      { from: "Jan.md", to: "People/Jan.md" },
      { from: "Family/Sem.md", to: "People/Family/Sem.md" },
    ]);
  });

  it("skips sources outside the source folder", () => {
    const plan = planMoves(["Other/Jan.md", "PeopleX/Sem.md"], "People", "Areas", none);
    expect(plan.moves).toEqual([]);
    expect(plan.skipped.map((s) => s.from)).toEqual(["Other/Jan.md", "PeopleX/Sem.md"]);
  });

  it("refuses a target inside the source with contacts in it", () => {
    const plan = planMoves(["People/Jan.md", "People/Archive/Sem.md"], "People", "People/Archive", none);
    expect(plan.moves).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped.every((s) => s.reason === "target is inside the contacts folder")).toBe(true);
  });

  it("allows a target inside the source when no contact lives in it", () => {
    const plan = planMoves(["People/Jan.md"], "People", "People/Archive", none);
    expect(plan.moves).toEqual([{ from: "People/Jan.md", to: "People/Archive/Jan.md" }]);
  });

  it("allows moving out of the vault root into a sub-folder when the root has no contacts there", () => {
    const plan = planMoves(["Jan.md"], "", "People", none);
    expect(plan.moves).toEqual([{ from: "Jan.md", to: "People/Jan.md" }]);
  });
});

describe("moveNotice", () => {
  it("reports moved contacts", () => {
    expect(moveNotice(3, 0, "Areas/People")).toBe("Moved 3 contacts to Areas/People");
  });

  it("adds the skipped count", () => {
    expect(moveNotice(2, 1, "Areas/People")).toBe("Moved 2 contacts to Areas/People, skipped 1, see console");
  });

  it("says nothing moved and that the setting stays when everything was skipped", () => {
    expect(moveNotice(0, 4, "Areas/People")).toBe("No contacts moved, skipped 4, see console");
  });

  it("names the vault root", () => {
    expect(moveNotice(1, 0, "")).toBe("Moved 1 contacts to the vault root");
  });
});
