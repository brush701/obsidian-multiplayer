"use strict";

import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	MarkdownView,
	FileSystemAdapter,
	Notice,
	requestUrl,
} from "obsidian";

import { SharedFolder, SharedTypeSettings } from "./sharedTypes";
import { MultiplayerSettings, ConnectionStatus } from "./types";
import { AuthManager } from "./auth";
import { TektiteApiClient } from "./api";

import { EditorView } from "@codemirror/view";
import { around } from "monkey-around";
import {
	SharedFolderModal,
	UnshareFolderModal,
	InviteModal,
	MembersModal,
	FolderSelectModal,
} from "./modals";
import { DocExtensionManager } from "./docExtensions";

const DEFAULT_SETTINGS: MultiplayerSettings = {
	serverUrl: "",
	username: "",
	sharedFolders: [],
};

const ICON_SVG_URI = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='18' cy='5' r='3'%3E%3C/circle%3E%3Ccircle cx='6' cy='12' r='3'%3E%3C/circle%3E%3Ccircle cx='18' cy='19' r='3'%3E%3C/circle%3E%3Cline x1='8.59' y1='13.51' x2='15.42' y2='17.49'%3E%3C/line%3E%3Cline x1='15.41' y1='6.51' x2='8.59' y2='10.49'%3E%3C/line%3E%3C/svg%3E")`;

export default class Multiplayer extends Plugin {
	settings: MultiplayerSettings;
	authManager: AuthManager;
	apiClient: TektiteApiClient;
	sharedFolders: SharedFolder[];
	private _docExtensions = new DocExtensionManager();
	private _iconStyleEl: HTMLStyleElement | null = null;
	private _statusBarEl: HTMLElement | null = null;
	private _statusChangeHandler = () => this._updateStatusBar();

	async onload() {
		console.log("loading multiplayer");
		await this.loadSettings();
		this.authManager = new AuthManager(this.app, this.settings);
		this.apiClient = new TektiteApiClient(
			this.settings.serverUrl,
			this.authManager,
			requestUrl,
		);
		this.sharedFolders = [];
		this.setup();
	}

	setup() {
		this.authManager.on("auth-changed", () => {
			if (!this.authManager.isAuthenticated) {
				this.sharedFolders.forEach((f) => {
					this._detachStatusListeners(f);
					f.destroy();
				});
				this.sharedFolders = [];
				this._reconfigureAllEmpty();
				this._docExtensions.clear();
				this.app.workspace.updateOptions();
				this.refreshIconStyles();
			}
			this._updateStatusBar();
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file: TFile) => {
				// Add a menu item to the folder context menu to create a board
				if (file instanceof TFolder) {
					const isShared = this.sharedFolders.some((folder) => {
						if (file.path.contains(folder.settings.path)) {
							menu.addItem((item) => {
								item.setTitle(
									"Delete Multiplayer Shared Folder",
								)
									.setIcon("dot-network")
									.onClick(() =>
										new UnshareFolderModal(
											this.app,
											this,
											folder,
										).open(),
									);
							});

							menu.addSeparator();

							if (folder.cachedRole !== "VIEWER") {
								menu.addItem((item) => {
									item.setTitle(
										`Invite to ${folder.settings.name || "Room"}`,
									)
										.setIcon("user-plus")
										.onClick(() =>
											new InviteModal(
												this.app,
												this,
												folder,
											).open(),
										);
								});
							}

							menu.addItem((item) => {
								item.setTitle("Room members")
									.setIcon("users")
									.onClick(() =>
										new MembersModal(
											this.app,
											this,
											folder,
										).open(),
									);
							});

							return true;
						}
					});

					if (!isShared) {
						menu.addItem((item) => {
							item.setTitle("New Multiplayer Shared Folder")
								.setIcon("dot-network")
								.onClick(() =>
									new SharedFolderModal(
										this.app,
										this,
										file,
									).open(),
								);
						});
					}
				}
			}),
		);

		this.addSettingTab(new MultiplayerSettingTab(this.app, this));

		this._statusBarEl = this.addStatusBarItem();
		this._statusBarEl.onClickEvent(() => {
			if (this.authManager.hasAuthError) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const setting = (this.app as any).setting;
				setting.open();
				setting.openTabById(this.manifest.id);
			}
		});

		this.registerObsidianProtocolHandler("multiplayer/join", (params) =>
			this._handleJoinProtocol(params),
		);

		this.settings.sharedFolders.forEach(
			(sharedFolder: SharedTypeSettings) => {
				const newSharedFolder = new SharedFolder(
					sharedFolder,
					(this.app.vault.adapter as FileSystemAdapter).getBasePath(),
					this,
				);
				this._attachStatusListeners(newSharedFolder);
				this._registerOnAccept(newSharedFolder);
				this.sharedFolders.push(newSharedFolder);
			},
		);
		this._updateStatusBar();

		this.app.workspace.on("file-open", (file) => {
			if (file) {
				const sharedFolder = this.getSharedFolder(file.path);
				if (sharedFolder && !sharedFolder.isFileKept(file.path)) {
					this._bindSharedDoc(file.path, sharedFolder);
				}
			}
		});

		this.app.vault.on("create", (file) => {
			const folder = this.getSharedFolder(file.path);
			if (folder && !folder.isFileKept(file.path)) {
				folder.createDoc(file.path);
			}
		});

		this.app.vault.on("delete", (file) => {
			const folder = this.getSharedFolder(file.path);
			if (folder) {
				folder.deleteDoc(file.path);
			}
		});

		this.app.vault.on("rename", (file, oldPath) => {
			const folder = this.getSharedFolder(oldPath);
			if (folder) {
				folder.renameDoc(file.path, oldPath);
				this._docExtensions.rename(oldPath, file.path);
			}
		});

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const plugin = this;

		const patchOnUnloadFile = around(MarkdownView.prototype, {
			onUnloadFile(old) {
				return function (file) {
					const sharedFolder = plugin.getSharedFolder(file.path);

					if (sharedFolder) {
						try {
							const subdoc = sharedFolder.getDoc(
								file.path,
								false,
							);
							console.log("disconnecting room", subdoc.path);
							subdoc.close();
							const effect = plugin._docExtensions.emptyEffect(
								file.path,
							);
							if (effect) {
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								const cmView = (this.editor as any)
									.cm as EditorView;
								if (cmView) {
									cmView.dispatch({ effects: effect });
								}
							}
						} catch (e) {
							console.log(e.message);
						}
					}
					return old.call(this, file);
				};
			},
		});

		// register the patches with Obsidian's register method so that it gets unloaded properly
		this.register(patchOnUnloadFile);

		this.refreshIconStyles();
	}

	private _reconfigureAllEmpty(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const cmView = (leaf.view.editor as any).cm as EditorView;
				if (cmView) {
					for (const compartment of this._docExtensions.values()) {
						cmView.dispatch({
							effects: compartment.reconfigure([]),
						});
					}
				}
			}
		});
	}

	refreshIconStyles() {
		if (!this._iconStyleEl) {
			this._iconStyleEl = document.head.createEl("style");
		}
		this._iconStyleEl.textContent = this.sharedFolders
			.map((folder) => {
				const path = CSS.escape(folder.settings.path);
				return `.nav-folder-title[data-path="${path}"]::before {
  content: '';
  display: inline-block;
  width: 1em;
  height: 1em;
  margin-right: 4px;
  vertical-align: middle;
  background-color: currentColor;
  mask-image: ${ICON_SVG_URI};
  -webkit-mask-image: ${ICON_SVG_URI};
  mask-size: contain;
  -webkit-mask-size: contain;
  mask-repeat: no-repeat;
  -webkit-mask-repeat: no-repeat;
}`;
			})
			.join("\n");
	}

	private _getConnectionStatus(): ConnectionStatus {
		if (this.authManager.hasAuthError) return ConnectionStatus.AuthError;
		if (!this.authManager.isAuthenticated)
			return ConnectionStatus.NotSignedIn;
		if (this.sharedFolders.some((f) => !f.wsConnected))
			return ConnectionStatus.Disconnected;
		if (this.sharedFolders.some((f) => !f.synced))
			return ConnectionStatus.Syncing;
		return ConnectionStatus.Connected;
	}

	private _updateStatusBar(): void {
		if (!this._statusBarEl) return;
		const status = this._getConnectionStatus();
		const labels: Record<ConnectionStatus, string> = {
			[ConnectionStatus.NotSignedIn]: "Multiplayer: not signed in",
			[ConnectionStatus.Connected]: "● Multiplayer",
			[ConnectionStatus.Syncing]: "⟳ Multiplayer",
			[ConnectionStatus.Disconnected]: "○ Multiplayer",
			[ConnectionStatus.AuthError]: "⚠ Multiplayer: sign in again",
		};
		this._statusBarEl.setText(labels[status]);
	}

	private _attachStatusListeners(folder: SharedFolder): void {
		folder.onStatusChange(this._statusChangeHandler);
	}

	private _detachStatusListeners(folder: SharedFolder): void {
		folder.offStatusChange(this._statusChangeHandler);
	}

	private _registerOnAccept(folder: SharedFolder): void {
		folder.onAccept((path: string) => {
			// If the accepted file is currently open, activate the binding
			const activeFile =
				this.app.workspace.getActiveViewOfType(MarkdownView);
			if (
				activeFile &&
				activeFile.file &&
				activeFile.file.path === path
			) {
				this._bindSharedDoc(path, folder);
			}
		});
	}

	private _bindSharedDoc(path: string, sharedFolder: SharedFolder): void {
		const sharedDoc = sharedFolder.getDoc(path);
		sharedDoc.setRole(sharedFolder.cachedRole);
		sharedDoc.connect();
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const { compartment, isNew } =
				this._docExtensions.getOrCreate(path);
			if (isNew) {
				this.registerEditorExtension(compartment.of([]));
			}
			sharedDoc.onceSynced().then(() => {
				view.editor.setValue(sharedDoc.text);
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const cmView = (view.editor as any).cm as EditorView;
				if (cmView) {
					cmView.dispatch({
						effects: compartment.reconfigure(sharedDoc.binding),
					});
					sharedDoc.setEditorView(cmView);
				}
				console.log("binding yjs");
			});
		}
	}

	private _handleJoinProtocol(params: Record<string, string>): void {
		const { guid, name, server } = params;

		if (!guid || !name) {
			new Notice("Invalid invite link: missing room information.");
			return;
		}

		if (!this.authManager.isAuthenticated) {
			new Notice("Sign in first.");
			return;
		}

		if (!this.settings.serverUrl) {
			new Notice("Configure a server URL in settings first.");
			return;
		}

		if (server) {
			const normalise = (u: string) =>
				u.replace(/\/+$/, "").toLowerCase();
			if (normalise(server) !== normalise(this.settings.serverUrl)) {
				new Notice("This invite is for a different server.");
				return;
			}
		}

		if (this.sharedFolders.some((sf) => sf.settings.guid === guid)) {
			new Notice("You are already in this room.");
			return;
		}

		new FolderSelectModal(this.app, async (folder) => {
			try {
				const hasOverlap = this.sharedFolders.some(
					(sf) =>
						folder.path.includes(sf.settings.path) ||
						sf.settings.path.includes(folder.path),
				);
				if (hasOverlap) {
					new Notice("This folder is already a shared folder.");
					return;
				}

				const settings = { guid, name, path: folder.path };
				this.settings.sharedFolders.push(settings);
				await this.saveSettings();
				const newFolder = new SharedFolder(
					settings,
					(this.app.vault.adapter as FileSystemAdapter).getBasePath(),
					this,
				);
				this.addSharedFolder(newFolder);
				new Notice(`Joined room "${name}".`);
			} catch (e) {
				new Notice("Could not join room: unexpected error.");
				console.error("multiplayer: join protocol error", e);
			}
		}).open();
	}

	addSharedFolder(folder: SharedFolder): void {
		this._attachStatusListeners(folder);
		this._registerOnAccept(folder);
		this.sharedFolders.push(folder);
		this.refreshIconStyles();
		this._updateStatusBar();
	}

	getSharedFolder(path: string): SharedFolder {
		return this.sharedFolders.find((sharedFolder: SharedFolder) =>
			path.contains(sharedFolder.settings.path),
		);
	}

	onunload() {
		this.authManager.destroy();
		this.sharedFolders.forEach((sharedFolder) => {
			this._detachStatusListeners(sharedFolder);
			sharedFolder.destroy();
		});
		this._iconStyleEl?.remove();
		console.log("unloading plugin");
		this.saveSettings();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

export class MultiplayerSettingTab extends PluginSettingTab {
	plugin: Multiplayer;
	private _authSectionEl: HTMLElement | null = null;
	private _availableRoomsEl: HTMLElement | null = null;
	private _authChangedHandler: (() => void) | null = null;
	private _signingIn = false;
	private _loadGeneration = 0;

	constructor(app: App, plugin: Multiplayer) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this._unregisterAuthListener();

		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Multiplayer" });

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc("e.g. https://multiplayer.company.com")
			.addText((text) => {
				text.setValue(this.plugin.settings.serverUrl);
				text.onChange((value) => {
					this.plugin.settings.serverUrl = value;
					this.plugin.saveSettings();
					this._renderAuthSection();
				});
			});

		new Setting(containerEl)
			.setName("Username")
			.setDesc("The name that others will see over your caret")
			.addText((text) => {
				text.setValue(this.plugin.settings.username);
				text.onChange((value) => {
					this.plugin.settings.username = value;
					this.plugin.saveSettings();
				});
			});

		this._authSectionEl = containerEl.createDiv();
		this._renderAuthSection();

		this._availableRoomsEl = containerEl.createDiv();
		this._renderAvailableRooms();

		this._authChangedHandler = () => {
			this._renderAuthSection();
			this._renderAvailableRooms();
		};
		this.plugin.authManager.on("auth-changed", this._authChangedHandler);
	}

	hide(): void {
		this._unregisterAuthListener();
	}

	private _unregisterAuthListener(): void {
		if (this._authChangedHandler) {
			this.plugin.authManager.off(
				"auth-changed",
				this._authChangedHandler,
			);
			this._authChangedHandler = null;
		}
	}

	private _renderAuthSection(): void {
		if (!this._authSectionEl) return;
		this._authSectionEl.empty();

		const { authManager } = this.plugin;

		if (authManager.isAuthenticated) {
			const email = authManager.userInfo?.email ?? "unknown";
			new Setting(this._authSectionEl)
				.setName(`● Signed in as ${email}`)
				.addButton((btn) => {
					btn.setButtonText("Sign Out")
						.setWarning()
						.onClick(async () => {
							await authManager.signOut();
						});
				});
		} else {
			const buttonText = this._signingIn ? "Signing in…" : "Sign In";
			const disabled = !this.plugin.settings.serverUrl || this._signingIn;
			new Setting(this._authSectionEl)
				.setName("○ Not signed in")
				.addButton((btn) => {
					btn.setButtonText(buttonText)
						.setDisabled(disabled)
						.onClick(async () => {
							this._signingIn = true;
							this._renderAuthSection();
							try {
								await authManager.signIn();
							} finally {
								this._signingIn = false;
								this._renderAuthSection();
							}
						});
				});
		}
	}

	private _renderAvailableRooms(): void {
		if (!this._availableRoomsEl) return;
		this._availableRoomsEl.empty();
		this._loadGeneration++;

		this._availableRoomsEl.createEl("h3", { text: "Available rooms" });

		if (!this.plugin.authManager.isAuthenticated) {
			this._availableRoomsEl.createEl("p", {
				text: "Sign in to see your available rooms.",
			});
			return;
		}

		this._availableRoomsEl.createEl("p", {
			text: "Loading rooms…",
		});

		this._loadAvailableRooms(this._loadGeneration);
	}

	private async _loadAvailableRooms(generation: number): Promise<void> {
		const el = this._availableRoomsEl;
		if (!el) return;

		try {
			const rooms = await this.plugin.apiClient.listRooms();

			if (generation !== this._loadGeneration) return;

			const existingGuids = new Set(
				this.plugin.settings.sharedFolders.map((sf) => sf.guid),
			);
			const available = rooms.filter((r) => !existingGuids.has(r.guid));

			el.empty();
			el.createEl("h3", {
				text: "Available rooms",
			});

			if (available.length === 0) {
				el.createEl("p", {
					text: "No additional rooms available.",
				});
				return;
			}

			for (const room of available) {
				new Setting(el)
					.setName(room.name)
					.setDesc(
						room.role.charAt(0) + room.role.slice(1).toLowerCase(),
					)
					.addButton((btn) => {
						btn.setButtonText("Add to vault").onClick(() => {
							new FolderSelectModal(this.app, async (folder) => {
								const hasOverlap =
									this.plugin.sharedFolders.some(
										(sf) =>
											folder.path.includes(
												sf.settings.path,
											) ||
											sf.settings.path.includes(
												folder.path,
											),
									);
								if (hasOverlap) {
									new Notice(
										"This folder is already a shared folder.",
									);
									return;
								}

								const settings = {
									guid: room.guid,
									name: room.name,
									path: folder.path,
								};
								this.plugin.settings.sharedFolders.push(
									settings,
								);
								await this.plugin.saveSettings();
								const newFolder = new SharedFolder(
									settings,
									(
										this.app.vault
											.adapter as FileSystemAdapter
									).getBasePath(),
									this.plugin,
								);
								this.plugin.addSharedFolder(newFolder);
								new Notice(`Added "${room.name}" to vault.`);
								this._renderAvailableRooms();
							}).open();
						});
					});
			}
		} catch {
			if (generation !== this._loadGeneration) return;

			el.empty();
			el.createEl("h3", {
				text: "Available rooms",
			});
			el.createEl("p", {
				text: "Could not load rooms.",
			});
		}
	}
}
