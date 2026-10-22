import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "src/settings/settings";

const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  choice: "replace" as "replace" | "skip",
}));

vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    Notice: class {},
    TFolder: class {},
    TFile: class {},
  };
});

vi.mock("src/ui/modals/fileExistsModal", () => ({
  // Answers like the user would, a moment after the dialog opens.
  FileExistsModal: class {
    constructor(_app: unknown, _path: string, private callback: (action: "replace" | "skip") => void) {}
    open() {
      setTimeout(() => this.callback(state.choice), 5);
    }
  },
}));

vi.mock("src/sync/adapters", () => ({ activeSources: () => [], adapterFor: () => ({}) }));
vi.mock("src/context/sharedAppContext", () => ({ getApp: () => ({}), getPluginDir: () => "plugin" }));
vi.mock("src/context/sharedSettingsContext", async () => {
  const { DEFAULT_SETTINGS } = await import("src/settings/setting");
  const settings = { ...DEFAULT_SETTINGS, contactsFolder: "Contacts", sources: [], defaultSource: "", noteLinks: { enabled: true, vaultName: "Notes", formerVaultNames: [] } };
  return { getSettings: () => settings, updateSetting: async () => {}, settings: { value: settings } };
});

import { contactSyncState, importRemoteCard } from "src/contacts/obsidianNotes";

const source: Source = { id: "s1", name: "Work", addressBookUrl: "http://x/", authType: "apikey", authKey: "k", enabled: true };
const card = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:abc-1\r\nFN:Anna Jansen\r\nN:Jansen;Anna;;;\r\nEND:VCARD\r\n";
const pulled = { uid: "abc-1", raw: card, etag: "e1", href: "/abc-1.vcf" };

function fakeApp() {
  const dirs = new Set<string>(["Contacts"]);
  const adapter = {
    exists: async (p: string) => state.files.has(p) || dirs.has(p),
    read: async (p: string) => state.files.get(p) ?? "",
    write: async (p: string, d: string) => { state.files.set(p, d); },
    mkdir: async (p: string) => { dirs.add(p); },
    remove: async (p: string) => { state.files.delete(p); },
    list: async () => ({ files: [], folders: [] }),
    rename: async () => {},
  };
  return {
    vault: { adapter, getAbstractFileByPath: (p: string) => (dirs.has(p) ? {} : null) },
    workspace: { getActiveFile: () => null },
    metadataCache: { getFirstLinkpathDest: () => null, fileToLinktext: () => "" },
  } as never;
}

beforeEach(() => {
  state.files.clear();
  state.choice = "replace";
});

describe("importRemoteCard", () => {
  it("import writes source and stores the base in that source", async () => {
    const app = fakeApp();
    expect(await importRemoteCard(app, pulled, { href: "/abc-1.vcf" }, source)).toBe("imported");
    const note = state.files.get("Contacts/Anna Jansen.md");
    expect(note).toMatch(/^source: Work$/m);
    expect(await contactSyncState("s1", app).get("abc-1")).toEqual({ raw: card, etag: "e1", href: "/abc-1.vcf", reader: 3, storedAt: expect.any(Number) });
    expect(await contactSyncState("other", app).get("abc-1")).toBeUndefined();
  });

  it("skipped import stores no base", async () => {
    const app = fakeApp();
    state.files.set("Contacts/Anna Jansen.md", "---\nfn: Old\n---\n");
    state.choice = "skip";
    expect(await importRemoteCard(app, pulled, { href: "/abc-1.vcf" }, { ...source, id: "s2" })).toBe("skipped");
    expect(state.files.get("Contacts/Anna Jansen.md")).toBe("---\nfn: Old\n---\n");
    expect(await contactSyncState("s2", app).get("abc-1")).toBeUndefined();
  });

  it("waits for Replace, then writes the note with source and stores the base", async () => {
    const app = fakeApp();
    state.files.set("Contacts/Anna Jansen.md", "---\nfn: Old\n---\n");
    expect(await importRemoteCard(app, pulled, { href: "/abc-1.vcf" }, { ...source, id: "s3" })).toBe("imported");
    expect(state.files.get("Contacts/Anna Jansen.md")).toMatch(/^source: Work$/m);
    expect(await contactSyncState("s3", app).get("abc-1")).toBeDefined();
  });

  it("a photo the server damaged reaches neither the note nor the base", async () => {
    const app = fakeApp();
    const damaged = card.replace("VERSION:3.0", "VERSION:4.0").replace("END:VCARD", "PHOTO:data:image/png\\;base64\r\nEND:VCARD");
    expect(await importRemoteCard(app, { ...pulled, raw: damaged }, { href: "/abc-1.vcf" }, { ...source, id: "s4" })).toBe("imported");
    expect(state.files.get("Contacts/Anna Jansen.md")).not.toMatch(/photo|base64/i);
    const base = await contactSyncState("s4", app).get("abc-1");
    expect(base?.raw).toContain("FN:Anna Jansen");
    expect(base?.raw).not.toMatch(/PHOTO/);
  });

  it("does not import a link to an Obsidian note this plugin wrote on the card as a website", async () => {
    const withLink = [
      "BEGIN:VCARD", "VERSION:3.0", "UID:abc-2", "FN:Anna Jansen", "N:Jansen;Anna;;;", "URL:https://a.example",
      "item1.URL:obsidian://open?vault=Notes&file=Contacts%2FJan%2Findex", "item1.X-ABLabel:Jan", "END:VCARD", "",
    ].join("\r\n");
    expect(await importRemoteCard(fakeApp(), { uid: "abc-2", raw: withLink }, { href: "/abc-2.vcf" }, source)).toBe("imported");
    const note = state.files.get("Contacts/Anna Jansen.md") ?? "";
    expect(note).toMatch(/^website: "https:\/\/a\.example"$/m);
    expect(note).not.toMatch(/website-2/);
    expect(note).not.toMatch(/obsidian:/);
  });

  it("reports a card without a name as unnamed", async () => {
    const nameless = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:zzz\r\nEND:VCARD\r\n";
    expect(await importRemoteCard(fakeApp(), { uid: "zzz", raw: nameless }, { href: "/z.vcf" }, source)).toBe("unnamed");
    expect(state.files.size).toBe(0);
  });
});
