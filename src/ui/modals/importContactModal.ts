import { App, FuzzyMatch, FuzzySuggestModal, Notice } from "obsidian";
import { contactNotes, importRemoteCard, RemoteContact, remoteContacts } from "src/contacts/obsidianNotes";
import { getSettings } from "src/context/sharedSettingsContext";
import { activeSources } from "src/sync/adapters";
import { sync } from "src/sync";
import { importCandidates } from "src/sync/sources";
import { cleanUid } from "src/util/vcard";

/** Picks one card from the address books' servers and imports it as a note. One pick per open. */
export class ImportContactModal extends FuzzySuggestModal<RemoteContact> {
  private picked = false;

  constructor(app: App, private items: RemoteContact[]) {
    super(app);
    this.setPlaceholder("Import contact from server…");
  }

  getItems(): RemoteContact[] {
    return this.items;
  }

  getItemText(item: RemoteContact): string {
    return item.fileName;
  }

  /** `<fileName> · <source name>`, plus ` · <org>` when the card has one. */
  private label(item: RemoteContact): string {
    const source = getSettings().sources.find((s) => s.id === item.sourceId);
    return [item.fileName, ...(source ? [source.name] : []), ...(item.org ? [item.org] : [])].join(" · ");
  }

  renderSuggestion(match: FuzzyMatch<RemoteContact>, el: HTMLElement): void {
    el.setText(this.label(match.item));
  }

  onChooseItem(item: RemoteContact): void {
    if (this.picked) return;
    this.picked = true;
    void importFromServer(this.app, item);
  }
}

export async function importFromServer(app: App, item: RemoteContact): Promise<void> {
  const source = activeSources().find((s) => s.id === item.sourceId);
  if (!source) {
    new Notice("That address book is no longer enabled.");
    return;
  }
  try {
    const pulled = await sync.pullFromRemote(source, item.href);
    if (!pulled) {
      new Notice(`Could not read ${item.fileName} from ${source.name}.`);
      return;
    }
    const outcome = await importRemoteCard(app, pulled, item, source);
    if (outcome === "imported") new Notice(`Imported ${item.fileName} from ${source.name}.`);
    else if (outcome === "skipped") new Notice(`${item.fileName} was not imported: a note with that name already exists.`);
    else new Notice(`Skipped ${item.fileName}: the card has no name.`);
  } catch (error) {
    console.error("Friendly Contacts: importing from the server failed", error);
    new Notice(`Importing ${item.fileName} failed, see console`);
  }
}

/** The "Import contact from server…" action: lists the cards without a note, then opens the picker. */
export async function openImportContactModal(app: App): Promise<void> {
  const noteUids = contactNotes(app).flatMap(({ uid }) => (uid === undefined ? [] : [cleanUid(uid)]));
  const candidates = importCandidates(await remoteContacts(), noteUids);
  if (candidates.length === 0) {
    new Notice("No contacts to import");
    return;
  }
  new ImportContactModal(app, candidates).open();
}
