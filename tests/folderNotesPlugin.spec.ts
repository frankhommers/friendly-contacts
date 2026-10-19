import type { App } from "obsidian";
import { folderNotesSettings } from "src/contacts/folderNotesPlugin";
import { describe, expect, it } from "vitest";

const appWith = (plugins: unknown) => ({ plugins }) as unknown as App;

describe("folderNotesSettings", () => {
  const settings = { folderNoteName: "{{folder_name}}" };
  const registry = (enabled: boolean) => ({
    enabledPlugins: new Set(enabled ? ["folder-notes"] : []),
    getPlugin: (id: string) => (id === "folder-notes" ? { settings } : null),
  });

  it("returns the settings of the enabled plugin", () => {
    expect(folderNotesSettings(appWith(registry(true)))).toBe(settings);
  });

  it("returns undefined when the plugin is disabled or missing", () => {
    expect(folderNotesSettings(appWith(registry(false)))).toBeUndefined();
    expect(folderNotesSettings(appWith({ enabledPlugins: new Set(["folder-notes"]), getPlugin: () => null }))).toBeUndefined();
  });

  it("never throws", () => {
    expect(folderNotesSettings(appWith(undefined))).toBeUndefined();
    expect(folderNotesSettings(appWith({}))).toBeUndefined();
    const throwing = { get enabledPlugins(): never { throw new Error("boom"); } };
    expect(folderNotesSettings(appWith(throwing))).toBeUndefined();
  });
});
