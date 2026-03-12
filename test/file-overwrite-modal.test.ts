import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian");

import { App } from "obsidian";
import { FileOverwriteWarningModal } from "../src/fileOverwriteModal";

function mockEl(): any {
	return {
		empty: vi.fn(),
		style: {},
		addClass: vi.fn(),
		createEl: vi.fn((_tag: string, opts?: any) => {
			const el = mockEl();
			if (opts?.text) el._text = opts.text;
			return el;
		}),
		createDiv: vi.fn((opts?: any) => mockEl()),
		onClickEvent: vi.fn(),
	};
}

function makeModal(path = "shared/notes.md") {
	const app = new App();
	const modal = new FileOverwriteWarningModal(app, path);
	// Ensure DOM elements are available (mock may not set them)
	if (!modal.contentEl) (modal as any).contentEl = mockEl();
	if (!modal.modalEl) (modal as any).modalEl = mockEl();
	return modal;
}

describe("FileOverwriteWarningModal", () => {
	it("exposes a decision promise", () => {
		const modal = makeModal();
		expect(modal.decision).toBeInstanceOf(Promise);
	});

	it("resolves with 'keep' when closed without clicking a button", async () => {
		const modal = makeModal();
		modal.onClose();
		const result = await modal.decision;
		expect(result).toBe("keep");
	});

	it("only resolves once even if close is called multiple times", async () => {
		const modal = makeModal();
		modal.onClose();
		modal.onClose();
		const result = await modal.decision;
		expect(result).toBe("keep");
	});

	it("onOpen renders the expected UI elements", () => {
		const modal = makeModal("myFolder/doc.md");
		const created: string[] = [];
		(modal as any).contentEl = {
			empty: vi.fn(),
			createEl: vi.fn((_tag: string, opts?: any) => {
				if (opts?.text) created.push(opts.text);
				return {
					onClickEvent: vi.fn(),
					style: {},
				};
			}),
			createDiv: vi.fn(() => ({
				style: {},
				createEl: vi.fn((_tag: string, opts?: any) => {
					if (opts?.text) created.push(opts.text);
					return {
						onClickEvent: vi.fn(),
						style: {},
					};
				}),
			})),
		};

		modal.onOpen();

		expect(created).toContain("File conflict");
		expect(created.some((t) => t.includes("myFolder/doc.md"))).toBe(true);
		expect(created).toContain("Keep local file");
		expect(created).toContain("Accept remote");
	});

	it("resolves with 'keep' when Keep local file button is clicked", async () => {
		const modal = makeModal();
		const clickHandlers: Record<string, () => void> = {};
		(modal as any).contentEl = {
			empty: vi.fn(),
			createEl: vi.fn((_tag: string, opts?: any) => ({
				onClickEvent: vi.fn(),
				style: {},
			})),
			createDiv: vi.fn(() => ({
				style: {},
				createEl: vi.fn((_tag: string, opts?: any) => {
					const el = {
						onClickEvent: vi.fn((cb: () => void) => {
							if (opts?.text) clickHandlers[opts.text] = cb;
						}),
						style: {},
					};
					return el;
				}),
			})),
		};

		modal.onOpen();
		clickHandlers["Keep local file"]();
		const result = await modal.decision;
		expect(result).toBe("keep");
	});

	it("resolves with 'accept' when Accept remote button is clicked", async () => {
		const modal = makeModal();
		const clickHandlers: Record<string, () => void> = {};
		(modal as any).contentEl = {
			empty: vi.fn(),
			createEl: vi.fn((_tag: string, opts?: any) => ({
				onClickEvent: vi.fn(),
				style: {},
			})),
			createDiv: vi.fn(() => ({
				style: {},
				createEl: vi.fn((_tag: string, opts?: any) => {
					const el = {
						onClickEvent: vi.fn((cb: () => void) => {
							if (opts?.text) clickHandlers[opts.text] = cb;
						}),
						style: {},
					};
					return el;
				}),
			})),
		};

		modal.onOpen();
		clickHandlers["Accept remote"]();
		const result = await modal.decision;
		expect(result).toBe("accept");
	});
});
