import { describe, expect, it } from "vitest";

import {
  DEFAULT_LAYOUT,
  contactFolderOf,
  contactNameOf,
  contactPaths,
  differsFromFolderNotes,
  folderNotePath,
  fromFolderNotes,
  newContactFolder,
  noteBasename,
  planIntoFolders,
  planOutOfFolders,
  planRename,
  validateLayout,
  type LayoutSettings,
} from "src/contacts/layout";

const inside: LayoutSettings = { layout: "folder", noteName: "{{name}}", location: "inside" };
const insideIndex: LayoutSettings = { layout: "folder", noteName: "index", location: "inside" };
const next: LayoutSettings = { layout: "folder", noteName: "{{name}}", location: "next" };
const none = () => false;
const existing = (...paths: string[]) => (p: string) => paths.includes(p);

describe("paths", () => {
  it("defaults to one note per contact", () => {
    expect(DEFAULT_LAYOUT).toEqual({ layout: "note", noteName: "{{name}}", location: "inside" });
    expect(contactPaths("Contacts", "Jan de Vries", DEFAULT_LAYOUT)).toEqual({ note: "Contacts/Jan de Vries.md" });
  });

  it("inside with the name pattern", () => {
    expect(contactPaths("Contacts", "Jan de Vries", inside)).toEqual({
      folder: "Contacts/Jan de Vries",
      note: "Contacts/Jan de Vries/Jan de Vries.md",
    });
  });

  it("inside with a fixed name", () => {
    expect(contactPaths("Contacts", "Jan de Vries", insideIndex)).toEqual({
      folder: "Contacts/Jan de Vries",
      note: "Contacts/Jan de Vries/index.md",
    });
    expect(noteBasename("Jan de Vries", insideIndex)).toBe("index");
  });

  it("next to the folder", () => {
    expect(contactPaths("Contacts", "Jan de Vries", next)).toEqual({
      folder: "Contacts/Jan de Vries",
      note: "Contacts/Jan de Vries.md",
    });
  });

  it("works from the vault root", () => {
    expect(contactPaths("", "Jan", inside)).toEqual({ folder: "Jan", note: "Jan/Jan.md" });
    expect(contactPaths("/Contacts/", "Jan", DEFAULT_LAYOUT)).toEqual({ note: "Contacts/Jan.md" });
  });

  it("next with a fixed name is refused", () => {
    expect(validateLayout({ layout: "folder", noteName: "index", location: "next" })).toMatch(/\{\{name\}\}/);
    expect(validateLayout(next)).toBeUndefined();
    expect(validateLayout(insideIndex)).toBeUndefined();
  });

  it("refuses empty and invalid patterns", () => {
    expect(validateLayout({ ...inside, noteName: "  " })).toBeDefined();
    expect(validateLayout({ ...inside, noteName: "a/b" })).toBeDefined();
    expect(validateLayout({ ...inside, noteName: "{{name}}?" })).toBeDefined();
    expect(validateLayout({ ...inside, noteName: "index.md" })).toBeDefined();
    expect(validateLayout({ ...inside, noteName: "{{title}}" })).toBeDefined();
    expect(validateLayout({ ...inside, noteName: ".hidden" })).toBeDefined();
    expect(validateLayout({ ...inside, noteName: "_{{name}}" })).toBeUndefined();
  });
});

describe("contactFolderOf", () => {
  it("inside: the parent folder named like the contact", () => {
    expect(contactFolderOf("Contacts/Jan/Jan.md", inside, none)).toBe("Contacts/Jan");
    expect(contactFolderOf("Contacts/Jan/index.md", insideIndex, none)).toBe("Contacts/Jan");
  });

  it("inside: a note that is not in its folder", () => {
    expect(contactFolderOf("Contacts/Jan.md", inside, none)).toBeUndefined();
    expect(contactFolderOf("Contacts/Jan/Sem.md", inside, none)).toBeUndefined();
    expect(contactFolderOf("Contacts/Jan/Jan.md", insideIndex, none)).toBeUndefined();
    expect(contactFolderOf("Jan.md", inside, none)).toBeUndefined();
  });

  it("next: a sibling folder named like the note exists", () => {
    expect(contactFolderOf("Contacts/Jan.md", next, existing("Contacts/Jan"))).toBe("Contacts/Jan");
    expect(contactFolderOf("Contacts/Jan.md", next, none)).toBeUndefined();
  });

  it("one-note layout has no folders", () => {
    expect(contactFolderOf("Contacts/Jan/Jan.md", DEFAULT_LAYOUT, () => true)).toBeUndefined();
  });
});

describe("planRename", () => {
  it("rename moves folder then note", () => {
    const plan = planRename("Contacts/Jan/Jan.md", "Jan de Vries", inside, none);
    expect(plan).toEqual({
      steps: [
        { kind: "move", from: "Contacts/Jan", to: "Contacts/Jan de Vries" },
        { kind: "move", from: "Contacts/Jan de Vries/Jan.md", to: "Contacts/Jan de Vries/Jan de Vries.md" },
      ],
    });
  });

  it("rename with a fixed note name moves the folder only", () => {
    expect(planRename("Contacts/Jan/index.md", "Jan de Vries", insideIndex, none)).toEqual({
      steps: [{ kind: "move", from: "Contacts/Jan", to: "Contacts/Jan de Vries" }],
    });
  });

  it("rename is idempotent after an outside folder rename", () => {
    expect(planRename("Contacts/Jan de Vries/Jan.md", "Jan de Vries", inside, none)).toEqual({
      steps: [{ kind: "move", from: "Contacts/Jan de Vries/Jan.md", to: "Contacts/Jan de Vries/Jan de Vries.md" }],
    });
    expect(planRename("Contacts/Jan de Vries/Jan de Vries.md", "Jan de Vries", inside, () => true)).toEqual({ steps: [] });
  });

  it("rename target exists is skipped", () => {
    const plan = planRename("Contacts/Jan/Jan.md", "Sem", inside, existing("Contacts/Sem"));
    expect(plan.steps).toEqual([]);
    expect(plan.skipped).toContain("Contacts/Sem");
    const noteTaken = planRename("Contacts/Jan de Vries/Jan.md", "Jan de Vries", inside, existing("Contacts/Jan de Vries/Jan de Vries.md"));
    expect(noteTaken.steps).toEqual([]);
    expect(noteTaken.skipped).toContain("Contacts/Jan de Vries/Jan de Vries.md");
  });

  it("one-note layout renames the note only", () => {
    expect(planRename("Contacts/Jan.md", "Jan de Vries", DEFAULT_LAYOUT, none)).toEqual({
      steps: [{ kind: "move", from: "Contacts/Jan.md", to: "Contacts/Jan de Vries.md" }],
    });
    expect(planRename("Contacts/Jan.md", "Jan", DEFAULT_LAYOUT, () => true)).toEqual({ steps: [] });
    expect(planRename("Contacts/Jan.md", "Sem", DEFAULT_LAYOUT, existing("Contacts/Sem.md")).skipped).toContain("Contacts/Sem.md");
  });

  it("a note outside a folder is renamed alone in folder layout", () => {
    expect(planRename("Contacts/Jan.md", "Jan de Vries", inside, none)).toEqual({
      steps: [{ kind: "move", from: "Contacts/Jan.md", to: "Contacts/Jan de Vries.md" }],
    });
  });

  it("next to: folder first, then note; only the note when the folder is missing or already moved", () => {
    expect(planRename("Contacts/Jan.md", "Jan de Vries", next, existing("Contacts/Jan"))).toEqual({
      steps: [
        { kind: "move", from: "Contacts/Jan", to: "Contacts/Jan de Vries" },
        { kind: "move", from: "Contacts/Jan.md", to: "Contacts/Jan de Vries.md" },
      ],
    });
    expect(planRename("Contacts/Jan.md", "Jan de Vries", next, existing("Contacts/Jan de Vries"))).toEqual({
      steps: [{ kind: "move", from: "Contacts/Jan.md", to: "Contacts/Jan de Vries.md" }],
    });
    expect(planRename("Contacts/Jan.md", "Sem", next, existing("Contacts/Jan", "Contacts/Sem")).skipped).toContain("Contacts/Sem");
  });
});

describe("planIntoFolders", () => {
  it("into folders", () => {
    const plan = planIntoFolders(
      [
        { path: "Contacts/Jan.md", name: "Jan" },
        { path: "Contacts/Family/Sem.md", name: "Sem" },
      ],
      inside,
      none,
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.steps).toEqual([
      { kind: "createFolder", to: "Contacts/Jan" },
      { kind: "move", from: "Contacts/Jan.md", to: "Contacts/Jan/Jan.md" },
      { kind: "createFolder", to: "Contacts/Family/Sem" },
      { kind: "move", from: "Contacts/Family/Sem.md", to: "Contacts/Family/Sem/Sem.md" },
    ]);
  });

  it("fixed name goes to index", () => {
    expect(planIntoFolders([{ path: "Contacts/Jan.md", name: "Jan" }], insideIndex, none).steps).toEqual([
      { kind: "createFolder", to: "Contacts/Jan" },
      { kind: "move", from: "Contacts/Jan.md", to: "Contacts/Jan/index.md" },
    ]);
  });

  it("next to: creates the folder only", () => {
    expect(planIntoFolders([{ path: "Contacts/Jan.md", name: "Jan" }], next, none).steps).toEqual([
      { kind: "createFolder", to: "Contacts/Jan" },
    ]);
  });

  it("same target folder is skipped", () => {
    const plan = planIntoFolders(
      [
        { path: "Contacts/Jan.md", name: "Jan" },
        { path: "Contacts/Jan 2.md", name: "Jan" },
      ],
      inside,
      none,
    );
    expect(plan.steps).toHaveLength(2);
    expect(plan.skipped).toEqual([{ path: "Contacts/Jan 2.md", reason: expect.stringContaining("Contacts/Jan") }]);
  });

  it("an existing folder is never merged into", () => {
    const plan = planIntoFolders([{ path: "Contacts/Jan.md", name: "Jan" }], inside, existing("Contacts/Jan"));
    expect(plan.steps).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });

  it("a note already in its folder is skipped", () => {
    const plan = planIntoFolders([{ path: "Contacts/Jan/Jan.md", name: "Jan" }], inside, existing("Contacts/Jan"));
    expect(plan.steps).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/already/);
  });

  it("one-note layout plans nothing", () => {
    const plan = planIntoFolders([{ path: "Contacts/Jan.md", name: "Jan" }], DEFAULT_LAYOUT, none);
    expect(plan.steps).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });
});

describe("planOutOfFolders", () => {
  it("out of folders deletes empty folders only", () => {
    const plan = planOutOfFolders(
      [{ path: "Contacts/Jan/Jan.md", name: "Jan" }],
      inside,
      none,
      () => ["Contacts/Jan/Jan.md"],
    );
    expect(plan).toEqual({
      steps: [
        { kind: "move", from: "Contacts/Jan/Jan.md", to: "Contacts/Jan.md" },
        { kind: "deleteFolderIfEmpty", to: "Contacts/Jan" },
      ],
      kept: [],
      skipped: [],
    });
  });

  it("take out keeps folders with other files", () => {
    const plan = planOutOfFolders(
      [{ path: "Contacts/Jan/index.md", name: "Jan" }],
      insideIndex,
      none,
      () => ["Contacts/Jan/index.md", "Contacts/Jan/poem.md"],
    );
    expect(plan.steps).toEqual([{ kind: "move", from: "Contacts/Jan/index.md", to: "Contacts/Jan.md" }]);
    expect(plan.kept).toEqual(["Contacts/Jan"]);
  });

  it("next to: the note stays, an empty folder goes", () => {
    const plan = planOutOfFolders([{ path: "Contacts/Jan.md", name: "Jan" }], next, existing("Contacts/Jan"), () => []);
    expect(plan.steps).toEqual([{ kind: "deleteFolderIfEmpty", to: "Contacts/Jan" }]);
    expect(plan.kept).toEqual([]);
  });

  it("skips a target that exists and notes not in their folder", () => {
    const plan = planOutOfFolders(
      [
        { path: "Contacts/Jan/Jan.md", name: "Jan" },
        { path: "Contacts/Sem.md", name: "Sem" },
      ],
      inside,
      existing("Contacts/Jan.md"),
      () => [],
    );
    expect(plan.steps).toEqual([]);
    expect(plan.skipped.map((s) => s.path)).toEqual(["Contacts/Jan/Jan.md", "Contacts/Sem.md"]);
  });
});

describe("Folder Notes", () => {
  it("folder notes mapping", () => {
    expect(fromFolderNotes({ folderNoteName: "{{folder_name}}", storageLocation: "insideFolder", folderNoteType: ".md" })).toEqual({
      ok: true,
      settings: { noteName: "{{name}}", location: "inside" },
    });
    expect(fromFolderNotes({ folderNoteName: "{{folder_name}}", storageLocation: "parentFolder" })).toEqual({
      ok: true,
      settings: { noteName: "{{name}}", location: "next" },
    });
    expect(fromFolderNotes({ folderNoteName: "index", storageLocation: "insideFolder" })).toEqual({
      ok: true,
      settings: { noteName: "index", location: "inside" },
    });
  });

  it("folder notes mapping refuses unsupported settings", () => {
    const base = { folderNoteName: "{{folder_name}}", storageLocation: "insideFolder", folderNoteType: ".md" };
    for (const raw of [
      { ...base, storageLocation: "vaultFolder" },
      { ...base, folderNoteType: ".canvas" },
      { ...base, folderNoteType: 3 },
      { ...base, storageLocation: undefined },
      { ...base, storageLocation: 5 },
      { ...base, folderNoteName: undefined },
      { ...base, folderNoteName: "" },
      { ...base, folderNoteName: 7 },
      { folderNoteName: "index", storageLocation: "parentFolder" }, // next + fixed name
      null,
      undefined,
      "text",
      [],
      {},
    ]) {
      const result = fromFolderNotes(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("differs from folder notes", () => {
    const raw = { folderNoteName: "{{folder_name}}", storageLocation: "insideFolder" };
    expect(differsFromFolderNotes(raw, inside)).toBe(false);
    expect(differsFromFolderNotes(raw, next)).toBe(true);
    expect(differsFromFolderNotes(raw, insideIndex)).toBe(true);
    expect(differsFromFolderNotes({ ...raw, storageLocation: "vaultFolder" }, inside)).toBe(true);
    expect(differsFromFolderNotes(undefined, inside)).toBe(false);
  });
});

describe("new contacts and names", () => {
  it("the note that owns a folder", () => {
    expect(folderNotePath("Contacts/Jan", inside)).toBe("Contacts/Jan/Jan.md");
    expect(folderNotePath("Contacts/Jan", insideIndex)).toBe("Contacts/Jan/index.md");
    expect(folderNotePath("Contacts/Jan", next)).toBe("Contacts/Jan.md");
    expect(folderNotePath("Contacts/Jan", DEFAULT_LAYOUT)).toBeUndefined();
    expect(folderNotePath("", inside)).toBeUndefined();
  });

  it("new contact folder: active folder inside the contacts folder, never in a contact's folder", () => {
    const contacts = existing("Contacts/Family/Sem/Sem.md", "Contacts/Family/Sem/Kid/Kid.md");
    expect(newContactFolder("Contacts", undefined, inside, contacts)).toBe("Contacts");
    expect(newContactFolder("Contacts", "Elsewhere", inside, contacts)).toBe("Contacts");
    expect(newContactFolder("Contacts", "ContactsX", inside, contacts)).toBe("Contacts");
    expect(newContactFolder("Contacts", "Contacts/Family", inside, contacts)).toBe("Contacts/Family");
    expect(newContactFolder("Contacts", "Contacts/Family/Sem", inside, contacts)).toBe("Contacts/Family");
    expect(newContactFolder("Contacts", "Contacts/Family/Sem/Kid/Photos", inside, contacts)).toBe("Contacts/Family");
    expect(newContactFolder("Contacts", "Contacts/Family/Sem", DEFAULT_LAYOUT, contacts)).toBe("Contacts/Family/Sem");
    expect(newContactFolder("", "/", inside, contacts)).toBe("");
    expect(newContactFolder("", "Sem", inside, existing("Sem/Sem.md"))).toBe("");
  });

  it("contact name of a note", () => {
    expect(contactNameOf("Contacts/Jan/index.md", "Contacts", insideIndex, none)).toBe("Jan");
    expect(contactNameOf("Contacts/Jan/Jan.md", "Contacts", inside, none)).toBe("Jan");
    expect(contactNameOf("Contacts/Jan.md", "Contacts", inside, none)).toBe("Jan");
    expect(contactNameOf("Contacts/index.md", "Contacts", insideIndex, none)).toBe("index");
    expect(contactNameOf("Other/Jan/index.md", "Contacts", insideIndex, none)).toBe("index");
    const card: LayoutSettings = { layout: "folder", noteName: "{{name}} (card)", location: "next" };
    expect(contactNameOf("Contacts/Jan (card).md", "Contacts", card, existing("Contacts/Jan (card)"))).toBe("Jan");
    expect(contactNameOf("Contacts/Jan (card).md", "Contacts", card, none)).toBe("Jan (card)");
    expect(contactNameOf("Contacts/Jan.md", "Contacts", DEFAULT_LAYOUT, none)).toBe("Jan");
  });
});
