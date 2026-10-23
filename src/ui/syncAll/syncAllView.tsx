/** The Sync all tab: scans every contact note when it opens and shows the worklist (see `SyncAllPanel`). */

import { type App, ItemView, TFile, type WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { serverOnlyLookup, syncAllDeps } from "src/sync/sync";
import { SyncAll } from "src/sync/syncAll";
import { linkDisplayName } from "src/sync/reviewDisplay";
import { SyncAllPanel } from "src/ui/syncAll/syncAllPanel";
import { SYNC_ALL_VIEW } from "src/util/constants";

export class SyncAllView extends ItemView {
  private root: Root | undefined;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return SYNC_ALL_VIEW.type;
  }

  getDisplayText(): string {
    return SYNC_ALL_VIEW.name;
  }

  getIcon(): string {
    return SYNC_ALL_VIEW.icon;
  }

  async onOpen(): Promise<void> {
    const app = this.app;
    this.contentEl.empty();
    this.contentEl.addClass("friendly-sync-all-view");
    const model = new SyncAll(syncAllDeps(app));
    const serverOnly = async (path: string) => {
      const file = app.vault.getAbstractFileByPath(path);
      return file instanceof TFile ? serverOnlyLookup(app, file) : () => [];
    };
    this.root = createRoot(this.contentEl);
    this.root.render(<SyncAllPanel model={model} linkName={linkDisplayName} serverOnly={serverOnly} />);
    // Scanning reads every address book: wait until Obsidian knows every note.
    app.workspace.onLayoutReady(() => {
      model.scan().catch((error) => console.error("Sync all: the scan failed", error));
    });
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = undefined;
    this.contentEl.empty();
  }
}

/** Opens the Sync all tab (the open one, else a new tab) and shows it. */
export async function openSyncAll(app: App): Promise<void> {
  const existing = app.workspace.getLeavesOfType(SYNC_ALL_VIEW.type)[0];
  const leaf = existing ?? app.workspace.getLeaf("tab");
  if (!existing) await leaf.setViewState({ type: SYNC_ALL_VIEW.type, active: true });
  await app.workspace.revealLeaf(leaf);
}
