// Suite: SharedFolder & SharedDoc
// Scope: Unit
// Spec: TASK-6 — [P1-S4] Integrate y-websocket provider
//        TASK-13 — [P2-S6] Token injection into WebSocket connections
//        TASK-31 — [Testing-S2] Unit tests for P1 — Transport Migration

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── fs mock ──────────────────────────────────────────────────────────────────
const mockExistsSync = vi.fn().mockReturnValue(false);
const mockReadFileSync = vi.fn().mockReturnValue("");
const mockStatSync = vi.fn();
const mockOpen = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock("fs", () => ({
	existsSync: (...args: any[]) => mockExistsSync(...args),
	readFileSync: (...args: any[]) => mockReadFileSync(...args),
	statSync: (...args: any[]) => mockStatSync(...args),
	open: (...args: any[]) => mockOpen(...args),
	mkdirSync: (...args: any[]) => mockMkdirSync(...args),
}));

// ── y-indexeddb mock ─────────────────────────────────────────────────────────
vi.mock("y-indexeddb", () => ({
	IndexeddbPersistence: class {
		once(_event: string, cb: () => void) {
			setTimeout(cb, 0);
		}
		destroy = vi.fn();
	},
}));

// ── y-websocket mock with handler capture ────────────────────────────────────
vi.mock("y-websocket", () => {
	class MockWebsocketProvider {
		awareness = { setLocalStateField: vi.fn() };
		params: Record<string, string> = {};
		_handlers: Record<string, ((...args: any[]) => void)[]> = {};
		connect = vi.fn();
		disconnect = vi.fn();
		destroy = vi.fn();
		wsconnected = false;
		synced = false;
		off = vi.fn();

		on(event: string, handler: (...args: any[]) => void) {
			if (!this._handlers[event]) this._handlers[event] = [];
			this._handlers[event].push(handler);
		}
	}
	return { WebsocketProvider: MockWebsocketProvider };
});

// ── yjs mock — capture "update" handler on Y.Doc ────────────────────────────
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

// ── obsidian mock ────────────────────────────────────────────────────────────
const notices: string[] = [];

vi.mock("obsidian", () => ({
	Notice: class {
		constructor(msg: string) {
			notices.push(msg);
		}
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

vi.mock("../src/fileOverwriteModal", () => ({
	FileOverwriteWarningModal: class {
		decision: Promise<"keep" | "accept">;
		constructor(_app: any, _path: string) {
			this.decision = new Promise(() => {}); // never resolves — not the focus here
		}
		open() {}
		close() {}
	},
}));

import { SharedFolder, SharedDoc } from "../src/sharedTypes";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePlugin(overrides: any = {}) {
	return {
		settings: {
			serverUrl: "https://example.com",
			username: "test-user",
			sharedFolders: [] as any[],
			...overrides.settings,
		},
		authManager: {
			getAccessToken: vi.fn().mockResolvedValue("tok-123"),
			signOutWithAuthError: vi.fn(),
			...overrides.authManager,
		},
		apiClient: {
			getMyRole: vi.fn().mockResolvedValue({ role: "EDITOR" }),
			...overrides.apiClient,
		},
		app: {
			vault: {
				getFiles: () => [],
				adapter: { trashLocal: vi.fn() },
			},
			...overrides.app,
		},
		sharedFolders: [] as any[],
		saveSettings: vi.fn(),
		refreshIconStyles: vi.fn(),
	};
}

function makeSharedFolder(overrides: any = {}) {
	const plugin = makePlugin(overrides);
	const settings = {
		guid: "room-1",
		path: "shared",
		name: "Test Room",
		...overrides.folderSettings,
	};
	const folder = new SharedFolder(settings, "/vault", plugin as any);
	return { folder, plugin, settings };
}

function makeSharedDoc(overrides: any = {}) {
	const plugin = makePlugin(overrides);
	const parent = {
		plugin,
		settings: { guid: "room-guid", path: "shared/", name: "Room" },
		docs: new Map(),
		cachedRole: null,
	};
	const doc = new SharedDoc(
		overrides.path ?? "shared/test.md",
		overrides.guid ?? "doc-guid",
		parent as any,
	);
	return { doc, parent, plugin };
}

/** Provider type matching our mock shape */
interface MockProvider {
	awareness: { setLocalStateField: any };
	params: Record<string, string>;
	_handlers: Record<string, ((...args: any[]) => void)[]>;
	connect: any;
	disconnect: any;
	destroy: any;
	wsconnected: boolean;
	synced: boolean;
	off: any;
}

/** Get the provider from a SharedFolder or SharedDoc (private field) */
function getProvider(obj: any): MockProvider {
	return obj._provider;
}

/** Fire the "connection-close" handler on a provider */
function fireCloseEvent(provider: MockProvider, code: number | null) {
	const handlers = provider._handlers["connection-close"] ?? [];
	const event = code !== null ? ({ code } as CloseEvent) : null;
	for (const h of handlers) h(event);
}

function triggerUpdate(folder: SharedFolder) {
	if (!capturedUpdateHandler) throw new Error("No update handler captured");
	capturedUpdateHandler(new Uint8Array(), null, folder.root);
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	capturedUpdateHandler = null;
	notices.length = 0;
	mockExistsSync.mockReset().mockReturnValue(false);
	mockReadFileSync.mockReset().mockReturnValue("");
	mockStatSync.mockReset();
	mockOpen.mockReset();
	mockMkdirSync.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════════
// SharedFolder
// ═══════════════════════════════════════════════════════════════════════════

describe("SharedFolder", () => {
	describe("constructor", () => {
		it("wires up provider, persistence, and ids map", () => {
			const { folder } = makeSharedFolder();
			const provider = getProvider(folder);
			expect(provider).toBeDefined();
			// ids map is bound to the root Y.Doc
			expect(folder.ids).toBe(folder.root.getMap("docs"));
			// connection-close handler is registered
			expect(provider._handlers["connection-close"]?.length).toBe(1);
		});

		it("skips _connectWithAuth when serverUrl is empty", () => {
			const { plugin } = makeSharedFolder({
				settings: { serverUrl: "" },
			});
			// getAccessToken should never be called
			expect(plugin.authManager.getAccessToken).not.toHaveBeenCalled();
		});
	});

	describe("_connectWithAuth", () => {
		it("fetches token, sets params, and calls connect", async () => {
			const { folder, plugin } = makeSharedFolder();
			const provider = getProvider(folder);
			// _connectWithAuth runs async in constructor — wait a tick
			await new Promise((r) => setTimeout(r, 0));
			expect(plugin.authManager.getAccessToken).toHaveBeenCalled();
			expect(provider.params).toEqual({ token: "tok-123" });
			expect(provider.connect).toHaveBeenCalled();
		});

		it("calls _fetchRole after connecting", async () => {
			const { plugin } = makeSharedFolder();
			await new Promise((r) => setTimeout(r, 0));
			expect(plugin.apiClient.getMyRole).toHaveBeenCalledWith("room-1");
		});

		it("shows Notice and does not connect when token is null", async () => {
			const { folder } = makeSharedFolder({
				authManager: {
					getAccessToken: vi.fn().mockResolvedValue(null),
				},
			});
			await new Promise((r) => setTimeout(r, 0));
			const provider = getProvider(folder);
			expect(provider.connect).not.toHaveBeenCalled();
			expect(notices.some((n) => n.includes("Not signed in"))).toBe(true);
		});
	});

	describe("_fetchRole", () => {
		it("caches the role from the API response", async () => {
			const { folder } = makeSharedFolder();
			await new Promise((r) => setTimeout(r, 0));
			expect(folder.cachedRole).toBe("EDITOR");
		});

		it("propagates role to existing SharedDocs", async () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(false);
			// Create a doc before the async role fetch completes
			const doc = folder.createDoc("shared/test.md");
			expect(doc.role).toBeNull(); // role hasn't arrived yet
			// Let _fetchRole complete
			await new Promise((r) => setTimeout(r, 0));
			expect(doc.role).toBe("EDITOR");
		});

		it("silently ignores API errors", async () => {
			const { folder } = makeSharedFolder({
				apiClient: {
					getMyRole: vi.fn().mockRejectedValue(new Error("network")),
				},
			});
			await new Promise((r) => setTimeout(r, 0));
			// No Notice, no throw
			expect(folder.cachedRole).toBeNull();
			expect(notices).toHaveLength(0);
		});
	});

	describe("_handleCloseCode", () => {
		it("4001 → disconnect + signOut", () => {
			const { folder, plugin } = makeSharedFolder();
			const provider = getProvider(folder);
			fireCloseEvent(provider, 4001);
			expect(provider.disconnect).toHaveBeenCalled();
			expect(plugin.authManager.signOutWithAuthError).toHaveBeenCalled();
			expect(notices.some((n) => n.includes("Session expired"))).toBe(
				true,
			);
		});

		it("4003 → removeFromSettings", () => {
			const { folder, plugin } = makeSharedFolder();
			const provider = getProvider(folder);
			plugin.settings.sharedFolders.push(folder.settings);
			plugin.sharedFolders.push(folder);
			fireCloseEvent(provider, 4003);
			expect(provider.disconnect).toHaveBeenCalled();
			expect(plugin.saveSettings).toHaveBeenCalled();
			expect(notices.some((n) => n.includes("Access denied"))).toBe(true);
		});

		it("4004 → removeFromSettings", () => {
			const { folder, plugin } = makeSharedFolder();
			const provider = getProvider(folder);
			plugin.settings.sharedFolders.push(folder.settings);
			plugin.sharedFolders.push(folder);
			fireCloseEvent(provider, 4004);
			expect(provider.disconnect).toHaveBeenCalled();
			expect(plugin.saveSettings).toHaveBeenCalled();
			expect(notices.some((n) => n.includes("no longer exists"))).toBe(
				true,
			);
		});

		it("null event → no-op", () => {
			const { folder, plugin } = makeSharedFolder();
			const provider = getProvider(folder);
			// Fire null directly through the handler
			const handlers = provider._handlers["connection-close"] ?? [];
			for (const h of handlers) h(null);
			expect(provider.disconnect).not.toHaveBeenCalled();
			expect(
				plugin.authManager.signOutWithAuthError,
			).not.toHaveBeenCalled();
		});

		it("other code → no-op", () => {
			const { folder, plugin } = makeSharedFolder();
			const provider = getProvider(folder);
			fireCloseEvent(provider, 1006);
			expect(provider.disconnect).not.toHaveBeenCalled();
			expect(plugin.saveSettings).not.toHaveBeenCalled();
		});
	});

	describe("_removeFromSettings", () => {
		it("removes folder from plugin settings and shared folders list", () => {
			const { folder, plugin } = makeSharedFolder();
			plugin.settings.sharedFolders.push(folder.settings);
			plugin.sharedFolders.push(folder);
			const provider = getProvider(folder);

			fireCloseEvent(provider, 4003); // triggers _removeFromSettings

			expect(plugin.settings.sharedFolders).not.toContain(
				folder.settings,
			);
			expect(plugin.sharedFolders).not.toContain(folder);
			expect(plugin.saveSettings).toHaveBeenCalled();
			expect(plugin.refreshIconStyles).toHaveBeenCalled();
		});
	});

	describe("getDoc", () => {
		it("throws for path outside shared folder", () => {
			const { folder } = makeSharedFolder();
			expect(() => folder.getDoc("other/file.md")).toThrow(
				"Path is not in shared folder",
			);
		});

		it("returns existing doc by guid lookup", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(false);
			const doc = folder.createDoc("shared/test.md");
			const retrieved = folder.getDoc("shared/test.md");
			expect(retrieved).toBe(doc);
		});

		it("auto-creates doc when create=true (default)", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(false);
			const doc = folder.getDoc("shared/new.md");
			expect(doc).toBeDefined();
			expect(doc.path).toBe("shared/new.md");
		});

		it("throws when create=false and doc does not exist", () => {
			const { folder } = makeSharedFolder();
			expect(() => folder.getDoc("shared/missing.md", false)).toThrow(
				"No shared doc for path",
			);
		});
	});

	describe("createDoc", () => {
		it("throws for path outside shared folder", () => {
			const { folder } = makeSharedFolder();
			expect(() => folder.createDoc("other/file.md")).toThrow(
				"Path is not in shared folder",
			);
		});

		it("throws if doc already exists", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(false);
			folder.createDoc("shared/test.md");
			expect(() => folder.createDoc("shared/test.md")).toThrow(
				"Shared doc already exists",
			);
		});

		it("generates a guid and stores in ids map", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(false);
			const doc = folder.createDoc("shared/test.md");
			expect(doc.guid).toBeDefined();
			expect(folder.ids.get("shared/test.md")).toBe(doc.guid);
		});

		it("loads content from disk when loadFromDisk=true and file exists", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue("hello world");
			folder.createDoc("shared/test.md", true);
			expect(mockReadFileSync).toHaveBeenCalledWith(
				"/vault/shared/test.md",
				"utf-8",
			);
		});
	});

	describe("deleteDoc", () => {
		it("throws for path outside shared folder", () => {
			const { folder } = makeSharedFolder();
			expect(() => folder.deleteDoc("other/file.md")).toThrow(
				"Path is not in shared folder",
			);
		});

		it("removes doc from ids and docs maps and destroys it", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(false);
			const doc = folder.createDoc("shared/test.md");
			const guid = doc.guid;
			folder.deleteDoc("shared/test.md");
			expect(folder.ids.get("shared/test.md")).toBeUndefined();
			expect(folder.docs.get(guid)).toBeUndefined();
		});

		it("no-ops for missing path", () => {
			const { folder } = makeSharedFolder();
			// Should not throw
			expect(() =>
				folder.deleteDoc("shared/nonexistent.md"),
			).not.toThrow();
		});
	});

	describe("renameDoc", () => {
		it("throws for old path outside shared folder", () => {
			const { folder } = makeSharedFolder();
			expect(() =>
				folder.renameDoc("shared/new.md", "other/old.md"),
			).toThrow("Path is not in shared folder");
		});

		it("remaps guid from old path to new path", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(false);
			const doc = folder.createDoc("shared/old.md");
			const guid = doc.guid;
			folder.renameDoc("shared/new.md", "shared/old.md");
			expect(folder.ids.get("shared/old.md")).toBeUndefined();
			expect(folder.ids.get("shared/new.md")).toBe(guid);
		});

		it("no-ops for missing old path", () => {
			const { folder } = makeSharedFolder();
			expect(() =>
				folder.renameDoc("shared/new.md", "shared/missing.md"),
			).not.toThrow();
		});
	});

	describe("wsConnected / synced", () => {
		it("delegates wsConnected to provider", () => {
			const { folder } = makeSharedFolder();
			const provider = getProvider(folder);
			provider.wsconnected = true;
			expect(folder.wsConnected).toBe(true);
			provider.wsconnected = false;
			expect(folder.wsConnected).toBe(false);
		});

		it("delegates synced to provider", () => {
			const { folder } = makeSharedFolder();
			const provider = getProvider(folder);
			provider.synced = true;
			expect(folder.synced).toBe(true);
			provider.synced = false;
			expect(folder.synced).toBe(false);
		});
	});

	describe("onStatusChange / offStatusChange", () => {
		it("registers callback on status and sync events", () => {
			const { folder } = makeSharedFolder();
			const provider = getProvider(folder);
			const cb = vi.fn();
			folder.onStatusChange(cb);
			// Provider.on was called for "status" and "sync"
			const statusHandlers = provider._handlers["status"] ?? [];
			const syncHandlers = provider._handlers["sync"] ?? [];
			expect(statusHandlers).toContain(cb);
			expect(syncHandlers).toContain(cb);
		});

		it("unregisters callback via offStatusChange", () => {
			const { folder } = makeSharedFolder();
			const provider = getProvider(folder);
			const cb = vi.fn();
			folder.onStatusChange(cb);
			folder.offStatusChange(cb);
			expect(provider.off).toHaveBeenCalledWith("status", cb);
			expect(provider.off).toHaveBeenCalledWith("sync", cb);
		});
	});

	describe("destroy", () => {
		it("destroys all docs and the provider", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(false);
			folder.createDoc("shared/test.md");
			const provider = getProvider(folder);
			folder.destroy();
			expect(provider.destroy).toHaveBeenCalled();
			expect(folder.docs.size).toBe(0);
		});
	});

	describe("update handler — file deletion", () => {
		it("trashes files that are in the shared folder but no longer in the map", () => {
			const trashLocal = vi.fn();
			const { folder } = makeSharedFolder({
				app: {
					vault: {
						getFiles: () => [{ path: "shared/removed.md" }],
						adapter: { trashLocal },
					},
				},
			});

			// ids map is empty — "shared/removed.md" should be trashed
			triggerUpdate(folder);
			expect(trashLocal).toHaveBeenCalledWith("shared/removed.md");
		});

		it("does not trash files outside the shared folder", () => {
			const trashLocal = vi.fn();
			const { folder } = makeSharedFolder({
				app: {
					vault: {
						getFiles: () => [{ path: "other/file.md" }],
						adapter: { trashLocal },
					},
				},
			});

			triggerUpdate(folder);
			expect(trashLocal).not.toHaveBeenCalled();
		});
	});

	describe("update handler — directory creation", () => {
		it("creates parent directory when file path does not exist", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(false);

			// Add a path to the ids map to trigger directory creation
			folder.ids.set("shared/subdir/new.md", "doc-guid-1");
			triggerUpdate(folder);

			expect(mockMkdirSync).toHaveBeenCalledWith(
				expect.stringContaining("subdir"),
				{ recursive: true },
			);
		});

		it("does not create directory when it already exists", () => {
			const { folder } = makeSharedFolder();
			// First call: file doesn't exist; second call: dir exists
			mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);

			folder.ids.set("shared/test.md", "doc-guid-1");
			triggerUpdate(folder);

			expect(mockMkdirSync).not.toHaveBeenCalled();
		});

		it("creates file with open() when file does not exist", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(false);

			folder.ids.set("shared/new.md", "doc-guid-1");
			triggerUpdate(folder);

			expect(mockOpen).toHaveBeenCalledWith(
				expect.stringContaining("shared/new.md"),
				"w",
				expect.any(Function),
			);
		});
	});

	describe("update handler — file overwrite decisions", () => {
		it("accepts file without prompt when existing file has size 0", () => {
			const { folder } = makeSharedFolder();
			// File exists
			mockExistsSync.mockReturnValue(true);
			mockStatSync.mockReturnValue({ size: 0 });

			folder.ids.set("shared/empty.md", "doc-guid-1");
			triggerUpdate(folder);

			// No overwrite prompt should be enqueued for empty files
			expect(folder.isFileKept("shared/empty.md")).toBe(false);
		});

		it("enqueues overwrite prompt when existing file has size > 0", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(true);
			mockStatSync.mockReturnValue({ size: 100 });

			folder.ids.set("shared/existing.md", "doc-guid-1");
			triggerUpdate(folder);

			// Should be pending decision
			expect(folder.isFileKept("shared/existing.md")).toBe(true);
		});

		it("accepts file when statSync throws", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(true);
			mockStatSync.mockImplementation(() => {
				throw new Error("stat failed");
			});

			folder.ids.set("shared/broken.md", "doc-guid-1");
			triggerUpdate(folder);

			expect(folder.isFileKept("shared/broken.md")).toBe(false);
		});
	});

	describe("createDoc — content insertion", () => {
		it("inserts content when file content differs from yjs text", async () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue("file content");

			const doc = folder.createDoc("shared/test.md", true);

			// Wait for onceSynced to fire (mocked persistence fires immediately)
			await new Promise((r) => setTimeout(r, 10));

			expect(doc.text).toBe("file content");
		});

		it("does not insert content when loadFromDisk is false", async () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue("file content");

			const doc = folder.createDoc("shared/test.md", false);
			await new Promise((r) => setTimeout(r, 10));

			expect(doc.text).toBe("");
		});

		it("does not insert when file is empty string", async () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue("");

			const doc = folder.createDoc("shared/test.md", true);
			await new Promise((r) => setTimeout(r, 10));

			expect(doc.text).toBe("");
		});
	});

	describe("_removeFromSettings when folder not in list", () => {
		it("handles folder not in settings array gracefully", () => {
			const { folder, plugin } = makeSharedFolder();
			const provider = getProvider(folder);
			// Don't add folder to settings — _removeFromSettings should not crash
			expect(() => fireCloseEvent(provider, 4003)).not.toThrow();
			expect(plugin.saveSettings).toHaveBeenCalled();
		});
	});

	describe("_processOverwriteQueue length check", () => {
		it("processes overwrite queue length correctly (> 0 vs >= 0)", () => {
			const { folder } = makeSharedFolder();
			mockExistsSync.mockReturnValue(true);
			mockStatSync.mockReturnValue({ size: 100 });

			// Trigger update with one item — should enqueue
			folder.ids.set("shared/a.md", "guid-a");
			triggerUpdate(folder);
			expect(folder.isFileKept("shared/a.md")).toBe(true);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// SharedDoc
// ═══════════════════════════════════════════════════════════════════════════

describe("SharedDoc", () => {
	describe("constructor", () => {
		it("sets up provider, awareness user fields, and connection-close handler", () => {
			const { doc } = makeSharedDoc();
			const provider = getProvider(doc);
			expect(provider.awareness.setLocalStateField).toHaveBeenCalledWith(
				"user",
				expect.objectContaining({ name: "test-user" }),
			);
			expect(provider._handlers["connection-close"]?.length).toBe(1);
		});

		it("skips _connectWithAuth when serverUrl is empty", () => {
			const { plugin } = makeSharedDoc({
				settings: { serverUrl: "" },
			});
			// Token should never be fetched
			expect(plugin.authManager.getAccessToken).not.toHaveBeenCalled();
		});
	});

	describe("_connectWithAuth", () => {
		it("fetches token, sets params, and calls connect", async () => {
			const { doc, plugin } = makeSharedDoc();
			const provider = getProvider(doc);
			await new Promise((r) => setTimeout(r, 0));
			expect(plugin.authManager.getAccessToken).toHaveBeenCalled();
			expect(provider.params).toEqual({ token: "tok-123" });
			expect(provider.connect).toHaveBeenCalled();
		});

		it("does not connect when token is null", async () => {
			const { doc } = makeSharedDoc({
				authManager: {
					getAccessToken: vi.fn().mockResolvedValue(null),
				},
			});
			const provider = getProvider(doc);
			await new Promise((r) => setTimeout(r, 0));
			expect(provider.connect).not.toHaveBeenCalled();
		});
	});

	describe("connection close codes", () => {
		it("4001 → disconnect", () => {
			const { doc } = makeSharedDoc();
			const provider = getProvider(doc);
			fireCloseEvent(provider, 4001);
			expect(provider.disconnect).toHaveBeenCalled();
		});

		it("4003 → disconnect", () => {
			const { doc } = makeSharedDoc();
			const provider = getProvider(doc);
			fireCloseEvent(provider, 4003);
			expect(provider.disconnect).toHaveBeenCalled();
		});

		it("4004 → disconnect", () => {
			const { doc } = makeSharedDoc();
			const provider = getProvider(doc);
			fireCloseEvent(provider, 4004);
			expect(provider.disconnect).toHaveBeenCalled();
		});

		it("other code → no disconnect", () => {
			const { doc } = makeSharedDoc();
			const provider = getProvider(doc);
			fireCloseEvent(provider, 1006);
			expect(provider.disconnect).not.toHaveBeenCalled();
		});

		it("null event → no disconnect", () => {
			const { doc } = makeSharedDoc();
			const provider = getProvider(doc);
			const handlers = provider._handlers["connection-close"] ?? [];
			for (const h of handlers) h(null);
			expect(provider.disconnect).not.toHaveBeenCalled();
		});
	});

	describe("role management", () => {
		it("role starts as null", () => {
			const { doc } = makeSharedDoc();
			expect(doc.role).toBeNull();
		});

		it("setRole updates the role", () => {
			const { doc } = makeSharedDoc();
			doc.setRole("EDITOR");
			expect(doc.role).toBe("EDITOR");
		});

		it("setRole to VIEWER is stored correctly", () => {
			const { doc } = makeSharedDoc();
			doc.setRole("VIEWER");
			expect(doc.role).toBe("VIEWER");
		});

		it("setRole with same value is a no-op", () => {
			const { doc } = makeSharedDoc();
			doc.setRole("EDITOR");
			// Calling again with same value should not throw
			doc.setRole("EDITOR");
			expect(doc.role).toBe("EDITOR");
		});
	});

	describe("user color selection", () => {
		it("sets user awareness with color and colorLight properties", () => {
			const { doc } = makeSharedDoc();
			const provider = getProvider(doc);
			const call = provider.awareness.setLocalStateField.mock.calls[0];
			expect(call[0]).toBe("user");
			const userObj = call[1];
			expect(userObj).toHaveProperty("color");
			expect(userObj).toHaveProperty("colorLight");
			expect(userObj.color).toMatch(/^#[0-9a-f]{6}$/);
			expect(userObj.colorLight).toMatch(/^#[0-9a-f]{6}[0-9a-f]{2}$/);
		});
	});

	describe("text getter", () => {
		it("returns contents of the yjs text type", () => {
			const { doc } = makeSharedDoc();
			doc.ydoc.getText("contents").insert(0, "hello");
			expect(doc.text).toBe("hello");
		});
	});

	describe("close", () => {
		it("destroys provider and persistence", () => {
			const { doc } = makeSharedDoc();
			const provider = getProvider(doc);
			doc.close();
			expect(provider.destroy).toHaveBeenCalled();
		});

		it("nullifies binding and editorView", () => {
			const { doc } = makeSharedDoc();
			doc.close();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((doc as any)._binding).toBeNull();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((doc as any)._editorView).toBeNull();
		});
	});

	describe("destroy", () => {
		it("destroys provider and persistence without throwing", () => {
			const { doc } = makeSharedDoc();
			const provider = getProvider(doc);
			expect(() => doc.destroy()).not.toThrow();
			expect(provider.destroy).toHaveBeenCalled();
		});

		it("can be called multiple times safely", () => {
			const { doc } = makeSharedDoc();
			doc.destroy();
			expect(() => doc.destroy()).not.toThrow();
		});
	});
});
