import { AbstractInputSuggest, App, TFolder } from 'obsidian';
import { updateSetting } from "src/context/sharedSettingsContext";
import { insightQueueStore } from "src/insights/insightsQueStore";

export class FolderSuggest extends AbstractInputSuggest<string> {
  folders: string[];
  private inputEl: HTMLInputElement;

  /** With `onSelect` the caller decides what picking a folder does; without it the contacts folder setting changes. */
  constructor(app: App, inputEl: HTMLInputElement, private selectHandler?: (folder: string) => void) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.folders = this.getAllFolderPaths().filter(folder => folder.toLowerCase() !== '/');
  }

  getAllFolderPaths(): string[] {
    const folders = this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder) as TFolder[];
    return folders.map(f => f.path);
  }

  getSuggestions(inputStr: string): string[] {
    return this.folders.filter(folder => folder.toLowerCase().includes(inputStr.toLowerCase()));
  }

  renderSuggestion(folder: string, el: HTMLElement): void {
    el.setText(folder);
  }

  selectSuggestion(folder: string): void {
    this.inputEl.value = folder;
    this.inputEl.trigger('input');
    // Trim folder and Strip ending slash if there
    let value = folder.trim()
    value = value.replace(/\/$/, "");
    if (this.selectHandler) {
      this.selectHandler(value);
      this.close();
      return;
    }
    updateSetting('contactsFolder', value);
    insightQueueStore.clear();
    this.close();
  }

}
