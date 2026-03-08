import { Modal, TFolder, App, FileSystemAdapter, Notice } from "obsidian";
import  Multiplayer from "./main"
import { SharedFolder } from "./sharedTypes";
import { AuthRequiredError, ApiRequestError } from "./api";

type TabName = 'create' | 'join';

export class SharedFolderModal extends Modal {
  plugin: Multiplayer;
  folder: TFolder;
  private activeTab: TabName = 'create';
  private createContentEl: HTMLElement;
  private joinContentEl: HTMLElement;
  private roomNameInput: HTMLInputElement;
  private createBtn: HTMLButtonElement;

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

  private switchTab(tab: TabName, createTab: HTMLElement, joinTab: HTMLElement) {
    this.activeTab = tab;
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

  private async handleCreate() {
    const roomName = this.roomNameInput.value.trim();
    if (!roomName) return;

    this.createBtn.disabled = true;
    this.createBtn.textContent = 'Creating…';

    try {
      const result = await this.plugin.apiClient.createRoom(roomName);
      const path = this.folder.path;
      const settings = { guid: result.guid, name: result.name, path };
      this.plugin.settings.sharedFolders.push(settings);
      await this.plugin.saveSettings();
      this.plugin.sharedFolders.push(
        new SharedFolder(settings, (this.app.vault.adapter as FileSystemAdapter).getBasePath(), this.plugin)
      );
      this.plugin.refreshIconStyles();
      this.close();
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        new Notice('Sign in first.');
      } else if (e instanceof ApiRequestError) {
        new Notice(`Could not create room: ${e.message}`);
      } else {
        new Notice('Could not create room: unexpected error.');
      }
      this.createBtn.disabled = false;
      this.createBtn.textContent = 'Create Room';
      this.updateCreateBtnState();
    }
  }

  private renderJoinTab() {
    this.joinContentEl.createEl('p', {
      text: 'Join tab coming soon.',
      cls: 'multiplayer-placeholder',
    });
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

