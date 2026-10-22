import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, Notice: class {}, TFolder: class {}, TFile: class {} };
});
vi.mock("src/sync/adapters", () => ({ activeSources: () => [], adapterFor: () => ({}) }));
vi.mock("src/context/sharedAppContext", () => ({ getApp: () => ({}), getPluginDir: () => "plugin" }));
vi.mock("src/context/sharedSettingsContext", async () => {
  const { DEFAULT_SETTINGS } = await import("src/settings/setting");
  const sources = [{ id: "s1", name: "Work", addressBookUrl: "http://x/", authType: "apikey", authKey: "k", enabled: true }];
  const settings = { ...DEFAULT_SETTINGS, contactsFolder: "Contacts", sources, defaultSource: "s1" };
  return { getSettings: () => settings, updateSetting: async () => {}, settings: { value: settings } };
});

import { DEFAULT_MAPPING } from "src/contacts/friendly/mapping";
import { contactSyncState, friendlyNoteCard } from "src/contacts/obsidianNotes";

const BASE = ["BEGIN:VCARD", "VERSION:3.0", "UID:jan-1", "FN:Jan Jansen", "N:Jansen;Jan;;Dr;", "ORG:Acme;Sales", "END:VCARD", ""].join("\r\n");

function fakeApp() {
  const adapter = {
    exists: async (p: string) => state.files.has(p),
    read: async (p: string) => state.files.get(p) ?? "",
    write: async (p: string, d: string) => void state.files.set(p, d),
    mkdir: async () => {},
    remove: async (p: string) => void state.files.delete(p),
    list: async () => ({ files: [], folders: [] }),
    rename: async () => {},
  };
  return {
    vault: { adapter, getAbstractFileByPath: () => null },
    workspace: { getActiveFile: () => null },
    metadataCache: { getFileCache: () => ({ frontmatter: { source: "Work" } }), getFirstLinkpathDest: () => null, fileToLinktext: () => "" },
  } as never;
}

beforeEach(() => state.files.clear());

describe("friendlyNoteCard (export)", () => {
  const note = { uid: "jan-1", name: "Jan Jansen", firstname: "Jan", lastname: "Jansen", company: "Acme" };
  const file = { path: "Contacts/Jan Jansen.md", basename: "Jan Jansen" } as never;
  const lookups = { contacts: [], remote: [] };

  it("over a reader-2 base keeps the parts the note does not have yet", async () => {
    const app = fakeApp();
    await contactSyncState("s1", app).set("jan-1", { raw: BASE, etag: "e1", href: "/jan-1.vcf", reader: 2 });
    const card = await friendlyNoteCard(app, file, note, DEFAULT_MAPPING, lookups);
    expect(card).toContain("ORG:Acme;Sales\r\n");
    expect(card).toContain("N:Jansen;Jan;;Dr;\r\n");
  });

  it("over a reader-3 base the note's empty parts are removals", async () => {
    const app = fakeApp();
    await contactSyncState("s1", app).set("jan-1", { raw: BASE, etag: "e1", href: "/jan-1.vcf", reader: 3 });
    const card = await friendlyNoteCard(app, file, note, DEFAULT_MAPPING, lookups);
    expect(card).toContain("ORG:Acme;\r\n");
    expect(card).not.toContain("Sales");
  });
});
