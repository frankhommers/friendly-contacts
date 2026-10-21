import { beforeEach, describe, expect, it, vi } from "vitest";

/** Two contact notes in `Contacts`, frontmatter from a fake metadata cache, and the sync state of `radicale` on disk. */
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
  }
  class TFile extends TAbstractFile {
    frontmatter: Record<string, unknown> = {};
    get extension(): string {
      return "md";
    }
  }
  return {
    TAbstractFile,
    TFolder,
    TFile,
    settings: {
      contactsFolder: "Contacts",
      sources: [{ id: "radicale", name: "Radicale" }],
      defaultSource: "radicale",
    } as Record<string, unknown>,
  };
});

vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
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

vi.mock("src/sync/adapters", () => ({ activeSources: () => [], adapterFor: () => ({}) }));
vi.mock("src/context/sharedAppContext", () => ({ getApp: () => ({}), getPluginDir: () => "plugin" }));
vi.mock("src/context/sharedSettingsContext", () => ({
  getSettings: () => h.settings,
  updateSetting: async () => {},
}));

import type { App } from "obsidian";
import { labelledDateRow } from "src/contacts/friendly/dateLabels";
import { DEFAULT_MAPPING } from "src/contacts/friendly/mapping";
import {
  fillNotes,
  findDateLabels,
  notesWithBases,
  notesWithRowProperties,
  removeRowProperties,
} from "src/contacts/labelledDates";

type File = InstanceType<typeof h.TFile>;

const ANNA_CARD = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "UID:anna",
  "FN:Anna",
  "N:;Anna;;;",
  "item1.X-ABDATE:2012-05-01",
  "item1.X-ABLabel:Verkering",
  "END:VCARD",
  "",
].join("\r\n");

/** The plugin folder on disk; shared by every test, as the sync-state store is cached per folder. */
const disk = new Map<string, string>([
  ["plugin/sync-state/radicale/index.json", JSON.stringify({ anna: { etag: "1", href: "/anna.vcf", reader: 2 } })],
  ["plugin/sync-state/radicale/anna.vcf", ANNA_CARD],
]);

function fakeApp() {
  const folder = new h.TFolder("Contacts");
  const note = (path: string, frontmatter: Record<string, unknown>): File => {
    const file = new h.TFile(path);
    file.frontmatter = frontmatter;
    file.parent = folder;
    folder.children.push(file);
    return file;
  };
  const anna = note("Contacts/Anna.md", { name: "Anna", uid: "anna" });
  const bob = note("Contacts/Bob.md", { name: "Bob", uid: "bob" });
  const nodes = new Map<string, InstanceType<typeof h.TAbstractFile>>([
    [folder.path, folder],
    [anna.path, anna],
    [bob.path, bob],
  ]);
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => nodes.get(path) ?? null,
      adapter: {
        exists: async (path: string) => disk.has(path),
        read: async (path: string) => disk.get(path)!,
      },
    },
    metadataCache: {
      getFileCache: (file: File) => ({ frontmatter: file.frontmatter }),
    },
    fileManager: {
      processFrontMatter: async (file: File, change: (fm: Record<string, unknown>) => void) => change(file.frontmatter),
    },
  } as unknown as App;
  return { app, anna, bob };
}

const datingRow = labelledDateRow("Verkering", "dating");

describe("dates with a label in the notes", () => {
  let vault: ReturnType<typeof fakeApp>;
  beforeEach(() => {
    vault = fakeApp();
  });

  it("gathers every contact note with its base and the reader it was stored with", async () => {
    const notes = await notesWithBases(vault.app);
    expect(notes).toEqual([
      { path: "Contacts/Anna.md", frontmatter: { name: "Anna", uid: "anna" }, base: { raw: ANNA_CARD, reader: 2 } },
      { path: "Contacts/Bob.md", frontmatter: { name: "Bob", uid: "bob" } },
    ]);
  });

  it("finds the labels on the last-synced cards that have no row", async () => {
    expect(await findDateLabels(vault.app, DEFAULT_MAPPING)).toEqual([{ label: "Verkering", contacts: 1 }]);
    expect(await findDateLabels(vault.app, [...DEFAULT_MAPPING, datingRow])).toEqual([]);
  });

  it("fills only properties that are still empty when the note is written", async () => {
    vault.anna.frontmatter["dating-2"] = "typed meanwhile";
    const result = await fillNotes(vault.app, [
      { path: "Contacts/Anna.md", set: { dating: "2012-05-01", "dating-2": "2015-06-01" } },
      { path: "Contacts/Gone.md", set: { dating: "2012-05-01" } },
    ]);
    expect(result).toEqual({ filled: 1, failed: ["Contacts/Gone.md"] });
    expect(vault.anna.frontmatter).toEqual({ name: "Anna", uid: "anna", dating: "2012-05-01", "dating-2": "typed meanwhile" });
  });

  it("removes the row's properties from the notes and nothing else", async () => {
    Object.assign(vault.anna.frontmatter, { dating: "2012-05-01", "dating-2": "2015-06-01", datingapp: "x", birthday: "1990-01-01" });
    expect(notesWithRowProperties(vault.app, datingRow)).toEqual([vault.anna]);
    expect(await removeRowProperties(vault.app, datingRow)).toEqual({ removed: 1, failed: [] });
    expect(vault.anna.frontmatter).toEqual({ name: "Anna", uid: "anna", datingapp: "x", birthday: "1990-01-01" });
    expect(vault.bob.frontmatter).toEqual({ name: "Bob", uid: "bob" });
    expect(notesWithRowProperties(vault.app, datingRow)).toEqual([]);
  });
});
