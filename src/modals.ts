import { Modal, FuzzySuggestModal, TFolder, App, FileSystemAdapter, Notice } from "obsidian";
import  Multiplayer from "./main"
import { SharedFolder } from "./sharedTypes";
import { AuthRequiredError, ApiRequestError } from "./api";
import type { InviteExpiry, RoomRole, RoomMember } from "./types";

export class SharedFolderModal extends Modal {
  plugin: Multiplayer;
  folder: TFolder;
  private createContentEl: HTMLElement;
  private joinContentEl: HTMLElement;
  private roomNameInput: HTMLInputElement;
  private createBtn: HTMLButtonElement;
  private inviteInput: HTMLInputElement;
  private joinBtn: HTMLButtonElement;

  constructor(app: App, plugin: Multiplayer, folder: TFolder) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('modal-style-multiplayer');
    contentEl.empty();

    const sharedFolder = this.plugin.sharedFolders.find(sf => this.folder.path.contains(sf.settings.path));
    if (sharedFolder) {
      contentEl.createEl("h2", { text: "SharedFolder already exists" });
      contentEl.createEl('p', { text: 'This folder is already a multiplayer sharedFolder.'});
      const button = contentEl.createEl('button', { text: 'OK', attr: { class: 'btn btn-ok' } });
      button.onClickEvent(() => this.close());
      return;
    }

    // Tab bar
    const tabBar = contentEl.createDiv({ cls: 'multiplayer-tab-bar' });
    const createTab = tabBar.createEl('button', { text: 'Create', cls: 'multiplayer-tab multiplayer-tab-active' });
    const joinTab = tabBar.createEl('button', { text: 'Join', cls: 'multiplayer-tab' });

    // Tab content containers
    this.createContentEl = contentEl.createDiv({ cls: 'multiplayer-tab-content' });
    this.joinContentEl = contentEl.createDiv({ cls: 'multiplayer-tab-content' });
    this.joinContentEl.style.display = 'none';

    createTab.onClickEvent(() => this.switchTab('create', createTab, joinTab));
    joinTab.onClickEvent(() => this.switchTab('join', createTab, joinTab));

    this.renderCreateTab();
    this.renderJoinTab();

    // Focus room name input
    this.roomNameInput.focus();
  }

  private switchTab(tab: 'create' | 'join', createTab: HTMLElement, joinTab: HTMLElement) {
    if (tab === 'create') {
      createTab.addClass('multiplayer-tab-active');
      joinTab.removeClass('multiplayer-tab-active');
      this.createContentEl.style.display = '';
      this.joinContentEl.style.display = 'none';
      this.roomNameInput.focus();
    } else {
      joinTab.addClass('multiplayer-tab-active');
      createTab.removeClass('multiplayer-tab-active');
      this.joinContentEl.style.display = '';
      this.createContentEl.style.display = 'none';
      this.inviteInput.focus();
    }
  }

  private renderCreateTab() {
    const el = this.createContentEl;

    const nameLabel = el.createEl('label', { text: 'Room name' });
    nameLabel.style.display = 'block';
    nameLabel.style.marginBottom = '4px';
    nameLabel.style.marginTop = '12px';

    this.roomNameInput = el.createEl('input', {
      type: 'text',
      placeholder: 'Enter a room name',
      cls: 'multiplayer-room-name-input',
    });
    this.roomNameInput.style.width = '100%';

    // Pre-fill with folder name
    const folderName = this.folder.name;
    if (folderName) {
      this.roomNameInput.value = folderName;
    }

    const btnContainer = el.createDiv();
    btnContainer.style.marginTop = '12px';

    this.createBtn = btnContainer.createEl('button', {
      text: 'Create Room',
      cls: 'mod-cta',
    });

    this.updateCreateBtnState();

    this.roomNameInput.addEventListener('input', () => this.updateCreateBtnState());

    this.createBtn.onClickEvent(() => this.handleCreate());
  }

  private updateCreateBtnState() {
    const isEmpty = !this.roomNameInput.value.trim();
    this.createBtn.disabled = isEmpty;
  }

  private _creating = false;

  private async handleCreate() {
    const roomName = this.roomNameInput.value.trim();
    if (!roomName || this._creating) return;

    this._creating = true;
    this.createBtn.disabled = true;
    this.createBtn.textContent = 'Creating…';

    try {
      const result = await this.plugin.apiClient.createRoom(roomName);
      const path = this.folder.path;
      const settings = { guid: result.guid, name: result.name, path };
      this.plugin.settings.sharedFolders.push(settings);
      await this.plugin.saveSettings();
      const newFolder = new SharedFolder(settings, (this.app.vault.adapter as FileSystemAdapter).getBasePath(), this.plugin);
      this.plugin.addSharedFolder(newFolder);
      this.close();
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        new Notice('Sign in first.');
      } else if (e instanceof ApiRequestError) {
        new Notice(`Could not create room: ${e.message}`);
      } else {
        new Notice('Could not create room: unexpected error.');
      }
      this._creating = false;
      this.createBtn.disabled = false;
      this.createBtn.textContent = 'Create Room';
      this.updateCreateBtnState();
    }
  }

  private extractToken(input: string): string {
    const trimmed = input.trim();
    if (trimmed.includes('://')) {
      try {
        const url = new URL(trimmed);
        return url.searchParams.get('token') ?? '';
      } catch {
        return '';
      }
    }
    return trimmed;
  }

  private renderJoinTab() {
    const el = this.joinContentEl;

    const label = el.createEl('label', { text: 'Invite link or code' });
    label.style.display = 'block';
    label.style.marginBottom = '4px';
    label.style.marginTop = '12px';

    this.inviteInput = el.createEl('input', {
      type: 'text',
      placeholder: 'Paste an invite link or code',
      cls: 'multiplayer-invite-input',
    });
    this.inviteInput.style.width = '100%';

    const btnContainer = el.createDiv();
    btnContainer.style.marginTop = '12px';

    this.joinBtn = btnContainer.createEl('button', {
      text: 'Join Room',
      cls: 'mod-cta',
    });

    this.updateJoinBtnState();

    this.inviteInput.addEventListener('input', () => this.updateJoinBtnState());

    this.joinBtn.onClickEvent(() => this.handleJoin());
  }

  private updateJoinBtnState() {
    const token = this.extractToken(this.inviteInput.value);
    this.joinBtn.disabled = !token;
  }

  private _joining = false;

  private async handleJoin() {
    const token = this.extractToken(this.inviteInput.value);
    if (!token || this._joining) return;

    this._joining = true;
    this.joinBtn.disabled = true;
    this.joinBtn.textContent = 'Joining…';

    try {
      const result = await this.plugin.apiClient.joinRoom(token);
      const path = this.folder.path;
      const settings = { guid: result.guid, name: result.name, path };
      this.plugin.settings.sharedFolders.push(settings);
      await this.plugin.saveSettings();
      const newFolder = new SharedFolder(settings, (this.app.vault.adapter as FileSystemAdapter).getBasePath(), this.plugin);
      this.plugin.addSharedFolder(newFolder);
      this.close();
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        new Notice('Sign in first.');
      } else if (e instanceof ApiRequestError) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          new Notice('Invite link is invalid or has expired.');
        } else {
          new Notice(`Could not join room: ${e.message}`);
        }
      } else {
        new Notice('Could not join room: unexpected error.');
      }
      this._joining = false;
      this.joinBtn.disabled = false;
      this.joinBtn.textContent = 'Join Room';
      this.updateJoinBtnState();
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class UnshareFolderModal extends Modal {
  plugin: Multiplayer;
  folder: SharedFolder;

  constructor(app: App, plugin: Multiplayer, folder: SharedFolder) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('modal-style-multiplayer');
    contentEl.empty();
    const sharedFolder = this.plugin.sharedFolders.find(sharedFolder => this.folder.settings.path == sharedFolder.settings.path)
    if (sharedFolder) {
      contentEl.createEl("h2", { text: "Unshare Folder" });
      contentEl.createEl('p', { text: 'Are you sure you want to unshare this folder?'})
      const button = contentEl.createEl('button', { text: 'Unshare Folder', attr: { class: 'btn btn-danger' } })
      button.onClickEvent((ev) => {
        this.plugin.settings.sharedFolders = this.plugin.settings.sharedFolders.filter(el => el.path !== sharedFolder.settings.path)
        this.plugin.sharedFolders = this.plugin.sharedFolders.filter(el => el.settings.path !== sharedFolder.settings.path)
        this.plugin.saveSettings()
        this.plugin.refreshIconStyles()
        this.folder.docs.forEach(doc => {
          doc.close()
          doc.destroy()
        })
        this.folder.destroy()
        this.close()
      })
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class InviteModal extends Modal {
  plugin: Multiplayer;
  private sharedFolder: SharedFolder;
  private selectedRole: 'EDITOR' | 'VIEWER' = 'EDITOR';
  private selectedExpiry: InviteExpiry = '7d';
  private copyBtn: HTMLButtonElement;
  private _generating = false;

  constructor(app: App, plugin: Multiplayer, sharedFolder: SharedFolder) {
    super(app);
    this.plugin = plugin;
    this.sharedFolder = sharedFolder;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('modal-style-multiplayer');
    contentEl.empty();

    contentEl.createEl('h2', { text: `Invite to "${this.sharedFolder.settings.name}"` });

    // Role radio buttons
    const roleLabel = contentEl.createEl('label', { text: 'Role' });
    roleLabel.style.display = 'block';
    roleLabel.style.marginBottom = '4px';
    roleLabel.style.marginTop = '12px';

    const roleContainer = contentEl.createDiv({ cls: 'multiplayer-role-container' });
    roleContainer.style.display = 'flex';
    roleContainer.style.gap = '16px';

    const editorLabel = roleContainer.createEl('label');
    const editorRadio = editorLabel.createEl('input', { type: 'radio', attr: { name: 'invite-role', value: 'EDITOR' } }) as HTMLInputElement;
    editorRadio.checked = true;
    editorLabel.appendText(' Editor');

    const viewerLabel = roleContainer.createEl('label');
    const viewerRadio = viewerLabel.createEl('input', { type: 'radio', attr: { name: 'invite-role', value: 'VIEWER' } }) as HTMLInputElement;
    viewerLabel.appendText(' Viewer');

    editorRadio.addEventListener('change', () => { if (editorRadio.checked) this.selectedRole = 'EDITOR' });
    viewerRadio.addEventListener('change', () => { if (viewerRadio.checked) this.selectedRole = 'VIEWER' });

    // Expiry dropdown
    const expiryLabel = contentEl.createEl('label', { text: 'Expires' });
    expiryLabel.style.display = 'block';
    expiryLabel.style.marginBottom = '4px';
    expiryLabel.style.marginTop = '12px';

    const expirySelect = contentEl.createEl('select', { cls: 'multiplayer-expiry-select' }) as HTMLSelectElement;
    expirySelect.style.width = '100%';

    const options: { value: InviteExpiry; label: string }[] = [
      { value: '1d', label: '1 day' },
      { value: '7d', label: '7 days' },
      { value: '30d', label: '30 days' },
    ];

    for (const opt of options) {
      const optionEl = expirySelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
      if (opt.value === '7d') optionEl.selected = true;
    }

    expirySelect.addEventListener('change', () => { this.selectedExpiry = expirySelect.value as InviteExpiry });

    // Copy button
    const btnContainer = contentEl.createDiv();
    btnContainer.style.marginTop = '12px';

    this.copyBtn = btnContainer.createEl('button', {
      text: 'Copy Invite Link',
      cls: 'mod-cta',
    });

    this.copyBtn.onClickEvent(() => this.handleCopyInvite());
  }

  async handleCopyInvite() {
    if (this._generating) return;

    this._generating = true;
    this.copyBtn.disabled = true;
    this.copyBtn.textContent = 'Generating…';

    try {
      const result = await this.plugin.apiClient.createInvite(
        this.sharedFolder.settings.guid,
        this.selectedRole,
        this.selectedExpiry,
      );
      await navigator.clipboard.writeText(result.inviteUrl);
      new Notice('Invite link copied.');
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        new Notice('Sign in first.');
      } else if (e instanceof ApiRequestError) {
        new Notice(`Could not create invite: ${e.message}`);
      } else {
        new Notice('Could not create invite: unexpected error.');
      }
    } finally {
      this._generating = false;
      this.copyBtn.disabled = false;
      this.copyBtn.textContent = 'Copy Invite Link';
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

const ROLE_ORDER: Record<RoomRole, number> = { OWNER: 0, EDITOR: 1, VIEWER: 2 };

function sortMembers(members: RoomMember[]): RoomMember[] {
  return [...members].sort((a, b) => {
    const roleDiff = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
    if (roleDiff !== 0) return roleDiff;
    return a.email.localeCompare(b.email);
  });
}

function formatRole(role: RoomRole): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export class MembersModal extends Modal {
  plugin: Multiplayer;
  private sharedFolder: SharedFolder;
  private bodyEl: HTMLElement;

  constructor(app: App, plugin: Multiplayer, sharedFolder: SharedFolder) {
    super(app);
    this.plugin = plugin;
    this.sharedFolder = sharedFolder;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('modal-style-multiplayer');
    contentEl.empty();

    contentEl.createEl('h2', {
      text: `${this.sharedFolder.settings.name || 'Room'} — Members`,
    });

    this.bodyEl = contentEl.createDiv({ cls: 'multiplayer-members-body' });
    this.bodyEl.setText('Loading…');

    this.loadMembers();
  }

  async loadMembers() {
    try {
      const [room, myRole] = await Promise.all([
        this.plugin.apiClient.getRoom(this.sharedFolder.settings.guid),
        this.plugin.apiClient.getMyRole(this.sharedFolder.settings.guid),
      ]);

      this.bodyEl.empty();

      const sorted = sortMembers(room.members);
      const listEl = this.bodyEl.createEl('div', { cls: 'multiplayer-members-list' });

      for (const member of sorted) {
        const row = listEl.createDiv({ cls: 'multiplayer-member-row' });
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.padding = '4px 0';

        row.createSpan({ text: member.email, cls: 'multiplayer-member-email' });
        row.createSpan({ text: formatRole(member.role), cls: 'multiplayer-member-role' });
      }

      // Action buttons
      const actions = this.bodyEl.createDiv({ cls: 'multiplayer-members-actions' });
      actions.style.marginTop = '16px';

      // "Invite someone new" — hidden for VIEWERs
      if (myRole.role !== 'VIEWER') {
        const inviteBtn = actions.createEl('button', {
          text: 'Invite someone new',
          cls: 'mod-cta',
        });
        inviteBtn.style.marginRight = '8px';
        inviteBtn.onClickEvent(() => {
          this.close();
          new InviteModal(this.app, this.plugin, this.sharedFolder).open();
        });
      }

      // "Manage in admin panel"
      const adminBtn = actions.createEl('button', {
        text: 'Manage in admin panel ↗',
      });
      adminBtn.onClickEvent(() => {
        const url = `${this.plugin.settings.serverUrl}/admin/rooms/${this.sharedFolder.settings.guid}`;
        window.open(url);
      });
    } catch (e) {
      this.bodyEl.empty();
      if (e instanceof ApiRequestError) {
        this.bodyEl.createEl('p', {
          text: `Error: ${e.message}`,
          cls: 'multiplayer-members-error',
        });
      } else if (e instanceof AuthRequiredError) {
        this.bodyEl.createEl('p', {
          text: 'Sign in to view members.',
          cls: 'multiplayer-members-error',
        });
      } else {
        this.bodyEl.createEl('p', {
          text: 'Could not load members.',
          cls: 'multiplayer-members-error',
        });
      }
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class FolderSelectModal extends FuzzySuggestModal<TFolder> {
  private folders: TFolder[];
  private onSelect: (folder: TFolder) => void;

  constructor(app: App, onSelect: (folder: TFolder) => void) {
    super(app);
    this.onSelect = onSelect;
    this.folders = this.app.vault.getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder) as TFolder[];
    this.setPlaceholder('Select a folder to sync');
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path || '/';
  }

  onChooseItem(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
    this.onSelect(folder);
  }
}
