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
    Vault: {
      recurseChildren(folder: InstanceType<typeof h.TFolder>, callback: (node: InstanceType<typeof h.TAbstractFile>) => void) {
        const walk = (node: InstanceType<typeof h.TAbstractFile>) => {
          callback(node);
          if (node instanceof h.TFolder) node.children.forEach(walk);
        };
        walk(folder);
      },
    },
  };
});

vi.mock("src/ui/modals/fileExistsModal", () => ({
  FileExistsModal: class {
    constructor(
      _app: unknown,
      private path: string,
      private callback: (action: "replace" | "skip") => void,
      private message?: string,
    ) {}
    open() {
      h.dialogs.push(this.message === undefined ? this.path : `${this.path}: ${this.message}`);
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
import {
  changeLayout,
  layoutChangeCount,
  layoutNotice,
  newContactLocation,
  renameBlocked,
  renameContact,
  resetLayoutWarning,
  runSteps,
} from "src/contacts/layoutNotes";
import { moveContacts, noteIO } from "src/contacts/obsidianNotes";

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

  it("folder holding a different contact note asks first", async () => {
    useLayout(inside);
    const v = fakeApp();
    v.note("Contacts/Jan/index.md", CONTACT, "other");
    h.choice = "skip";
    expect(await createContactFile(v.app, "Contacts", "new", "Jan.md")).toBe("Contacts/Jan/Jan.md");
    expect(h.dialogs).toEqual([
      'Contacts/Jan/Jan.md: The folder "Contacts/Jan" already holds a contact (index). Create "Contacts/Jan/Jan.md" there anyway?',
    ]);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan", "Contacts/Jan/index.md"]);
    h.choice = "replace";
    await createContactFile(v.app, "Contacts", "new", "Jan.md");
    expect((v.nodes.get("Contacts/Jan/Jan.md") as File).content).toBe("new");
    expect((v.nodes.get("Contacts/Jan/index.md") as File).content).toBe("other");
  });

  it("next to: a contact note inside the folder asks first", async () => {
    useLayout(next);
    const v = fakeApp();
    v.note("Contacts/Jan/Sem.md", CONTACT, "sem");
    h.choice = "skip";
    await createContactFile(v.app, "Contacts", "new", "Jan.md");
    expect(h.dialogs).toHaveLength(1);
    expect(v.nodes.has("Contacts/Jan.md")).toBe(false);
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

  it("next to: folder move fails, note stays put", async () => {
    useLayout(next);
    const v = fakeApp();
    const jan = v.note("Contacts/Jan.md");
    v.note("Contacts/Jan/Photo.md", null);
    const realRename = v.renameFile;
    let folderMoves = 0;
    (v.app as { fileManager: { renameFile: unknown } }).fileManager.renameFile = async (node: Node, to: string) => {
      if (node instanceof h.TFolder) {
        folderMoves++;
        throw new Error("folder is locked");
      }
      await realRename(node, to);
    };
    await expect(renameContact(v.app, jan as never, "Jan Bakker")).rejects.toThrow(/folder is locked/);
    expect(folderMoves).toBe(1);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan", "Contacts/Jan.md", "Contacts/Jan/Photo.md"]);
  });

  it("the review knows why a rename is blocked", () => {
    useLayout(inside);
    const v = fakeApp();
    const jan = v.note("Contacts/Jan/Jan.md");
    expect(renameBlocked(v.app, jan as never, "Jan Bakker")).toBeUndefined();
    v.folder("Contacts/Jan Bakker");
    expect(renameBlocked(v.app, jan as never, "Jan Bakker")).toBe('A folder or note named "Jan Bakker" already exists.');
    const family = v.note("Contacts/Family/Family.md");
    v.note("Contacts/Family/Sem.md");
    expect(renameBlocked(v.app, family as never, "Fam")).toBe("Contacts/Family holds other contacts (Sem); rename it by hand.");
    useLayout(DEFAULT_SETTINGS.layout);
    const anna = v.note("Contacts/Anna.md");
    v.note("Contacts/Ann.md");
    expect(renameBlocked(v.app, anna as never, "Ann")).toBe('A note named "Ann" already exists in this folder.');
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
    expect(await runSteps(v.app, [{ kind: "move", from: "Contacts/A", to: "Contacts/B" }])).toEqual({ done: 1, failed: [], kept: [] });
  });

  it("a failed step stops the rest of that contact; other contacts still run", async () => {
    const v = fakeApp();
    v.note("Contacts/Jan.md");
    v.note("Contacts/Sem.md");
    const result = await runSteps(v.app, [
      [
        { kind: "move", from: "Contacts/Gone", to: "Contacts/Gone 2" },
        { kind: "move", from: "Contacts/Jan.md", to: "Contacts/Jan 2.md" },
      ],
      [
        { kind: "createFolder", to: "Contacts/Sem" },
        { kind: "move", from: "Contacts/Sem.md", to: "Contacts/Sem/Sem.md" },
      ],
    ]);
    expect(result.done).toBe(2);
    expect(result.failed.map((f) => f.reason)).toEqual(["missing: Contacts/Gone", "an earlier step failed"]);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan.md", "Contacts/Sem", "Contacts/Sem/Sem.md"]);
  });

  it("a flat list is one contact: a failure stops everything after it", async () => {
    const v = fakeApp();
    v.note("Contacts/Jan.md");
    const result = await runSteps(v.app, [
      { kind: "move", from: "Contacts/Jan", to: "Contacts/Jan 2" },
      { kind: "move", from: "Contacts/Jan.md", to: "Contacts/Jan 2.md" },
    ]);
    expect(result).toEqual({
      done: 0,
      kept: [],
      failed: [
        { step: { kind: "move", from: "Contacts/Jan", to: "Contacts/Jan 2" }, reason: "missing: Contacts/Jan" },
        { step: { kind: "move", from: "Contacts/Jan.md", to: "Contacts/Jan 2.md" }, reason: "an earlier step failed" },
      ],
    });
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan.md"]);
  });

  it("an existing target is not overwritten", async () => {
    const v = fakeApp();
    v.note("Contacts/Jan.md");
    v.note("Contacts/Sem.md");
    const result = await runSteps(v.app, [{ kind: "move", from: "Contacts/Jan.md", to: "Contacts/Sem.md" }]);
    expect(result.failed.map((f) => f.reason)).toEqual(["target exists: Contacts/Sem.md"]);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan.md", "Contacts/Sem.md"]);
  });

  it("deletes only empty folders; a folder with files is kept, not failed; never the contacts folder", async () => {
    const v = fakeApp();
    v.folder("Contacts/Empty");
    v.note("Contacts/Full/Poem.md", null);
    const result = await runSteps(v.app, [
      [{ kind: "deleteFolderIfEmpty", to: "Contacts/Empty" }],
      [{ kind: "deleteFolderIfEmpty", to: "Contacts/Full" }],
      [{ kind: "move", from: "Contacts", to: "Other" }],
    ]);
    expect(result.done).toBe(1);
    expect(result.kept).toEqual(["Contacts/Full"]);
    expect(result.failed.map((f) => f.reason)).toEqual(["refused: Contacts is the contacts folder"]);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Full", "Contacts/Full/Poem.md"]);
  });
});

describe("layout commands", () => {
  it("take out keeps folders with other files", async () => {
    useLayout({ ...inside, layout: "note" }); // switched to one note per contact; the folder settings stay stored
    const v = fakeApp();
    v.note("Contacts/Jan/Jan.md");
    v.note("Contacts/Jan/Poem.md", null, "roses");
    v.note("Contacts/Sem/Sem.md");
    v.note("Contacts/Anna.md");
    expect(layoutChangeCount(v.app, "out")).toBe(2);

    const result = await changeLayout(v.app, "out");

    expect(result.moved).toBe(2);
    expect(result.kept).toEqual(["Contacts/Jan"]);
    expect(result.skipped).toEqual([{ path: "Contacts/Anna.md", reason: "not in its own folder" }]);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Anna.md", "Contacts/Jan", "Contacts/Jan.md", "Contacts/Jan/Poem.md", "Contacts/Sem.md"]);
    expect((v.nodes.get("Contacts/Jan/Poem.md") as File).content).toBe("roses");
    expect(layoutNotice(result)).toBe("Moved 2, skipped 1, kept 1 folders with other files (see console)");
  });

  it("take out leaves a folder that gained a file after planning, and does not count it as failed", async () => {
    useLayout({ ...inside, layout: "note" });
    const v = fakeApp();
    v.note("Contacts/Jan/Jan.md");
    // A sync tool drops a file into the folder while the note is being moved.
    v.onRename(async () => {
      v.note("Contacts/Jan/Late.pdf", null);
    });
    const result = await changeLayout(v.app, "out");
    expect(result.moved).toBe(1);
    expect(result.kept).toEqual(["Contacts/Jan"]);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan", "Contacts/Jan.md", "Contacts/Jan/Late.pdf"]);
  });

  it("take out in next to layout deletes an empty sibling folder and keeps one with files", async () => {
    useLayout({ ...next, layout: "note" });
    const v = fakeApp();
    v.note("Contacts/Jan.md");
    v.folder("Contacts/Jan");
    v.note("Contacts/Sem.md");
    v.note("Contacts/Sem/Photo.md", null);
    const result = await changeLayout(v.app, "out");
    expect(result.moved).toBe(1);
    expect(result.kept).toEqual(["Contacts/Sem"]);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan.md", "Contacts/Sem", "Contacts/Sem.md", "Contacts/Sem/Photo.md"]);
  });

  it("take out never moves a note out of the contacts folder itself", async () => {
    useLayout({ ...inside, layout: "note" });
    const v = fakeApp();
    v.note("Contacts/Contacts.md");
    const result = await changeLayout(v.app, "out");
    expect(result.moved).toBe(0);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Contacts.md"]);
  });

  it("take out skips a target that exists", async () => {
    useLayout({ ...inside, layout: "note" });
    const v = fakeApp();
    v.note("Contacts/Jan/Jan.md");
    v.note("Contacts/Jan.md", null);
    const result = await changeLayout(v.app, "out");
    expect(result.moved).toBe(0);
    expect(result.skipped).toEqual([{ path: "Contacts/Jan/Jan.md", reason: "target exists: Contacts/Jan.md" }]);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan", "Contacts/Jan.md", "Contacts/Jan/Jan.md"]);
  });

  it("take out with a fixed note name uses the folder's name", async () => {
    useLayout({ ...insideIndex, layout: "note" });
    const v = fakeApp();
    v.note("Contacts/Jan de Vries/index.md");
    const result = await changeLayout(v.app, "out");
    expect(result.moved).toBe(1);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan de Vries.md"]);
  });

  it("into folders skips notes already in their folder", async () => {
    useLayout(inside);
    const v = fakeApp();
    v.note("Contacts/Jan/Jan.md");
    v.note("Contacts/Sem.md");
    v.note("Contacts/Family/Anna.md");
    expect(layoutChangeCount(v.app, "into")).toBe(2);

    const result = await changeLayout(v.app, "into");

    expect(result.moved).toBe(2);
    expect(result.kept).toEqual([]);
    expect(result.skipped).toEqual([{ path: "Contacts/Jan/Jan.md", reason: "already in its folder" }]);
    expect(v.paths()).toEqual([
      "Contacts",
      "Contacts/Family",
      "Contacts/Family/Anna",
      "Contacts/Family/Anna/Anna.md",
      "Contacts/Jan",
      "Contacts/Jan/Jan.md",
      "Contacts/Sem",
      "Contacts/Sem/Sem.md",
    ]);
    expect(layoutNotice(result)).toBe("Moved 2, skipped 1, kept 0 folders with other files (see console)");
  });

  it("into folders: a failing contact does not stop the others, and a taken folder is skipped", async () => {
    useLayout(inside);
    const v = fakeApp();
    v.note("Contacts/Jan.md");
    v.note("Contacts/Sem.md");
    v.note("Contacts/Anna.md");
    v.note("Contacts/Anna/Poem.md", null);
    const original = v.nodes.get("Contacts/Jan.md") as File;
    const rename = (v.app as unknown as { fileManager: { renameFile: (n: unknown, to: string) => Promise<void> } }).fileManager;
    const renameFile = rename.renameFile;
    rename.renameFile = async (node, to) => {
      if (node === original) throw new Error("locked");
      await renameFile(node, to);
    };
    const result = await changeLayout(v.app, "into");
    expect(result.moved).toBe(1);
    expect(result.skipped.map((s) => [s.path, s.reason])).toEqual([
      ["Contacts/Anna.md", "folder exists: Contacts/Anna"],
      ["Contacts/Jan.md", "locked"],
    ]);
    expect(v.nodes.has("Contacts/Sem/Sem.md")).toBe(true);
    expect(v.nodes.has("Contacts/Jan.md")).toBe(true);
  });

  it("into folders leaves a second contact note inside someone's folder alone", async () => {
    useLayout(inside);
    const v = fakeApp();
    v.note("Contacts/Jan/Jan.md");
    v.note("Contacts/Jan/Sem.md");
    const result = await changeLayout(v.app, "into");
    expect(result.moved).toBe(0);
    expect(result.skipped.map((s) => s.path).sort()).toEqual(["Contacts/Jan/Jan.md", "Contacts/Jan/Sem.md"]);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan", "Contacts/Jan/Jan.md", "Contacts/Jan/Sem.md"]);
  });

  it("into folders needs the folder layout and usable settings", async () => {
    const v = fakeApp();
    v.note("Contacts/Jan.md");
    await expect(changeLayout(v.app, "into")).rejects.toThrow("Folder per contact");
    expect(layoutChangeCount(v.app, "into")).toBe(0);
    useLayout({ layout: "folder", noteName: "", location: "inside" });
    await expect(changeLayout(v.app, "into")).rejects.toThrow("folder note name is empty");
  });

  it("into folders next to: creates the folder beside the note", async () => {
    useLayout(next);
    const v = fakeApp();
    v.note("Contacts/Jan.md");
    const result = await changeLayout(v.app, "into");
    expect(result.moved).toBe(1);
    expect(v.paths()).toEqual(["Contacts", "Contacts/Jan", "Contacts/Jan.md"]);
  });
});

describe("move contacts", () => {
  it("move contacts moves whole folders in folder layout", async () => {
    useLayout(inside);
    const v = fakeApp();
    v.folder("Areas");
    v.note("Contacts/Jan/Jan.md");
    v.note("Contacts/Jan/Poem.md", null, "roses");
    v.note("Contacts/Jan/Photos/Beach.md", null);
    v.note("Contacts/Family/Sem/Sem.md");
    v.note("Contacts/Anna.md");

    const result = await moveContacts(v.app, "Areas", "Contacts");

    expect(result).toEqual({ moved: 3, skipped: [] });
    expect(v.paths()).toEqual([
      "Areas",
      "Areas/Anna.md",
      "Areas/Family",
      "Areas/Family/Sem",
      "Areas/Family/Sem/Sem.md",
      "Areas/Jan",
      "Areas/Jan/Jan.md",
      "Areas/Jan/Photos",
      "Areas/Jan/Photos/Beach.md",
      "Areas/Jan/Poem.md",
      "Contacts",
      "Contacts/Family",
    ]);
    expect((v.nodes.get("Areas/Jan/Poem.md") as File).content).toBe("roses");
  });

  it("a second contact note in someone's folder travels with that folder", async () => {
    useLayout(inside);
    const v = fakeApp();
    v.folder("Areas");
    v.note("Contacts/Jan/Jan.md");
    v.note("Contacts/Jan/Sem.md");
    const result = await moveContacts(v.app, "Areas", "Contacts");
    expect(result).toEqual({ moved: 2, skipped: [] });
    expect(v.paths()).toEqual(["Areas", "Areas/Jan", "Areas/Jan/Jan.md", "Areas/Jan/Sem.md", "Contacts"]);
  });

  it("next to: the folder and its note move together; an existing target skips both", async () => {
    useLayout(next);
    const v = fakeApp();
    v.folder("Areas");
    v.note("Contacts/Jan.md");
    v.note("Contacts/Jan/Poem.md", null);
    v.note("Contacts/Sem.md");
    v.folder("Contacts/Sem");
    v.note("Areas/Sem.md", null);

    const result = await moveContacts(v.app, "Areas", "Contacts");

    expect(result.moved).toBe(1);
    expect(result.skipped.map((s) => s.from).sort()).toEqual(["Contacts/Sem", "Contacts/Sem.md"]);
    expect(v.paths()).toEqual([
      "Areas",
      "Areas/Jan",
      "Areas/Jan.md",
      "Areas/Jan/Poem.md",
      "Areas/Sem.md",
      "Contacts",
      "Contacts/Sem",
      "Contacts/Sem.md",
    ]);
  });

  it("an existing target folder is skipped, never merged", async () => {
    useLayout(inside);
    const v = fakeApp();
    v.note("Contacts/Jan/Jan.md");
    v.note("Areas/Jan/Other.md", null);
    const result = await moveContacts(v.app, "Areas", "Contacts");
    expect(result.moved).toBe(0);
    expect(result.skipped.map((s) => s.from)).toEqual(["Contacts/Jan"]);
    expect(v.paths()).toEqual(["Areas", "Areas/Jan", "Areas/Jan/Other.md", "Contacts", "Contacts/Jan", "Contacts/Jan/Jan.md"]);
  });

  it("one-note layout moves notes one by one as before", async () => {
    const v = fakeApp();
    v.folder("Areas");
    v.note("Contacts/Jan.md");
    v.note("Contacts/Family/Sem.md");
    const result = await moveContacts(v.app, "Areas", "Contacts");
    expect(result).toEqual({ moved: 2, skipped: [] });
    expect(v.paths()).toEqual(["Areas", "Areas/Family", "Areas/Family/Sem.md", "Areas/Jan.md", "Contacts", "Contacts/Family"]);
  });
});
