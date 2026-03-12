"use strict";

import * as Y from "yjs";

import { yCollab } from "y-codemirror.next";
import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView, showPanel, Panel } from "@codemirror/view";
import { IndexeddbPersistence } from "y-indexeddb";
import { WebsocketProvider } from "y-websocket";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, statSync, open, mkdirSync } from "fs";
import { dirname } from "path";
import { Notice } from "obsidian";
import type { RoomRole } from "./types";
import type { OverwriteDecision } from "./fileOverwriteModal";
import { FileOverwriteWarningModal } from "./fileOverwriteModal";
import Multiplayer from "./main";
export interface SharedTypeSettings {
	guid: string;
	path: string;
	name: string;
}

const usercolors = [
	{ color: "#30bced", light: "#30bced33" },
	{ color: "#6eeb83", light: "#6eeb8333" },
	{ color: "#ffbc42", light: "#ffbc4233" },
	{ color: "#ecd444", light: "#ecd44433" },
	{ color: "#ee6352", light: "#ee635233" },
	{ color: "#9ac2c9", light: "#9ac2c933" },
	{ color: "#8acb88", light: "#8acb8833" },
	{ color: "#1be7ff", light: "#1be7ff33" },
];
export class SharedFolder {
	settings: SharedTypeSettings;
	root: Y.Doc;
	ids: Y.Map<string>; // Maps document paths to guids
	docs: Map<string, SharedDoc>; // Maps guids to SharedDocs
	plugin: Multiplayer;
	cachedRole: RoomRole | null = null;

	private _persistence: IndexeddbPersistence;
	private _provider: WebsocketProvider;
	private _vaultRoot: string;
	private _fileDecisions = new Map<string, OverwriteDecision | "pending">();

	constructor(
		settings: SharedTypeSettings,
		vaultRoot: string,
		plugin: Multiplayer,
	) {
		this.plugin = plugin;
		this._vaultRoot = vaultRoot + "/";
		this.settings = settings;
		this.root = new Y.Doc();
		this.ids = this.root.getMap("docs");
		this.docs = new Map();
		this._persistence = new IndexeddbPersistence(settings.guid, this.root);

		const wsBase = `${plugin.settings.serverUrl}/room`;
		this._provider = new WebsocketProvider(
			wsBase,
			settings.guid,
			this.root,
			{ connect: false },
		);
		this._provider.on("connection-close", (event: CloseEvent) => {
			this._handleCloseCode(event);
		});
		if (plugin.settings.serverUrl) {
			this._connectWithAuth();
		}
		this.root.on(
			"update",
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(update: Uint8Array, origin: any, doc: Y.Doc) => {
				const map = doc.getMap<string>("docs");
				map.forEach((guid, path) => {
					const fullPath = this._vaultRoot + path;

					if (this._fileDecisions.has(path)) return;

					if (!existsSync(fullPath)) {
						const dir = dirname(fullPath);
						if (!existsSync(dir)) {
							mkdirSync(dir, { recursive: true });
						}
						open(fullPath, "w", () => {}); //create the file
						this._fileDecisions.set(path, "accept");
					} else {
						try {
							const stats = statSync(fullPath);
							if (stats.size > 0) {
								this._fileDecisions.set(path, "pending");
								this._promptForOverwrite(path);
							} else {
								this._fileDecisions.set(path, "accept");
							}
						} catch {
							this._fileDecisions.set(path, "accept");
						}
					}
				});
				// delete files that are no longer shared
				const files = this.plugin.app.vault.getFiles();
				files.forEach((file) => {
					// if the file is in the shared folder and not in the map, move it to the Trash
					if (
						file.path.startsWith(this.settings.path) &&
						!map.has(file.path)
					) {
						this.plugin.app.vault.adapter.trashLocal(file.path);
					}
				});
			},
		);
	}

	// Get the shared doc for a file
	getDoc(path: string, create = true): SharedDoc {
		if (!path.startsWith(this.settings.path)) {
			throw new Error("Path is not in shared folder: " + path);
		}
		const id = this.ids.get(path);
		if (id !== undefined) {
			const doc = this.docs.get(id);
			if (doc !== undefined) {
				return doc;
			} else {
				return this.createDoc(path, true);
			}
		} else if (create) {
			return this.createDoc(path, true);
		} else {
			throw new Error("No shared doc for path: " + path);
		}
	}

	// Create a new shared doc
	createDoc(path: string, loadFromDisk = false): SharedDoc {
		if (!path.startsWith(this.settings.path)) {
			throw new Error("Path is not in shared folder: " + path);
		}

		const guid = this.ids.get(path) || randomUUID();
		if (this.docs.get(guid))
			throw new Error("Shared doc already exists: " + path);

		const doc = new SharedDoc(path, guid, this);

		let contents = "";
		if (loadFromDisk && existsSync(this._vaultRoot + path)) {
			contents = readFileSync(this._vaultRoot + path, "utf-8");
		}

		const text = doc.ydoc.getText("contents");
		doc.onceSynced().then(() => {
			if (contents && text.toString() != contents)
				text.insert(0, contents);
		});

		this.docs.set(guid, doc);
		this.ids.set(path, guid);

		console.log("Created ydoc", path, guid);
		return doc;
	}

	deleteDoc(path: string) {
		if (!path.startsWith(this.settings.path)) {
			throw new Error("Path is not in shared folder: " + path);
		}

		const guid = this.ids.get(path);
		if (guid) {
			this.ids.delete(path);
			this.docs.get(guid).destroy();
			this.docs.delete(guid);
		}
	}

	renameDoc(newpath: string, oldpath: string) {
		if (!oldpath.startsWith(this.settings.path)) {
			throw new Error("Path is not in shared folder: " + oldpath);
		}

		const guid = this.ids.get(oldpath);
		if (guid) {
			this.ids.delete(oldpath);
			this.ids.set(newpath, guid);
		}
	}

	isFileKept(path: string): boolean {
		const decision = this._fileDecisions.get(path);
		return decision === "keep" || decision === "pending";
	}

	private async _promptForOverwrite(path: string): Promise<void> {
		const modal = new FileOverwriteWarningModal(this.plugin.app, path);
		modal.open();
		const decision = await modal.decision;
		this._fileDecisions.set(path, decision);
	}

	private async _connectWithAuth(): Promise<void> {
		const token = await this.plugin.authManager.getAccessToken();
		if (!token) {
			new Notice("Not signed in — cannot connect to room.");
			return;
		}
		this._provider.params = { token };
		this._provider.connect();
		this._fetchRole();
	}

	private async _fetchRole(): Promise<void> {
		try {
			const result = await this.plugin.apiClient.getMyRole(
				this.settings.guid,
			);
			this.cachedRole = result.role;
			// Propagate role to all open SharedDocs
			for (const doc of this.docs.values()) {
				doc.setRole(result.role);
			}
		} catch {
			// Role fetch is best-effort; menu defaults to showing all items
		}
	}

	private _handleCloseCode(event: CloseEvent | null): void {
		if (!event) return;
		switch (event.code) {
			case 4001:
				this._provider.disconnect();
				new Notice("Session expired — please sign in again.");
				this.plugin.authManager.signOutWithAuthError();
				break;
			case 4003:
				new Notice(`Access denied to ${this.settings.name}.`);
				this._removeFromSettings();
				break;
			case 4004:
				new Notice(`Room '${this.settings.name}' no longer exists.`);
				this._removeFromSettings();
				break;
		}
	}

	private _removeFromSettings(): void {
		this._provider.disconnect();
		const idx = this.plugin.settings.sharedFolders.indexOf(this.settings);
		if (idx !== -1) {
			this.plugin.settings.sharedFolders.splice(idx, 1);
		}
		this.plugin.sharedFolders = this.plugin.sharedFolders.filter(
			(f) => f !== this,
		);
		this.destroy();
		this.plugin.saveSettings();
		this.plugin.refreshIconStyles();
	}

	get wsConnected(): boolean {
		return this._provider.wsconnected;
	}

	get synced(): boolean {
		return this._provider.synced;
	}

	onStatusChange(callback: () => void): void {
		this._provider.on("status", callback);
		this._provider.on("sync", callback);
	}

	offStatusChange(callback: () => void): void {
		this._provider.off("status", callback);
		this._provider.off("sync", callback);
	}

	destroy() {
		this.docs.forEach((doc) => {
			doc.destroy();
			this.docs.delete(doc.guid);
		});
		this._provider.destroy();
	}
}

function readOnlyPanel(): Panel {
	const dom = document.createElement("div");
	dom.className = "cm-readonly-banner";
	dom.textContent = "Read only";
	dom.style.cssText =
		"padding:4px 12px;background:var(--background-secondary);color:var(--text-muted);font-size:12px;border-bottom:1px solid var(--background-modifier-border);";
	return { dom, top: true };
}

export class SharedDoc {
	guid: string;
	private _parent: SharedFolder;
	private _binding: Extension;
	private _role: RoomRole | null = null;
	private _readOnlyCompartment = new Compartment();
	private _panelCompartment = new Compartment();
	private _editorView: EditorView | null = null;

	public get binding(): Extension {
		if (!this._binding) {
			const yText = this.ydoc.getText("contents");
			const isViewer = this._role === "VIEWER";
			const undoManager = isViewer
				? (false as const)
				: new Y.UndoManager(yText);
			this._binding = [
				yCollab(yText, this._provider.awareness, { undoManager }),
				this._readOnlyCompartment.of(EditorState.readOnly.of(isViewer)),
				this._panelCompartment.of(
					isViewer ? showPanel.of(readOnlyPanel) : [],
				),
			];
		}
		return this._binding;
	}

	get role(): RoomRole | null {
		return this._role;
	}

	setEditorView(view: EditorView): void {
		this._editorView = view;
		// Reconcile: role may have changed after binding was created
		// but before EditorView was available. Reconfiguring to the
		// current value is safe (idempotent in CodeMirror).
		if (this._binding) {
			const isViewer = this._role === "VIEWER";
			view.dispatch({
				effects: [
					this._readOnlyCompartment.reconfigure(
						EditorState.readOnly.of(isViewer),
					),
					this._panelCompartment.reconfigure(
						isViewer ? showPanel.of(readOnlyPanel) : [],
					),
				],
			});
		}
	}

	setRole(role: RoomRole | null): void {
		if (role === this._role) return;
		this._role = role;
		if (!this._binding || !this._editorView) return;
		const isViewer = role === "VIEWER";
		this._editorView.dispatch({
			effects: [
				this._readOnlyCompartment.reconfigure(
					EditorState.readOnly.of(isViewer),
				),
				this._panelCompartment.reconfigure(
					isViewer ? showPanel.of(readOnlyPanel) : [],
				),
			],
		});
	}

	private _persistence: IndexeddbPersistence;
	private _provider: WebsocketProvider;
	ydoc: Y.Doc;
	path: string;
	username: string;

	public get text(): string {
		return this.ydoc.getText("contents").toString();
	}

	constructor(path: string, guid: string, parent: SharedFolder) {
		console.log("Creating shared doc", path, guid);
		this._parent = parent;
		this.ydoc = new Y.Doc();
		this._persistence = new IndexeddbPersistence(guid, this.ydoc);
		this.path = path;
		this.guid = guid;

		const serverUrl = parent.plugin.settings.serverUrl;
		const wsBase = `${serverUrl}/room`;
		this._provider = new WebsocketProvider(wsBase, guid, this.ydoc, {
			connect: false,
		});
		this._provider.on("connection-close", (event: CloseEvent) => {
			if (
				event &&
				(event.code === 4001 ||
					event.code === 4003 ||
					event.code === 4004)
			) {
				this._provider.disconnect();
			}
		});
		if (serverUrl) {
			this._connectWithAuth();
		}

		const userColor =
			usercolors[Math.floor(Math.random() * usercolors.length)];
		this._provider.awareness.setLocalStateField("user", {
			name: parent.plugin.settings.username,
			color: userColor.color,
			colorLight: userColor.light,
		});
	}

	private async _connectWithAuth(): Promise<void> {
		const token = await this._parent.plugin.authManager.getAccessToken();
		if (!token) return;
		this._provider.params = { token };
		this._provider.connect();
	}

	/**
	 * Use this Promise to take action the first time the IndexedDB persistence syncs
	 * @returns {Promise} A Promise resolving once the IndexedDB persitence has synced
	 */
	onceSynced() {
		return new Promise((resolve) => {
			this._persistence.once("synced", resolve);
		});
	}

	connect() {
		if (!this._persistence)
			this._persistence = new IndexeddbPersistence(this.guid, this.ydoc);
	}

	// This method cleanly tears down the doc's persistence, provider, and binding.
	close() {
		this._binding = null;
		this._editorView = null;

		this._provider.destroy();
		this._persistence.destroy();
		this._persistence = undefined;
	}

	destroy() {
		this._provider?.destroy();
		if (this._persistence) {
			this._persistence.destroy();
		}
	}
}
