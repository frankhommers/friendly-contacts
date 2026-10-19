import { App, FuzzyMatch, FuzzySuggestModal } from "obsidian";
import { MeCandidate, meCandidates } from "src/graph/vaultGraph";

/** Picks the contact that is the vault owner ("This is me"). Only contacts with a UID are listed. */
export class MePickerModal extends FuzzySuggestModal<MeCandidate> {
  private items: MeCandidate[];

  constructor(app: App, private onPick: (candidate: MeCandidate) => void) {
    super(app);
    this.items = meCandidates(app);
    this.setPlaceholder("Choose yourself (only contacts with a UID are listed)…");
    this.emptyStateText = "No contacts with a UID. Sync or import a contact to give it one.";
  }

  getItems(): MeCandidate[] {
    return this.items;
  }

  getItemText(item: MeCandidate): string {
    return item.name;
  }

  renderSuggestion(match: FuzzyMatch<MeCandidate>, el: HTMLElement): void {
    el.setText(match.item.name);
  }

  onChooseItem(item: MeCandidate): void {
    this.onPick(item);
  }
}
