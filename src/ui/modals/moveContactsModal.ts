import { App, Modal, Notice, Setting } from "obsidian";
import { moveContacts, reportMove } from "src/contacts/obsidianNotes";
import { normalizeFolder } from "src/contacts/moveContacts";
import { FolderSuggest } from "src/settings/FolderSuggest";
import { ConfirmModal } from "src/ui/modals/confirmModal";

/** Asks to move `count` contacts from one folder to another; the move only runs on confirm. */
export function confirmMoveContacts(
  app: App,
  count: number,
  fromFolder: string,
  toFolder: string,
  onDecline?: () => void,
  cancelLabel = "Cancel",
  onResult?: (result: { moved: number }) => void,
): void {
  const label = (folder: string) => (normalizeFolder(folder) === "" ? "the vault root" : normalizeFolder(folder));
  const modal = new ConfirmModal(
    app,
    `Move ${count} contacts from ${label(fromFolder)} to ${label(toFolder)}?`,
    "Move",
    async () => {
      try {
        const result = await moveContacts(app, toFolder, fromFolder);
        reportMove(result, normalizeFolder(toFolder));
        onResult?.(result);
      } catch (error) {
        console.error("Friendly Contacts: moving contacts failed", error);
        new Notice("Moving contacts failed, see console");
        onResult?.({ moved: 0 });
      }
    },
    cancelLabel,
    onDecline,
  );
  modal.open();
}

/** The "Move contacts to folder…" command: pick a folder, then confirm. */
export class MoveContactsModal extends Modal {
  private target = "";

  constructor(app: App, private countContacts: () => number, private currentFolder: () => string) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("Move contacts to folder");
    new Setting(this.contentEl)
      .setName("Folder")
      .setDesc("The folder must exist. Sub-folders keep their place.")
      .addSearch((search) => {
        new FolderSuggest(this.app, search.inputEl, (folder) => {
          search.setValue(folder);
          this.target = folder;
        });
        search.setPlaceholder("Example: Areas/People").onChange((value) => (this.target = value));
      });
    new Setting(this.contentEl).addButton((button) =>
      button.setButtonText("Move").setCta().onClick(() => {
        const target = normalizeFolder(this.target);
        if (target === "" || !this.app.vault.getFolderByPath(target)) {
          new Notice("Pick an existing folder.");
          return;
        }
        if (target === normalizeFolder(this.currentFolder())) {
          new Notice(`Contacts are already in ${target}`);
          return;
        }
        this.close();
        confirmMoveContacts(this.app, this.countContacts(), this.currentFolder(), target);
      }),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
