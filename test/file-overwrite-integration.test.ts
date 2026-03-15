// Suite: File overwrite warning (integration)
// Scope: Unit
// Spec: TASK-30 — [P5-S3] Warn before overwriting local file with remote content

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Track fs calls for assertions
const mockExistsSync = vi.fn();
const mockStatSync = vi.fn();
const mockOpen = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock("fs", () => ({
	existsSync: (...args: any[]) => mockExistsSync(...args),
	readFileSync: vi.fn().mockReturnValue(""),
	statSync: (...args: any[]) => mockStatSync(...args),
	open: (...args: any[]) => mockOpen(...args),
	mkdirSync: (...args: any[]) => mockMkdirSync(...args),
}));

vi.mock("y-indexeddb", () => ({
	IndexeddbPersistence: class {
		once(_event: string, cb: () => void) {
			setTimeout(cb, 0);
		}
		destroy() {}
	},
}));

// Capture the "update" handler registered on the Y.Doc
let capturedUpdateHandler: ((...args: any[]) => void) | null = null;

vi.mock("yjs", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	const OriginalDoc = actual.Doc;
	class MockDoc extends OriginalDoc {
		on(event: string, handler: (...args: any[]) => void) {
			if (event === "update") {
				capturedUpdateHandler = handler;
			}
			return super.on(event, handler);
		}
	}
	return { ...actual, Doc: MockDoc };
});

vi.mock("y-websocket", () => ({
	WebsocketProvider: class {
		awareness = { setLocalStateField: vi.fn() };
		params: Record<string, string> = {};
		on = vi.fn();
		connect = vi.fn();
		disconnect = vi.fn();
		destroy = vi.fn();
		wsconnected = false;
		synced = false;
	},
}));

// Modal mock that captures the decision resolver
let lastModalPath: string | null = null;
let lastModalResolve: ((value: "keep" | "accept") => void) | null = null;
const modalInstances: Array<{
	path: string;
	resolve: (value: "keep" | "accept") => void;
}> = [];

vi.mock("obsidian", () => ({
	Notice: class {
		constructor(_msg: string) {}
	},
	App: class {},
	Modal: class {
		contentEl = {
			empty: () => {},
			createEl: () => ({ onClickEvent: () => {}, style: {} }),
			createDiv: () => ({
				style: {},
				createEl: () => ({ onClickEvent: () => {}, style: {} }),
			}),
		};
		modalEl = { addClass: () => {} };
		open() {}
		close() {}
	},
}));

// Mock the FileOverwriteWarningModal to capture decisions
vi.mock("../src/fileOverwriteModal", () => ({
	FileOverwriteWarningModal: class {
		decision: Promise<"keep" | "accept">;
		private _path: string;
		constructor(_app: any, path: string) {
			this._path = path;
			this.decision = new Promise((resolve) => {
				lastModalPath = path;
				lastModalResolve = resolve;
				modalInstances.push({ path, resolve });
			});
		}
		open() {}
		close() {}
		onOpen() {}
		onClose() {}
	},
}));

import * as Y from "yjs";
import { SharedFolder } from "../src/sharedTypes";

function makeSharedFolder() {
	const mockPlugin = {
		settings: {
			serverUrl: "https://example.com",
			username: "test-user",
			sharedFolders: [],
		},
		authManager: { getAccessToken: vi.fn().mockResolvedValue("tok") },
		apiClient: { getMyRole: vi.fn().mockResolvedValue({ role: "EDITOR" }) },
		app: {
			vault: {
				getFiles: () => [],
				adapter: { trashLocal: vi.fn() },
			},
		},
	};

	const folder = new SharedFolder(
		{ guid: "room-1", path: "shared", name: "Test Room" },
		"/vault",
		mockPlugin as any,
	);

	return { folder, mockPlugin };
}

function triggerUpdate(folder: SharedFolder) {
	if (!capturedUpdateHandler) throw new Error("No update handler captured");
	capturedUpdateHandler(new Uint8Array(), null, folder.root);
}

describe("SharedFolder file overwrite decisions", () => {
	beforeEach(() => {
		capturedUpdateHandler = null;
		lastModalPath = null;
		lastModalResolve = null;
		modalInstances.length = 0;
		mockExistsSync.mockReset();
		mockStatSync.mockReset();
		mockOpen.mockReset();
		mockMkdirSync.mockReset();
	});

	it("creates files without a modal when file does not exist", () => {
		mockExistsSync.mockReturnValue(false);

		const { folder } = makeSharedFolder();
		folder.ids.set("shared/new.md", "guid-1");
		triggerUpdate(folder);

		expect(mockOpen).toHaveBeenCalled();
		expect(lastModalPath).toBeNull();
		expect(folder.isFileKept("shared/new.md")).toBe(false);
	});

	it("proceeds without a modal when file exists but is empty", () => {
		mockExistsSync.mockReturnValue(true);
		mockStatSync.mockReturnValue({ size: 0 });

		const { folder } = makeSharedFolder();
		folder.ids.set("shared/empty.md", "guid-2");
		triggerUpdate(folder);

		expect(lastModalPath).toBeNull();
		expect(folder.isFileKept("shared/empty.md")).toBe(false);
	});

	it("shows modal when file exists with non-empty content", () => {
		mockExistsSync.mockReturnValue(true);
		mockStatSync.mockReturnValue({ size: 42 });

		const { folder } = makeSharedFolder();
		folder.ids.set("shared/notes.md", "guid-3");
		triggerUpdate(folder);

		expect(lastModalPath).toBe("shared/notes.md");
		expect(folder.isFileKept("shared/notes.md")).toBe(true); // pending = kept
	});

	it("isFileKept returns false after user accepts", async () => {
		mockExistsSync.mockReturnValue(true);
		mockStatSync.mockReturnValue({ size: 42 });

		const { folder } = makeSharedFolder();
		folder.ids.set("shared/notes.md", "guid-3");
		triggerUpdate(folder);

		expect(folder.isFileKept("shared/notes.md")).toBe(true);

		lastModalResolve!("accept");
		// Let the promise resolve
		await new Promise((r) => setTimeout(r, 0));

		expect(folder.isFileKept("shared/notes.md")).toBe(false);
	});

	it("isFileKept returns true after user keeps", async () => {
		mockExistsSync.mockReturnValue(true);
		mockStatSync.mockReturnValue({ size: 42 });

		const { folder } = makeSharedFolder();
		folder.ids.set("shared/notes.md", "guid-3");
		triggerUpdate(folder);

		lastModalResolve!("keep");
		await new Promise((r) => setTimeout(r, 0));

		expect(folder.isFileKept("shared/notes.md")).toBe(true);
	});

	it("does not show modal a second time for the same path", () => {
		mockExistsSync.mockReturnValue(true);
		mockStatSync.mockReturnValue({ size: 42 });

		const { folder } = makeSharedFolder();
		folder.ids.set("shared/notes.md", "guid-3");
		triggerUpdate(folder);

		expect(modalInstances).toHaveLength(1);

		// Trigger another update — should not show a second modal
		triggerUpdate(folder);

		expect(modalInstances).toHaveLength(1);
	});

	it("queues modals sequentially for multiple conflicting files", async () => {
		// First call: file exists with content for both paths
		mockExistsSync.mockReturnValue(true);
		mockStatSync.mockReturnValue({ size: 100 });

		const { folder } = makeSharedFolder();
		folder.ids.set("shared/a.md", "guid-a");
		folder.ids.set("shared/b.md", "guid-b");
		triggerUpdate(folder);

		// Only the first modal should be shown immediately
		expect(modalInstances).toHaveLength(1);
		const firstPath = modalInstances[0].path;

		// Resolve the first modal
		modalInstances[0].resolve("accept");
		await new Promise((r) => setTimeout(r, 0));

		// Now the second modal should appear
		expect(modalInstances).toHaveLength(2);
		const secondPath = modalInstances[1].path;

		// Both paths were prompted (in some order)
		expect(new Set([firstPath, secondPath])).toEqual(
			new Set(["shared/a.md", "shared/b.md"]),
		);
	});

	it("fires onAccept callback when user accepts", async () => {
		mockExistsSync.mockReturnValue(true);
		mockStatSync.mockReturnValue({ size: 42 });

		const { folder } = makeSharedFolder();
		const acceptedPaths: string[] = [];
		folder.onAccept((path) => acceptedPaths.push(path));

		folder.ids.set("shared/notes.md", "guid-3");
		triggerUpdate(folder);

		lastModalResolve!("accept");
		await new Promise((r) => setTimeout(r, 0));

		expect(acceptedPaths).toEqual(["shared/notes.md"]);
	});

	it("does not fire onAccept callback when user keeps", async () => {
		mockExistsSync.mockReturnValue(true);
		mockStatSync.mockReturnValue({ size: 42 });

		const { folder } = makeSharedFolder();
		const acceptedPaths: string[] = [];
		folder.onAccept((path) => acceptedPaths.push(path));

		folder.ids.set("shared/notes.md", "guid-3");
		triggerUpdate(folder);

		lastModalResolve!("keep");
		await new Promise((r) => setTimeout(r, 0));

		expect(acceptedPaths).toEqual([]);
	});
});
