import { App, Modal } from "obsidian";

export type OverwriteDecision = "keep" | "accept";

export class FileOverwriteWarningModal extends Modal {
	readonly decision: Promise<OverwriteDecision>;
	private _resolve: (value: OverwriteDecision) => void;
	private _resolved = false;
	private _path: string;

	constructor(app: App, path: string) {
		super(app);
		this._path = path;
		this.decision = new Promise((resolve) => {
			this._resolve = resolve;
		});
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		modalEl.addClass("modal-style-multiplayer");
		contentEl.empty();

		contentEl.createEl("h2", { text: "File conflict" });
		contentEl.createEl("p", {
			text: `"${this._path}" already exists in your vault with local content.`,
		});
		contentEl.createEl("p", {
			text: "Accepting the remote version will overwrite your local changes.",
		});

		const btnContainer = contentEl.createDiv();
		btnContainer.style.display = "flex";
		btnContainer.style.gap = "8px";
		btnContainer.style.marginTop = "12px";

		const keepBtn = btnContainer.createEl("button", {
			text: "Keep local file",
		});
		keepBtn.onClickEvent(() => this._decide("keep"));

		const acceptBtn = btnContainer.createEl("button", {
			text: "Accept remote",
			cls: "mod-warning",
		});
		acceptBtn.onClickEvent(() => this._decide("accept"));
	}

	private _decide(choice: OverwriteDecision): void {
		if (!this._resolved) {
			this._resolved = true;
			this._resolve(choice);
		}
		this.close();
	}

	onClose() {
		if (!this._resolved) {
			this._resolved = true;
			this._resolve("keep");
		}
		this.contentEl.empty();
	}
}
