import { App, Modal, Notice } from "obsidian";
import { MappingRow } from "src/contacts/friendly/mapping";
import { findOneSided, relationSnapshot } from "src/contacts/friendly/relations";
import { obsidianMirrorEnv } from "src/contacts/obsidianNotes";
import { addOtherSide, OneSidedItem, removeRelation } from "src/contacts/relationMirror";

const baseName = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

/** One-sided relationships in the contact notes: `Jan -> children -> Sem` with a fix per item. */
export function oneSidedRelations(app: App, rows: MappingRow[]): OneSidedItem[] {
	const env = obsidianMirrorEnv(app);
	const all = env.listContacts().map(({ path, frontmatter }) => ({
		path,
		snapshot: relationSnapshot(frontmatter, rows, (link) => env.resolveLink(link, path)),
	}));
	return findOneSided(all, rows);
}

export class CheckRelationsModal extends Modal {
	constructor(
		app: App,
		private items: OneSidedItem[],
		private rows: () => MappingRow[],
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText("Check relationships");
		this.render();
	}

	private render() {
		const { contentEl } = this;
		contentEl.empty();
		if (this.items.length === 0) {
			contentEl.createEl("p", { text: "All relationships are two-sided." });
			return;
		}
		contentEl.createEl("p", { text: "These relationships are only noted on one side." });
		const list = contentEl.createDiv({ cls: "vcf-relations-list" });
		for (const item of this.items) {
			const row = list.createDiv({ cls: "setting-item" });
			const info = row.createDiv({ cls: "setting-item-info" });
			info.createDiv({ cls: "setting-item-name", text: `${baseName(item.path)} → ${item.property} → ${baseName(item.target)}` });
			const control = row.createDiv({ cls: "setting-item-control" });
			control.createEl("button", { text: "Add the other side", cls: "mod-cta" }).addEventListener("click", () => {
				void this.fix(item, async () => {
					const result = await addOtherSide(obsidianMirrorEnv(this.app), this.rows(), item);
					if (result === "blocked") {
						new Notice(`${baseName(item.target)} already has a different value; nothing changed.`);
						return false;
					}
					return true;
				});
			});
			control.createEl("button", { text: "Remove" }).addEventListener("click", () => {
				void this.fix(item, async () => {
					await removeRelation(obsidianMirrorEnv(this.app), this.rows(), item);
					return true;
				});
			});
		}
	}

	private async fix(item: OneSidedItem, action: () => Promise<boolean>) {
		try {
			if (!(await action())) return;
		} catch (error) {
			new Notice(`Could not change the note: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		this.items = this.items.filter((i) => i !== item);
		this.render();
	}

	onClose() {
		this.contentEl.empty();
	}
}
