import { describe, expect, it, vi } from "vitest";
import type { Source } from "src/settings/settings";

const bases = vi.hoisted(() => ({ held: new Map<string, Set<string>>(), notes: [] as unknown[] }));

vi.mock("src/contacts/obsidianNotes", () => ({
  contactNotes: () => bases.notes,
  contactSyncState: (sourceId: string) => ({
    get: async (uid: string) => (bases.held.get(sourceId)?.has(uid) ? { raw: "", etag: "", href: "" } : undefined),
  }),
}));

import { notesNamingSource, notesUsingSource, removeSourceState, renameSourceInNotes } from "src/contacts/sourceNotes";

const source = (id: string, name: string): Source => ({
  id, name, addressBookUrl: `http://x/${id}/`, authType: "apikey", authKey: "k", enabled: true,
});
const work = source("w", "Work");
const home = source("h", "Home");
const sources = [work, home];

type Fm = Record<string, unknown>;
function vault(notes: { path: string; fm: Fm; uid?: string; fails?: boolean }[]) {
  const files = new Map(notes.map((n) => [n.path, { path: n.path }]));
  bases.notes = notes.map((n) => ({ file: files.get(n.path), uid: n.uid }));
  const fms = new Map(notes.map((n) => [n.path, n.fm]));
  return {
    app: {
      metadataCache: { getFileCache: (f: { path: string }) => ({ frontmatter: fms.get(f.path) }) },
      fileManager: {
        processFrontMatter: async (f: { path: string }, fn: (fm: Fm) => void) => {
          if (notes.find((n) => n.path === f.path)?.fails) throw new Error("locked");
          fn(fms.get(f.path)!);
        },
      },
    } as never,
    fms,
  };
}

describe("notesUsingSource", () => {
  it("finds notes by explicit source and by base", async () => {
    bases.held = new Map([["w", new Set(["u-base"])], ["h", new Set(["u-home"])]]);
    const { app } = vault([
      { path: "a.md", fm: { source: "work" }, uid: "u1" },
      { path: "b.md", fm: {}, uid: "u-base" },
      { path: "c.md", fm: { source: "Home" }, uid: "u-base" },
      { path: "d.md", fm: {}, uid: "u-home" },
      { path: "e.md", fm: {} },
    ]);
    const found = await notesUsingSource(app, work, sources, "h");
    expect(found.map((f) => f.path)).toEqual(["a.md", "b.md"]);
  });

  it("counts a note without source and without any base for the default source", async () => {
    bases.held = new Map();
    const { app } = vault([{ path: "n.md", fm: {}, uid: "u9" }, { path: "m.md", fm: {} }]);
    expect((await notesUsingSource(app, home, sources, "h")).map((f) => f.path)).toEqual(["n.md", "m.md"]);
    expect(await notesUsingSource(app, work, sources, "h")).toEqual([]);
  });
});

describe("renameSourceInNotes", () => {
  it("rename rewrites only that source", async () => {
    const { app, fms } = vault([
      { path: "a.md", fm: { source: "Work" } },
      { path: "b.md", fm: { source: "work" } },
      { path: "c.md", fm: { source: "Home" } },
      { path: "d.md", fm: {} },
    ]);
    expect(await renameSourceInNotes(app, "Work", "Office")).toEqual({ renamed: 2, failed: [] });
    expect(fms.get("a.md")).toEqual({ source: "Office" });
    expect(fms.get("b.md")).toEqual({ source: "Office" });
    expect(fms.get("c.md")).toEqual({ source: "Home" });
    expect(fms.get("d.md")).toEqual({});
    expect(notesNamingSource(app, "Office").map((f) => f.path)).toEqual(["a.md", "b.md"]);
  });

  it("rename reports failed notes", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app, fms } = vault([
      { path: "a.md", fm: { source: "Work" }, fails: true },
      { path: "b.md", fm: { source: "Work" } },
    ]);
    expect(await renameSourceInNotes(app, "Work", "Office")).toEqual({ renamed: 1, failed: ["a.md"] });
    expect(fms.get("a.md")).toEqual({ source: "Work" });
    expect(fms.get("b.md")).toEqual({ source: "Office" });
    spy.mockRestore();
  });
});

describe("removeSourceState", () => {
  it("deletes the sync-state directory of that source only", async () => {
    const rmdir = vi.fn(async () => {});
    const exists = vi.fn(async (p: string) => p === "plugin/sync-state/w");
    const app = { vault: { adapter: { exists, rmdir } } } as never;
    await removeSourceState(app, "w", "plugin");
    expect(rmdir).toHaveBeenCalledWith("plugin/sync-state/w", true);
    await removeSourceState(app, "gone", "plugin");
    expect(rmdir).toHaveBeenCalledTimes(1);
  });
});
