import { App, Modal } from "obsidian";

/** A question with a confirm and a cancel button; `onConfirm` runs only on confirm. */
export class ConfirmModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private title: string,
		private confirmLabel: string,
		private onConfirm: () => void,
		private cancelLabel = "Cancel",
		/** Runs when the modal closes without a confirm (cancel button or Escape). */
		private onCancel?: () => void,
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(this.title);
		const buttons = this.contentEl.createDiv({ cls: "contact-modal-buttons" });
		buttons.createEl("button", { text: this.confirmLabel, cls: "mod-cta" }).addEventListener("click", () => {
			this.confirmed = true;
			this.close();
			this.onConfirm();
		});
		buttons.createEl("button", { text: this.cancelLabel }).addEventListener("click", () => this.close());
	}

	onClose() {
		this.contentEl.empty();
		if (!this.confirmed) this.onCancel?.();
	}
}
