import { MarkdownView, Menu, Notice, Plugin, TAbstractFile } from "obsidian";
import { isContactNoteFile } from "src/contacts/obsidianNotes";
import { settings } from "src/context/sharedSettingsContext";
import { sync } from "src/sync";
import { isSyncAvailable } from "src/sync/adapters";
import { ViewActionTracker } from "src/ui/viewActionTracker";

const ICON = "refresh-cw";
const TITLE = "Sync contact";

/** Runs the same Sync as the "Sync this contact" command, for this file. Returns false when it cannot be synced. */
export function syncContactNote(plugin: Plugin, file: TAbstractFile | null | undefined): boolean {
  if (!isContactNoteFile(plugin.app, file) || !isSyncAvailable()) return false;
  void sync.syncContact(file);
  return true;
}

/**
 * Sync on an open contact note: a header icon on every Markdown view showing a contact note, and an item in the
 * note's menu. Both only while an address book is set up. Everything is removed again when the plugin unloads.
 */
export function registerNoteSyncAction(plugin: Plugin): void {
  const { app } = plugin;
  const { workspace, metadataCache } = app;

  const tracker = new ViewActionTracker<MarkdownView, HTMLElement>((view) =>
    // The view can show another note by the time of the click, so the file is read then.
    view.addAction(ICON, TITLE, () => {
      if (!syncContactNote(plugin, view.file)) {
        new Notice("Open a contact note first.");
        reconcile();
      }
    }),
  );

  const reconcile = () => {
    const wanted: MarkdownView[] = [];
    if (isSyncAvailable()) {
      for (const leaf of workspace.getLeavesOfType("markdown")) {
        if (leaf.view instanceof MarkdownView && isContactNoteFile(app, leaf.view.file)) wanted.push(leaf.view);
      }
    }
    tracker.reconcile(wanted);
  };

  plugin.registerEvent(workspace.on("file-open", reconcile));
  plugin.registerEvent(workspace.on("active-leaf-change", reconcile));
  plugin.registerEvent(workspace.on("layout-change", reconcile));
  // A note becomes (or stops being) a contact by editing its properties; the cache is also empty until it is resolved.
  plugin.registerEvent(metadataCache.on("changed", reconcile));
  plugin.registerEvent(metadataCache.on("resolved", reconcile));
  // Address books enabled or disabled, a changed contacts folder: both are settings.
  plugin.register(settings.subscribe(reconcile));
  plugin.register(() => tracker.clear());
  workspace.onLayoutReady(reconcile);

  plugin.registerEvent(workspace.on("file-menu", (menu: Menu, file) => {
    if (!isSyncAvailable() || !isContactNoteFile(app, file)) return;
    menu.addItem((item) => item.setTitle(TITLE).setIcon(ICON).onClick(() => { syncContactNote(plugin, file); }));
  }));
}
