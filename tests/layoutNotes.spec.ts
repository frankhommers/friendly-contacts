import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LayoutSettings } from "src/contacts/layout";

/** A small in-memory vault: folders and notes as TFolder/TFile, renames move whole sub-trees. */
const h = vi.hoisted(() => {
  class TAbstractFile {
    parent: TFolder | null = null;
    constructor(public path: string) {}
    get name(): string {
      return this.path.slice(this.path.lastIndexOf("/") + 1);
    }
  }
  class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];
    isRoot(): boolean {
      return this.path === "";
    }
  }
  class TFile extends TAbstractFile {
    content = "";
    frontmatter: Record<string, unknown> | undefined;
    get basename(): string {
      return this.name.replace(/\.md$/, "");
    }
    get extension(): string {
      return "md";
    }
  }
  return {
    TAbstractFile,
    TFolder,
    TFile,
    notices: [] as string[],
    choice: "replace" as "replace" | "skip",
    dialogs: [] as string[],
    settings: {} as Record<string, unknown>,
  };
});

vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    Notice: class {
      constructor(message: string) {
        h.notices.push(message);
      }
    },
    TAbstractFile: h.TAbstractFile,
    TFolder: h.TFolder,
    TFile: h.TFile,
  };
});

vi.mock("src/ui/modals/fileExistsModal", () => ({
  FileExistsModal: class {
    constructor(_app: unknown, private path: string, private callback: (action: "replace" | "skip") => void) {}
    open() {
      h.dialogs.push(this.path);
      setTimeout(() => this.callback(h.choice), 5);
    }
  },
}));

vi.mock("src/sync/adapters", () => ({ activeSources: () => [], adapterFor: () => ({}) }));
vi.mock("src/context/sharedAppContext", () => ({ getApp: () => ({}), getPluginDir: () => "plugin" }));
vi.mock("src/context/sharedSettingsContext", () => ({
  getSettings: () => h.settings,
  updateSetting: async () => {},
}));

import { DEFAULT_SETTINGS } from "src/settings/setting";
import { createContactFile } from "src/file/file";
import { newContactLocation, renameContact, resetLayoutWarning, runSteps } from "src/contacts/layoutNotes";
import { noteIO } from "src/contacts/obsidianNotes";

type Folder = InstanceType<typeof h.TFolder>;
type File = InstanceType<typeof h.TFile>;
type Node = InstanceType<typeof h.TAbstractFile>;

const CONTACT = { name: "x", uid: "u" };

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function fakeApp() {
  const nodes = new Map<string, Node>();
  const root = new h.TFolder("");
  nodes.set("", root);
  let active: File | null = null;
  /** Runs after each renameFile, like a plugin reacting to the rename (Folder Notes' syncFolderName). */
  let afterRename: ((node: Node, oldPath: string) => Promise<void>) | undefined;

  const parentOf = (path: string): Folder => {
    const parent = nodes.get(dirname(path));
    if (!(parent instanceof h.TFolder)) throw new Error(`no folder for ${path}`);
    return parent;
  };
  const attach = (node: Node) => {
    const parent = parentOf(node.path);
    node.parent = parent;
    parent.children.push(node);
    nodes.set(node.path, node);
  };
  const folder = (path: string): Folder => {
    const existing = nodes.get(path);
    if (existing instanceof h.TFolder) return existing;
    if (dirname(path) !== path && !nodes.has(dirname(path))) folder(dirname(path));
    const created = new h.TFolder(path);
    attach(created);
    return created;
  };
  /** `null` frontmatter: a file that is no contact (a poem, a photo). */
  const note = (path: string, frontmatter: Record<string, unknown> | null = CONTACT, content = "note"): File => {
    folder(dirname(path));
    const file = new h.TFile(path);
    file.frontmatter = frontmatter ?? undefined;
    file.content = content;
    attach(file);
    return file;
  };
  const move = (node: Node, to: string) => {
    if (nodes.has(to) && nodes.get(to) !== node) throw new Error(`exists: ${to}`);
    const from = node.path;
    const parent = node.parent as Folder;
    parent.children = parent.children.filter((c) => c !== node);
    const moved = [...nodes.entries()].filter(([p]) => p === from || p.startsWith(`${from}/`));
    for (const [p] of moved) nodes.delete(p);
    for (const [p, n] of moved) {
      n.path = to + p.slice(from.length);
      nodes.set(n.path, n);
    }
    attach2(node);
  };
  const attach2 = (node: Node) => {
    const parent = parentOf(node.path);
    node.parent = parent;
    parent.children.push(node);
  };

  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => nodes.get(p === "/" ? "" : p) ?? null,
      getRoot: () => root,
      createFolder: async (p: string) => {
        if (nodes.has(p)) throw new Error("Folder already exists.");
        parentOf(p);
        const created = new h.TFolder(p);
        attach(created);
        return created;
      },
      delete: async (node: Node) => {
        if (node instanceof h.TFolder && node.children.length > 0) throw new Error("not empty");
        (node.parent as Folder).children = (node.parent as Folder).children.filter((c) => c !== node);
        nodes.delete(node.path);
      },
      read: async (file: File) => file.content,
      adapter: {
        exists: async (p: string) => nodes.has(p),
        read: async (p: string) => (nodes.get(p) as File).content,
        write: async (p: string, data: string) => {
          const existing = nodes.get(p);
          if (existing instanceof h.TFile) existing.content = data;
          else note(p, CONTACT, data);
        },
      },
    },
    fileManager: {
      renameFile: async (node: Node, to: string) => {
        const from = node.path;
        move(node, to);
        await afterRename?.(node, from);
      },
    },
    metadataCache: {
      getFileCache: (file: File) => (file.frontmatter ? { frontmatter: file.frontmatter } : null),
      getFirstLinkpathDest: () => null,
      fileToLinktext: () => "",
    },
    workspace: {
      getActiveFile: () => active,
      getLeaf: () => ({ openFile: async () => {} }),
    },
  };
  return {
    app: app as never,
    renameFile: app.fileManager.renameFile,
    nodes,
    folder,
    note,
    paths: () => [...nodes.keys()].filter((p) => p !== "").sort(),
    setActive: (file: File | null) => {
      active = file;
    },
    onRename: (fn: typeof afterRename) => {
      afterRename = fn;
    },
  };
}

const inside: LayoutSettings = { layout: "folder", noteName: "{{name}}", location: "inside" };
const insideIndex: LayoutSettings = { layout: "folder", noteName: "index", location: "inside" };
const next: LayoutSettings = { layout: "folder", noteName: "{{name}}", location: "next" };

function useLayout(layout: LayoutSettings) {
  h.settings = { ...DEFAULT_SETTINGS, contactsFolder: "Contacts", layout };
}

beforeEach(() => {
  h.notices.length = 0;
  h.dialogs.length = 0;
  h.choice = "replace";
  useLayout(DEFAULT_SETTINGS.layout);
  resetLayoutWarning();
});

describe("new contacts", () => {
  it("new contact in folder layout gets folder and note", async () => {
    useLayout(inside);
    const v = fakeApp();
    v.folder("Contacts");
    expect(newContactLocation(v.app, "Jan de Vries")).toEqual({
      folder: "Contacts/Jan de Vries",
      note: "Contacts/Jan de Vries/Jan de Vries.md",
    });
    const path = await createContactFile(v.app, "Contacts", "---\nname: Jan\n---\n", "Jan de Vries.md");
    expect(path).toBe("Contacts/Jan de Vries/Jan de Vries.md");
    expect(v.nodes.get("Contacts/Jan de Vries")).toBeInstanceOf(h.TFolder);
    expect((v.nodes.get(path as string) as File).content).toBe("---\nname: Jan\n---\n");

    useLayout(insideIndex);
    expect(newContactLocation(v.app, "Sem")).toEqual({ folder: "Contacts/Sem", note: "Contacts/Sem/index.md" });
    useLayout(next);
    expect(newContactLocation(v.app, "Sem")).toEqual({ folder: "Contacts/Sem", note: "Contacts/Sem.md" });
  });

  it("one-note layout keeps creating next to the active note in the contacts folder", async () => {
    const v = fakeApp();
    v.folder("Contacts");
    v.setActive(v.note("Contacts/Family/Sem.md"));
    expect(newContactLocation(v.app, "Jan")).toEqual({ note: "Contacts/Family/Jan.md" });
    v.setActive(v.note("Elsewhere/Todo.md", null));
    expect(newContactLocation(v.app, "Jan")).toEqual({ note: "Contacts/Jan.md" });
    expect(await createContactFile(v.app, "Contacts", "c", "Jan.md")).toBe("Contacts/Jan.md");
  });

  it("not inside another contact's folder", () => {
    useLayout(inside);
    const v = fakeApp();
    const sem = v.note("Contacts/Family/Sem/Sem.md");
    const poem = v.note("Contacts/Family/Sem/Poems/Poem.md", null);
    const family = v.note("Contacts/Family/Notes.md", null);

    v.setActive(sem);
    expect(newContactLocation(v.app, "Jan")).toEqual({ folder: "Contacts/Family/Jan", note: "Contacts/Family/Jan/Jan.md" });
    v.setActive(poem);
    expect(newContactLocation(v.app, "Jan").folder).toBe("Contacts/Family/Jan");
    v.setActive(family);
    expect(newContactLocation(v.app, "Jan").folder).toBe("Contacts/Family/Jan");

    useLayout(next);
    const anna = v.note("Contacts/Anna.md");
    v.folder("Contacts/Anna");
    v.setActive(v.note("Contacts/Anna/Speech.md", null));
    expect(newContactLocation(v.app, "Jan")).toEqual({ folder: "Contacts/Jan", note: "Contacts/Jan.md" });
    v.setActive(anna);
    expect(newContactLocation(v.app, "Jan").folder).toBe("Contacts/Jan");
  });

  it("existing empty folder is reused", async () => {
    useLayout(inside);
    const v = fakeApp();
    v.folder("Contacts/Jan");
    v.note("Contacts/Jan/Poem.md", null, "roses");
    const path = await createContactFile(v.app, "Contacts", "contact", "Jan.md");
    expect(path).toBe("Contacts/Jan/Jan.md");
    expect(h.dialogs).toEqual([]);
    expect((v.nodes.get("Contacts/Jan/Jan.md") as File).content).toBe("contact");
    expect((v.nodes.get("Contacts/Jan/Poem.md") as File).content).toBe("roses");
  });

  it("an existing contact note in the folder goes through Replace/Skip", async () => {
    useLayout(inside);
    const v = fakeApp();
    v.note("Contacts/Jan/Jan.md", CONTACT, "old");
    h.choice = "skip";
    await createContactFile(v.app, "Contacts", "new", "Jan.md");
    expect(h.dialogs).toEqual(["Contacts/Jan/Jan.md"]);
    expect((v.nodes.get("Contacts/Jan/Jan.md") as File).content).toBe("old");
    h.choice = "replace";
    await createContactFile(v.app, "Contacts", "new", "Jan.md");
    expect((v.nodes.get("Contacts/Jan/Jan.md") as File).content).toBe("new");
  });

  it("a skipped note next to its folder creates no folder", async () => {
    useLayout(next);
    const v = fakeApp();
    v.note("Contacts/Jan.md", CONTACT, "old");
    h.choice = "skip";
    await createContactFile(v.app, "Contacts", "new", "Jan.md");
    expect(v.nodes.has("Contacts/Jan")).toBe(false);
    h.choice = "replace";
    await createContactFile(v.app, "Contacts", "new", "Jan.md");
    expect(v.nodes.get("Contacts/Jan")).toBeInstanceOf(h.TFolder);
  });

  it("an invalid stored layout is used as one note per contact, with one Notice", () => {
    useLayout({ layout: "folder", noteName: "", location: "inside" });
    const v = fakeApp();
    v.folder("Contacts");
    expect(newContactLocation(v.app, "Jan")).toEqual({ note: "Contacts/Jan.md" });
    expect(newContactLocation(v.app, "Sem")).toEqual({ note: "Contacts/Sem.md" });
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toContain("folder note name is empty");
  });
});

describe("rename", () => {
  it("rename in folder layout renames folder and note", async () => {
    useLayout(inside);
    const v = fakeApp();
    const jan = v.note("Contacts/Jan/Jan.md");
    v.note("Contacts/Jan/Poem.md", null, "roses");
    expect(await noteIO(v.app, jan as never).rename("Jan Bakker")).toBe("renamed");
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan Bakker", "Contacts/Jan Bakker/Jan Bakker.md", "Contacts/Jan Bakker/Poem.md"]);
    expect(jan.path).toBe("Contacts/Jan Bakker/Jan Bakker.md");
  });

  it("a fixed note name renames only the folder", async () => {
    useLayout(insideIndex);
    const v = fakeApp();
    const jan = v.note("Contacts/Jan/index.md");
    expect(await renameContact(v.app, jan as never, "Jan Bakker")).toBe("renamed");
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan Bakker", "Contacts/Jan Bakker/index.md"]);
  });

  it("next to: renames folder and note", async () => {
    useLayout(next);
    const v = fakeApp();
    const jan = v.note("Contacts/Jan.md");
    v.note("Contacts/Jan/Photo.md", null);
    expect(await renameContact(v.app, jan as never, "Jan Bakker")).toBe("renamed");
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan Bakker", "Contacts/Jan Bakker.md", "Contacts/Jan Bakker/Photo.md"]);
  });

  it("works when another plugin renames the note after the folder (Folder Notes)", async () => {
    useLayout(inside);
    const v = fakeApp();
    const jan = v.note("Contacts/Jan/Jan.md");
    v.onRename(async (node, oldPath) => {
      if (!(node instanceof h.TFolder)) return;
      const inner = v.nodes.get(`${node.path}/${oldPath.slice(oldPath.lastIndexOf("/") + 1)}.md`);
      if (inner) await v.renameFile(inner, `${node.path}/${node.name}.md`);
    });
    expect(await renameContact(v.app, jan as never, "Jan Bakker")).toBe("renamed");
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan Bakker", "Contacts/Jan Bakker/Jan Bakker.md"]);
  });

  it("a taken target is reported and nothing moves", async () => {
    useLayout(inside);
    const v = fakeApp();
    const jan = v.note("Contacts/Jan/Jan.md");
    v.folder("Contacts/Jan Bakker");
    expect(await renameContact(v.app, jan as never, "Jan Bakker")).toBe("exists");
    expect(jan.path).toBe("Contacts/Jan/Jan.md");
  });

  it("never moves the contacts folder for a note named like it", async () => {
    useLayout(inside);
    const v = fakeApp();
    const odd = v.note("Contacts/Contacts.md");
    expect(await renameContact(v.app, odd as never, "Jan")).toBe("renamed");
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan.md"]);
  });

  it("refuses to move a folder that holds other contacts", async () => {
    useLayout(inside);
    const v = fakeApp();
    const family = v.note("Contacts/Family/Family.md");
    v.note("Contacts/Family/Sem.md");
    await expect(renameContact(v.app, family as never, "Jan")).rejects.toThrow(/other contacts/);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Family", "Contacts/Family/Family.md", "Contacts/Family/Sem.md"]);
  });

  it("one-note layout renames the note in its folder", async () => {
    const v = fakeApp();
    const jan = v.note("Contacts/Jan.md");
    expect(await noteIO(v.app, jan as never).rename("Jan Bakker")).toBe("renamed");
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan Bakker.md"]);
    v.note("Contacts/Sem.md");
    expect(await noteIO(v.app, jan as never).rename("Sem")).toBe("exists");
  });
});

describe("runSteps", () => {
  it("a missing source whose target exists counts as done", async () => {
    const v = fakeApp();
    v.note("Contacts/B/B.md");
    expect(await runSteps(v.app, [{ kind: "move", from: "Contacts/A", to: "Contacts/B" }])).toEqual({ done: 1, failed: [] });
  });

  it("a failed step stops the steps that depend on it, others still run", async () => {
    const v = fakeApp();
    v.note("Contacts/Jan.md");
    v.note("Contacts/Sem.md");
    const result = await runSteps(v.app, [
      { kind: "move", from: "Contacts/Gone", to: "Contacts/Gone 2" },
      { kind: "move", from: "Contacts/Gone 2/Gone.md", to: "Contacts/Gone 2/Gone 2.md" },
      { kind: "createFolder", to: "Contacts/Sem" },
      { kind: "move", from: "Contacts/Sem.md", to: "Contacts/Sem/Sem.md" },
    ]);
    expect(result.done).toBe(2);
    expect(result.failed.map((f) => f.reason)).toEqual(["missing: Contacts/Gone", "an earlier step failed"]);
    expect(v.paths()).toContain("Contacts/Sem/Sem.md");
  });

  it("an existing target is not overwritten", async () => {
    const v = fakeApp();
    v.note("Contacts/Jan.md");
    v.note("Contacts/Sem.md");
    const result = await runSteps(v.app, [{ kind: "move", from: "Contacts/Jan.md", to: "Contacts/Sem.md" }]);
    expect(result.failed.map((f) => f.reason)).toEqual(["target exists: Contacts/Sem.md"]);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan.md", "Contacts/Sem.md"]);
  });

  it("deletes only empty folders and never the contacts folder", async () => {
    const v = fakeApp();
    v.folder("Contacts/Empty");
    v.note("Contacts/Full/Poem.md", null);
    const result = await runSteps(v.app, [
      { kind: "deleteFolderIfEmpty", to: "Contacts/Empty" },
      { kind: "deleteFolderIfEmpty", to: "Contacts/Full" },
      { kind: "move", from: "Contacts", to: "Other" },
    ]);
    expect(result.done).toBe(1);
    expect(result.failed.map((f) => f.reason)).toEqual(["not empty: Contacts/Full", "refused: Contacts is the contacts folder"]);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Full", "Contacts/Full/Poem.md"]);
  });
});
