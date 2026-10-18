import { App, Modal } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client"

interface FileExistsModalProps {
	filePath: string;
	onClose: () => void;
	onAction: (action: "replace" | "skip") => void;
}


const FileExistsModalContent: React.FC<FileExistsModalProps> = ({ filePath, onClose, onAction }) => {
	return (
		<div className="contact-modal'">
			<p>The file "{filePath}" already exists. What would you like to do?</p>
			<div className="contact-modal-buttons">
				<button className="mod-cta"
					onClick={() => {
						onAction("skip");
						onClose();
					}}
				>
					Skip
				</button>
				<button
					onClick={() => {
						onAction("replace");
						onClose();
					}}
				>
					Replace
				</button>
			</div>
		</div>
	);
};

export class FileExistsModal extends Modal {
	filePath: string;
	callback?: (action: "replace" | "skip") => void;
	private reactRoot: Root | null = null;
	private answered = false;

	constructor(app: App, filePath:string, callback?: (action: "replace" | "skip") => void) {
		super(app);
		this.filePath = filePath;
		this.callback = callback;
	}

	onOpen() {
		this.titleEl.setText("File Exists");

		// Create React root and render
		this.reactRoot = createRoot(this.contentEl);
		this.reactRoot.render(
			<FileExistsModalContent
				filePath={this.filePath}
				onAction={(action) => {
					this.answered = true;
					this.callback?.(action);
				}}
				onClose={() => this.close()}
			/>
		);
	}

	onClose() {
		this.reactRoot?.unmount();
		// Closing the dialog without choosing counts as Skip, so whoever waits for the answer is released.
		if (!this.answered) {
			this.answered = true;
			this.callback?.("skip");
		}
	}
}
