import type { App } from "obsidian";

/**
 * The settings object of the Folder Notes plugin when it is installed and enabled, otherwise undefined.
 * Reads Obsidian's undocumented plugin registry, so it never throws.
 */
export function folderNotesSettings(app: App): unknown | undefined {
  try {
    const plugins = (app as any).plugins;
    if (!plugins?.enabledPlugins?.has?.("folder-notes")) return undefined;
    const settings = plugins.getPlugin?.("folder-notes")?.settings;
    return settings ?? undefined;
  } catch {
    return undefined;
  }
}
