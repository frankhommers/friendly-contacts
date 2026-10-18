import { describe, expect, it, vi } from "vitest";
import type { Source } from "src/settings/settings";

const bases = vi.hoisted(() => ({ held: new Map<string, Set<string>>(), notes: [] as unknown[] }));

vi.mock("src/contacts/obsidianNotes", () => ({
  contactNotes: () => bases.notes,
  contactSyncState: (sourceId: string) => ({
    get: async (uid: string) => (bases.held.get(sourceId)?.has(uid) ? { raw: "", etag: "", href: "" } : undefined),
  }),
}));

const store = vi.hoisted(() => ({ settings: {} as { sources: unknown[]; defaultSource: string }, order: [] as string[], forgotten: [] as string[] }));

vi.mock("src/context/sharedAppContext", () => ({ getPluginDir: () => "plugin" }));
vi.mock("src/context/sharedSettingsContext", () => ({
  getSettings: () => store.settings,
  setSettings: async (next: { sources: unknown[]; defaultSource: string }) => {
    store.order.push("setting");
    store.settings = next;
  },
}));
vi.mock("src/sync/adapters", () => ({ forgetAdapter: (id: string) => store.forgotten.push(id) }));

import {
  notesNamingSource, notesUsingSource, removeSource, removeSourceState, renameSource, renameSourceInNotes, saveSourcePatch,
} from "src/contacts/sourceNotes";

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

describe("renameSource", () => {
  it("rename writes notes before the setting", async () => {
    store.order = [];
    store.settings = { sources: [{ ...work }, { ...home }], defaultSource: "w" };
    const { app, fms } = vault([{ path: "a.md", fm: { source: "Work" } }]);
    const processFrontMatter = (app as never as { fileManager: { processFrontMatter: (...a: unknown[]) => Promise<void> } }).fileManager;
    const original = processFrontMatter.processFrontMatter;
    processFrontMatter.processFrontMatter = async (...args) => {
      store.order.push("note");
      return original(...args);
    };
    expect(await renameSource(app, "w", " Office ")).toEqual({ renamed: 1, failed: [] });
    expect(store.order).toEqual(["note", "setting"]);
    expect(fms.get("a.md")).toEqual({ source: "Office" });
    expect((store.settings.sources[0] as Source).name).toBe("Office");
  });

  it("rejects a taken name before touching any note", async () => {
    store.settings = { sources: [{ ...work }, { ...home }], defaultSource: "w" };
    const { app, fms } = vault([{ path: "a.md", fm: { source: "Work" } }]);
    await expect(renameSource(app, "w", "home")).rejects.toThrow(/already named/);
    expect(fms.get("a.md")).toEqual({ source: "Work" });
  });
});

describe("saveSourcePatch", () => {
  it("a stale patch does not revert a newer rename", async () => {
    store.settings = { sources: [{ ...work, name: "Office", enabled: false }], defaultSource: "w" };
    // The view still shows the book as "Work"; Enable only patches what it changes.
    expect(await saveSourcePatch("w", { enabled: true, authKey: "k2" })).toBe(true);
    expect(store.settings.sources[0]).toMatchObject({ id: "w", name: "Office", enabled: true, authKey: "k2" });
  });

  it("does nothing for a source that was removed", async () => {
    store.settings = { sources: [], defaultSource: "" };
    expect(await saveSourcePatch("w", { enabled: true })).toBe(false);
  });
});

describe("removeSource", () => {
  const appWithDirs = (dirs: string[], removed: string[]) => ({
    vault: {
      adapter: {
        exists: async (p: string) => dirs.includes(p),
        rmdir: async (p: string) => { removed.push(p); },
      },
    },
    metadataCache: { getFileCache: (f: { path: string }) => ({ frontmatter: fmOf.get(f.path) }) },
    fileManager: {},
  }) as never;
  const fmOf = new Map<string, Fm>();

  it("remove is refused for the default and for books in use", async () => {
    store.settings = { sources: [{ ...work }, { ...home }], defaultSource: "w" };
    store.forgotten = [];
    bases.held = new Map();
    bases.notes = [];
    const removed: string[] = [];
    const app = appWithDirs(["plugin/sync-state/w", "plugin/sync-state/h"], removed);
    expect(await removeSource(app, "w")).toEqual({ refused: "Make another address book the default first." });
    bases.notes = [{ file: { path: "a.md" }, uid: undefined }];
    fmOf.set("a.md", { source: "Home" });
    expect(await removeSource(app, "h")).toEqual({ refused: "1 contacts use Home." });
    expect(store.settings.sources).toHaveLength(2);
    expect(removed).toEqual([]);
    expect(store.forgotten).toEqual([]);
  });

  it("remove deletes only that book's state dir", async () => {
    store.settings = { sources: [{ ...work }, { ...home }], defaultSource: "w" };
    store.forgotten = [];
    bases.held = new Map();
    bases.notes = [];
    const removed: string[] = [];
    const app = appWithDirs(["plugin/sync-state/w", "plugin/sync-state/h"], removed);
    expect(await removeSource(app, "h")).toEqual({ removed: true });
    expect(removed).toEqual(["plugin/sync-state/h"]);
    expect(store.forgotten).toEqual(["h"]);
    expect((store.settings.sources as Source[]).map((s) => s.id)).toEqual(["w"]);
  });
});
