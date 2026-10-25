import { DEFAULT_MAPPING } from "src/contacts/friendly/mapping";
import { rowForProperty } from "src/contacts/friendly/mapping";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ mapping: [] as unknown[], mirror: false }));

vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, Notice: class {}, TFile: class {}, TFolder: class {} };
});
vi.mock("src/context/sharedAppContext", () => ({ getApp: () => ({}), getPluginDir: () => "plugin" }));
vi.mock("src/context/sharedSettingsContext", async () => {
  const { DEFAULT_SETTINGS } = await import("src/settings/setting");
  return {
    getSettings: () => ({ ...DEFAULT_SETTINGS, contactsFolder: "Contacts", friendly: { ...DEFAULT_SETTINGS.friendly, mapping: state.mapping } }),
    updateSetting: async () => {},
    settings: { value: DEFAULT_SETTINGS },
  };
});
vi.mock("src/settings/deviceSettings", () => ({ mirrorRelationsOnThisDevice: () => state.mirror }));
vi.mock("src/sync/adapters", () => ({ activeSources: () => [], adapterFor: () => ({}), isSyncAvailable: () => false }));
vi.mock("src/ui/modals/syncReviewModal", () => ({ SyncReviewModal: class {} }));
vi.mock("src/contacts/layoutNotes", () => ({ contactNameFor: () => "Jan", renameBlocked: () => undefined, renamesFolder: () => false }));
vi.mock("src/contacts/obsidianNotes", () => ({
  cardVersions: async () => [],
  contactNotes: () => [],
  contactSyncState: () => ({}),
  importRemoteCard: async () => "imported",
  noteIO: () => ({ readFrontmatter: async () => ({ name: "Jan" }) }),
  obsidianMirrorEnv: () => ({
    listContacts: () => [{ path: "Contacts/Piet.md", frontmatter: { friends: ["[[Jan]]"], children: ["[[Sem]]"] } }],
    resolveLink: (link: string) => `Contacts/${link.replace(/\[|\]/g, "")}.md`,
  }),
  remoteContacts: async () => [],
  syncRelationContexts: async () => ({}),
}));

import { flowDepsFor } from "src/sync/sync";

const withFriendsOff = () => DEFAULT_MAPPING.map((row) => (row.property === "friends" ? { ...row, sync: false as const } : row));

describe("flowDepsFor", () => {
  it("hands Sync the rows with Sync off skipped, and leaves the stored rows alone", async () => {
    const stored = withFriendsOff();
    state.mapping = stored;
    const deps = await flowDepsFor({} as never, {} as never);
    if ("refused" in deps) throw new Error(deps.refused);
    expect(deps.rows.find((r) => r.property === "friends")?.skip).toBe(true);
    expect(rowForProperty("friends", deps.rows)).toBeUndefined();
    expect(rowForProperty("children", deps.rows)).toBeDefined();
    expect(stored.some((r) => r.skip)).toBe(false);
  });

  it("all rows stay as they are while every row syncs", async () => {
    state.mapping = DEFAULT_MAPPING;
    const deps = await flowDepsFor({} as never, {} as never);
    if ("refused" in deps) throw new Error(deps.refused);
    expect(deps.rows).toEqual(DEFAULT_MAPPING);
  });

  it("the relationship mirror still sees the property: it keeps the stored rows", async () => {
    state.mapping = withFriendsOff();
    state.mirror = true;
    try {
      const deps = await flowDepsFor({} as never, {} as never);
      if ("refused" in deps) throw new Error(deps.refused);
      const snapshot = deps.mirror?.snapshotOf("Contacts/Piet.md");
      expect(JSON.stringify(snapshot)).toContain("Contacts/Jan.md");
      expect(JSON.stringify(snapshot)).toContain("Contacts/Sem.md");
    } finally {
      state.mirror = false;
    }
  });
});
