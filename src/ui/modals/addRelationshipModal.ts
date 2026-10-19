import { App, FuzzyMatch, FuzzySuggestModal, Notice, SuggestModal, TFile } from "obsidian";
import { MappingRow } from "src/contacts/friendly/mapping";
import { contactDisplayName } from "src/contacts/layoutNotes";
import { contactNotes, obsidianMirrorEnv } from "src/contacts/obsidianNotes";
import { addRelation, otherSideTaken, planAdd } from "src/contacts/relationEdit";
import { getSettings } from "src/context/sharedSettingsContext";
import { ConfirmModal } from "src/ui/modals/confirmModal";

export interface PickableContact {
  path: string;
  name: string;
}

/** Every contact note except the contact itself, sorted by name. */
export function pickableContacts(notes: PickableContact[], selfPath: string): PickableContact[] {
  return notes
    .filter((note) => note.path !== selfPath)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.path.localeCompare(b.path));
}

type RelationRow = Extract<MappingRow, { kind: "relation" }>;

const relationRows = (): RelationRow[] =>
  getSettings().friendly.mapping.filter((row): row is RelationRow => row.kind === "relation");

/** The contact's name as the vault shows it: its `name` property, else its name in the layout. */
export function nameOfPath(app: App, path: string): string {
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? contactDisplayName(app, file) : path.replace(/^.*\//, "").replace(/\.md$/, "");
}

/** Step 2: which relationship the picked contact is to this one. */
class RelationRowModal extends SuggestModal<RelationRow> {
  constructor(
    app: App,
    private contactPath: string,
    private target: PickableContact,
  ) {
    super(app);
    this.setPlaceholder(`${target.name} is this contact's…`);
  }

  private label(row: RelationRow): string {
    return `${row.property} (${row.types[0]})`;
  }

  getSuggestions(query: string): RelationRow[] {
    const wanted = query.trim().toLowerCase();
    return relationRows().filter((row) => this.label(row).toLowerCase().includes(wanted));
  }

  renderSuggestion(row: RelationRow, el: HTMLElement): void {
    el.setText(this.label(row));
  }

  onChooseSuggestion(row: RelationRow): void {
    void applyRelation(this.app, this.contactPath, this.target, row.property);
  }
}

async function applyRelation(app: App, contactPath: string, target: PickableContact, property: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(contactPath);
  if (!(file instanceof TFile)) {
    new Notice("That contact note is gone.");
    return;
  }
  const env = obsidianMirrorEnv(app);
  const rows = getSettings().friendly.mapping;
  const nameOf = (path: string) => nameOfPath(app, path);
  const frontmatterOf = (note: unknown) =>
    note instanceof TFile ? { ...(app.metadataCache.getFileCache(note)?.frontmatter ?? {}) } : {};
  const frontmatter = frontmatterOf(file);
  const taken = otherSideTaken(
    env,
    rows,
    contactPath,
    property,
    target.path,
    frontmatterOf(app.vault.getAbstractFileByPath(target.path)),
    nameOf,
  );
  // The mirror never overwrites a single relation that names someone else.
  const takenText =
    taken === undefined
      ? ""
      : `${target.name} already has ${taken.name} as ${taken.property}, so ${target.name}'s ${taken.property} stays as it is.`;
  /** `tell`: say afterwards that the other side stayed as it was (not when the confirm already said so). */
  const add = async (replacing?: string, tell = true) => {
    try {
      await addRelation(env, rows, contactPath, property, target.path, replacing);
    } catch (error) {
      console.error("Friendly Contacts: adding the relationship failed", error);
      new Notice(`Adding ${target.name} failed, see console`);
      return;
    }
    if (tell && takenText !== "") new Notice(`Added ${target.name} as ${property}. ${takenText}`);
  };
  const plan = planAdd(env, rows, contactPath, frontmatter, property, target.path, nameOf);
  if (plan === "exists") new Notice(`${target.name} is already listed under ${property}.`);
  else if (plan === "added") await add();
  // An unlinked entry with this contact's name is the same person: link it up without asking.
  else if (plan.sameName) await add(plan.text);
  else {
    const message = `Replace ${plan.replaces} with ${target.name} as ${property}?${takenText === "" ? "" : ` ${takenText}`}`;
    new ConfirmModal(app, message, "Replace", () => void add(plan.text, false)).open();
  }
}

/** Step 1: pick the contact to relate to; then the kind of relationship. */
export class AddRelationshipModal extends FuzzySuggestModal<PickableContact> {
  constructor(
    app: App,
    private contactPath: string,
  ) {
    super(app);
    this.setPlaceholder("Add relationship to…");
  }

  getItems(): PickableContact[] {
    return pickableContacts(
      contactNotes(this.app).map(({ file }) => ({ path: file.path, name: contactDisplayName(this.app, file) })),
      this.contactPath,
    );
  }

  getItemText(item: PickableContact): string {
    return item.name;
  }

  renderSuggestion(match: FuzzyMatch<PickableContact>, el: HTMLElement): void {
    el.setText(match.item.name);
  }

  onChooseItem(item: PickableContact): void {
    new RelationRowModal(this.app, this.contactPath, item).open();
  }
}
