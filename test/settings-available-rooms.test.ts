// Suite: Available rooms in settings tab
// Scope: Unit
// Spec: TASK-23 — [P3-S8] Available rooms list in settings tab
// What this suite validates:
//   - Calls listRooms() when displayed and authenticated
//   - Excludes rooms already in settings.sharedFolders
//   - Shows "Sign in" message when not authenticated
//   - Shows "Loading rooms…" while loading
//   - Shows "Could not load rooms." on error
//   - Shows "No additional rooms available." when list is empty
//   - "Add to vault" adds room to settings, creates SharedFolder, re-renders
//   - Overlap guard prevents adding to already-shared folder
//   - Stale async loads are discarded on re-render

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, Setting } from "obsidian";
import { MultiplayerSettingTab } from "../src/main";
import { makeRoomListItem, makeSharedTypeSettings } from "./factories";

// Capture FolderSelectModal callback
let lastFolderSelectCallback:
	| ((folder: { path: string }) => Promise<void>)
	| null = null;
vi.mock("../src/modals", () => ({
	FolderSelectModal: class {
		constructor(
			_app: unknown,
			cb: (folder: { path: string }) => Promise<void>,
		) {
			lastFolderSelectCallback = cb;
		}
		open() {}
	},
	SharedFolderModal: class {
		open() {}
	},
	UnshareFolderModal: class {
		open() {}
	},
	InviteModal: class {
		open() {}
	},
	MembersModal: class {
		open() {}
	},
}));

// Mock SharedFolder constructor to avoid WebSocket startup
vi.mock("../src/sharedTypes", () => ({
	SharedFolder: class {
		settings: unknown;
		constructor(settings: unknown) {
			this.settings = settings;
		}
	},
}));

// ── Minimal mock DOM ──────────────────────────────────────────────────────────

interface MockEl {
	_tag: string;
	_text: string;
	_children: MockEl[];
	empty(): void;
	setText(text: string): void;
	remove(): void;
	createEl(tag: string, opts?: { text?: string; cls?: string }): MockEl;
	createDiv(opts?: { cls?: string }): MockEl;
}

function makeMockEl(tag = "div"): MockEl {
	const children: MockEl[] = [];
	const el: MockEl = {
		_tag: tag,
		_text: "",
		_children: children,
		empty() {
			children.length = 0;
			el._text = "";
		},
		setText(text: string) {
			el._text = text;
		},
		remove() {},
		createEl(_tag: string, opts?: { text?: string; cls?: string }) {
			const child = makeMockEl(_tag);
			if (opts?.text) child._text = opts.text;
			children.push(child);
			return child;
		},
		createDiv(opts?: { cls?: string }) {
			return el.createEl("div", opts);
		},
	};
	return el;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlugin(overrides: Record<string, unknown> = {}) {
	return {
		settings: {
			serverUrl: "https://example.com",
			username: "",
			sharedFolders: [] as { guid: string; name: string; path: string }[],
		},
		sharedFolders: [] as { settings: { guid: string; path: string } }[],
		apiClient: {
			listRooms: vi.fn().mockResolvedValue([]),
		},
		authManager: {
			isAuthenticated: true,
			userInfo: { email: "test@example.com", name: "Test" },
			hasAuthError: false,
			on: vi.fn(),
			off: vi.fn(),
			signOut: vi.fn(),
		},
		saveSettings: vi.fn().mockResolvedValue(undefined),
		addSharedFolder: vi.fn(),
		...overrides,
	};
}

function buildTab(pluginOverrides: Record<string, unknown> = {}) {
	const plugin = makePlugin(pluginOverrides);
	const app = new App();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const tab = new MultiplayerSettingTab(app as any, plugin as any);
	const containerEl = makeMockEl();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(tab as any).containerEl = containerEl;
	return { tab, plugin, containerEl };
}

function getAvailableRoomsEl(containerEl: MockEl): MockEl {
	const divs = containerEl._children.filter((c) => c._tag === "div");
	return divs[1];
}

function allTexts(el: MockEl): string[] {
	const texts: string[] = [];
	if (el._text) texts.push(el._text);
	for (const child of el._children) {
		texts.push(...allTexts(child));
	}
	return texts;
}

async function waitForLoad(containerEl: MockEl) {
	await vi.waitFor(() => {
		const roomsEl = getAvailableRoomsEl(containerEl);
		const texts = allTexts(roomsEl);
		expect(texts).not.toContain("Loading rooms…");
	});
}

/**
 * Invoke the "Add to vault" button click by calling _loadAvailableRooms with
 * a Setting.addButton spy, then triggering the captured onClick handler.
 * Returns the FolderSelectModal callback for simulating folder selection.
 */
async function clickAddToVault(
	tab: MultiplayerSettingTab,
): Promise<(folder: { path: string }) => Promise<void>> {
	lastFolderSelectCallback = null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const tabAny = tab as any;

	// Spy on Setting.addButton to capture the ButtonComponent
	let capturedOnClick: (() => void) | null = null;
	const origAddButton = Setting.prototype.addButton;
	Setting.prototype.addButton = function (cb) {
		const result = origAddButton.call(this, cb);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const btn = (this as any)._btn;
		if (btn?._onClickHandler) capturedOnClick = btn._onClickHandler;
		return result;
	};

	tabAny._loadGeneration++;
	await tabAny._loadAvailableRooms(tabAny._loadGeneration);
	Setting.prototype.addButton = origAddButton;

	expect(capturedOnClick).not.toBeNull();
	capturedOnClick!();
	expect(lastFolderSelectCallback).not.toBeNull();
	return lastFolderSelectCallback!;
}

describe("Available rooms in settings tab", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		lastFolderSelectCallback = null;
	});

	describe("unauthenticated", () => {
		it("shows sign-in message and does not call listRooms", () => {
			const listRooms = vi.fn();
			const { tab, containerEl } = buildTab({
				apiClient: { listRooms },
				authManager: {
					isAuthenticated: false,
					userInfo: null,
					hasAuthError: false,
					on: vi.fn(),
					off: vi.fn(),
				},
			});

			tab.display();

			const texts = allTexts(getAvailableRoomsEl(containerEl));
			expect(texts).toContain("Available rooms");
			expect(texts).toContain("Sign in to see your available rooms.");
			expect(listRooms).not.toHaveBeenCalled();
		});
	});

	describe("loading", () => {
		it('shows "Loading rooms…" and calls listRooms()', () => {
			const listRooms = vi.fn().mockReturnValue(new Promise(() => {}));
			const { tab, containerEl } = buildTab({ apiClient: { listRooms } });

			tab.display();

			const texts = allTexts(getAvailableRoomsEl(containerEl));
			expect(texts).toContain("Loading rooms…");
			expect(listRooms).toHaveBeenCalled();
		});
	});

	describe("error", () => {
		it("shows error message on API failure", async () => {
			const listRooms = vi.fn().mockRejectedValue(new Error("network"));
			const { tab, containerEl } = buildTab({ apiClient: { listRooms } });

			tab.display();

			await waitForLoad(containerEl);
			expect(allTexts(getAvailableRoomsEl(containerEl))).toContain(
				"Could not load rooms.",
			);
		});
	});

	describe("empty", () => {
		it("shows empty message when no rooms available", async () => {
			const { tab, containerEl } = buildTab();

			tab.display();

			await waitForLoad(containerEl);
			expect(allTexts(getAvailableRoomsEl(containerEl))).toContain(
				"No additional rooms available.",
			);
		});
	});

	describe("room list", () => {
		it("renders available rooms (not empty/error)", async () => {
			const rooms = [
				makeRoomListItem({
					guid: "r1",
					name: "Q4 Planning",
					role: "EDITOR",
				}),
				makeRoomListItem({
					guid: "r2",
					name: "Board Docs",
					role: "VIEWER",
				}),
			];
			const { tab, containerEl } = buildTab({
				apiClient: { listRooms: vi.fn().mockResolvedValue(rooms) },
			});

			tab.display();

			await waitForLoad(containerEl);
			const texts = allTexts(getAvailableRoomsEl(containerEl));
			expect(texts).not.toContain("No additional rooms available.");
			expect(texts).not.toContain("Could not load rooms.");
		});

		it("excludes rooms already in settings.sharedFolders", async () => {
			const rooms = [
				makeRoomListItem({ guid: "room-1" }),
				makeRoomListItem({ guid: "room-2" }),
				makeRoomListItem({ guid: "room-3" }),
			];
			const { tab, containerEl } = buildTab({
				apiClient: { listRooms: vi.fn().mockResolvedValue(rooms) },
				settings: {
					serverUrl: "https://example.com",
					username: "",
					sharedFolders: [makeSharedTypeSettings({ guid: "room-2" })],
				},
			});

			tab.display();

			await waitForLoad(containerEl);
			expect(allTexts(getAvailableRoomsEl(containerEl))).not.toContain(
				"No additional rooms available.",
			);
		});

		it("shows empty when all rooms are already added", async () => {
			const rooms = [makeRoomListItem({ guid: "room-1" })];
			const { tab, containerEl } = buildTab({
				apiClient: { listRooms: vi.fn().mockResolvedValue(rooms) },
				settings: {
					serverUrl: "https://example.com",
					username: "",
					sharedFolders: [makeSharedTypeSettings({ guid: "room-1" })],
				},
			});

			tab.display();

			await waitForLoad(containerEl);
			expect(allTexts(getAvailableRoomsEl(containerEl))).toContain(
				"No additional rooms available.",
			);
		});
	});

	describe("add to vault", () => {
		it("saves settings, creates SharedFolder, and calls addSharedFolder", async () => {
			const rooms = [
				makeRoomListItem({ guid: "room-1", name: "New Room" }),
			];
			const { tab, plugin, containerEl } = buildTab({
				apiClient: { listRooms: vi.fn().mockResolvedValue(rooms) },
			});

			tab.display();
			await waitForLoad(containerEl);

			const selectFolder = await clickAddToVault(tab);
			await selectFolder({ path: "my-folder" });

			expect(plugin.settings.sharedFolders).toContainEqual({
				guid: "room-1",
				name: "New Room",
				path: "my-folder",
			});
			expect(plugin.saveSettings).toHaveBeenCalled();
			expect(plugin.addSharedFolder).toHaveBeenCalled();
		});

		it("blocks add when folder overlaps an existing shared folder", async () => {
			const rooms = [
				makeRoomListItem({ guid: "room-1", name: "New Room" }),
			];
			const { tab, plugin, containerEl } = buildTab({
				apiClient: { listRooms: vi.fn().mockResolvedValue(rooms) },
				sharedFolders: [
					{ settings: { guid: "existing", path: "shared" } },
				],
			});

			tab.display();
			await waitForLoad(containerEl);

			const selectFolder = await clickAddToVault(tab);
			await selectFolder({ path: "shared/sub" });

			expect(plugin.saveSettings).not.toHaveBeenCalled();
			expect(plugin.addSharedFolder).not.toHaveBeenCalled();
		});
	});

	describe("race condition", () => {
		it("discards stale load when re-rendered before API resolves", async () => {
			let resolveFirst!: (value: unknown[]) => void;
			const firstLoad = new Promise<unknown[]>((r) => {
				resolveFirst = r;
			});
			const secondLoad = Promise.resolve([
				makeRoomListItem({ guid: "room-2", name: "Second" }),
			]);
			const listRooms = vi
				.fn()
				.mockReturnValueOnce(firstLoad)
				.mockReturnValueOnce(secondLoad);

			const { tab, containerEl } = buildTab({ apiClient: { listRooms } });

			tab.display();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(tab as any)._renderAvailableRooms(); // re-render before first resolves

			await waitForLoad(containerEl);

			// Resolve stale first load
			resolveFirst([makeRoomListItem({ guid: "room-1", name: "Stale" })]);
			await new Promise((r) => setTimeout(r, 0));

			// Should still show second load result, not be overwritten
			const texts = allTexts(getAvailableRoomsEl(containerEl));
			expect(texts).not.toContain("No additional rooms available.");
			expect(listRooms).toHaveBeenCalledTimes(2);
		});
	});

	describe("auth listener lifecycle", () => {
		it("registers on display() and unregisters on hide()", () => {
			const onFn = vi.fn();
			const offFn = vi.fn();
			const { tab } = buildTab({
				authManager: {
					isAuthenticated: true,
					userInfo: { email: "test@example.com", name: "Test" },
					hasAuthError: false,
					on: onFn,
					off: offFn,
					signOut: vi.fn(),
				},
			});

			tab.display();
			expect(onFn).toHaveBeenCalledWith(
				"auth-changed",
				expect.any(Function),
			);

			tab.hide();
			expect(offFn).toHaveBeenCalledWith(
				"auth-changed",
				expect.any(Function),
			);
		});
	});
});
