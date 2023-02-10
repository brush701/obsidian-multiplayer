'use strict';

import {
  App,
  Modal,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  MarkdownView,
  Editor
} from "obsidian";

import { SharedDoc, SharedFolder, SharedFolderSettings } from './sharedTypes'

import { Extension} from '@codemirror/state'
import { EditorView } from "@codemirror/view";
import { around } from "monkey-around"
import { randomUUID } from "crypto";

interface MultiplayerSettings {
  sharedFolders: SharedFolderSettings[];
}

const DEFAULT_SETTINGS: MultiplayerSettings = {
  sharedFolders: [],
};

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>`

const DEFAULT_SIGNALING_SERVERS = 'wss://signaling.yjs.dev, wss://y-webrtc-signaling-eu.herokuapp.com'
export default class Multiplayer extends Plugin {
  settings: MultiplayerSettings;
  sharedFolders: SharedFolder[];
  private _extensions: Extension[];

  async onload() {
    console.log("loading multiplayer");
    await this.loadSettings();
    this.sharedFolders = [ ]
    this._extensions = []

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file: TFile) => {
        // Add a menu item to the folder context menu to create a board
        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle('New Multiplayer Shared Folder')
              .setIcon('dot-network')
              .onClick(() => new SharedFolderModal(this.app, this, file).open());
          });
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file: TFile) => {
        // Add a menu item to the folder context menu to create a board
        if (file instanceof TFolder) {
          this.sharedFolders.some(folder => {
            if (file.path.contains(folder.basePath)) {
              menu.addItem((item) => {
                item
                  .setTitle('Delete Multiplayer Shared Folder')
                  .setIcon('dot-network')
                  .onClick(() => new UnshareFolderModal(this.app, this, folder).open());
              })
              return true
            }
          })
        }
      })
    )

    this.addSettingTab(new MultiplayerSettingTab(this.app, this));

    this.settings.sharedFolders.forEach((sharedFolder: SharedFolderSettings) => {
      //@ts-expect-error
      const newSharedFolder = new SharedFolder(sharedFolder, this.app.vault.adapter.getbasePath())
      this.sharedFolders.push(newSharedFolder)
    })
   
    var extensions = this._extensions
    this.app.workspace.on("file-open", file => {
      if (file) {
        const sharedFolder = Multiplayer.getSharedFolder(file.path)
        if (sharedFolder) {
          try {
            const sharedDoc = sharedFolder.getDoc(file.path)
            sharedDoc.connect()
            extensions.push(sharedDoc.binding)
            const view = this.app.workspace.getActiveViewOfType(MarkdownView)
            if (view) {
              view.editor.setValue(sharedDoc.text)
            }
            //@ts-expect-error
            app.plugins.plugins['obsidian-multiplayer'].registerEditorExtension(extensions)
            app.workspace.updateOptions()
            console.log("binding yjs")
          }
          catch (e) {
            console.error(e.message)
          }
        }
      }
    })
    
    const patchOnUnloadFile = around(MarkdownView.prototype, {
      // replace MarkdownView.onLoadFile() with the following function
      onUnloadFile(old) { // old is the original onLoadFile function
        return function (file) { // onLoadFile takes one argument, file
          const sharedFolder = Multiplayer.getSharedFolder(file.path) 
          if (sharedFolder) {
            try {
              const subdoc = sharedFolder.getDoc(file.path)
              console.log('disconnecting room', subdoc.path)
              subdoc.close()
              extensions.length = 0
              this.app.workspace.updateOptions()
            }
            catch(e) {
              console.log(e.message)
            }
          }
          return old.call(this, file); // now call the orignal function and bind the current scope to it
        }
      }
    });

    // register the patches with Obsidian's register method so that it gets unloaded properly
    this.register(patchOnUnloadFile);
  
    this.app.workspace.onLayoutReady(() => this.addIcons());
    this.registerEvent(this.app.workspace.on('layout-change', () => this.addIcons()));
  }

  addIcons() {
    const fileExplorers = this.app.workspace.getLeavesOfType('file-explorer')
    fileExplorers.forEach(fileExplorer => {
      this.sharedFolders.forEach(folder => {
        //@ts-expect-error
        const fileItem = fileExplorer.view.fileItems[folder.basePath];
        if (fileItem) {
          const titleEl = fileItem.titleEl;
          const titleInnerEl = fileItem.titleInnerEl;

          // needs to check because of the refreshing the plugin will duplicate all the icons
          if (titleEl.children.length === 2 || titleEl.children.length === 1) {
            //const iconName = typeof value === 'string' ? value : value.iconName;
            //if (iconName) {
              const existingIcon = titleEl.querySelector('.obsidian-icon-multiplayer');
              if (existingIcon) {
                existingIcon.remove();
              }

              const iconNode = titleEl.createDiv();
              iconNode.classList.add('obsidian-icon-multiplayer');

              iconNode.innerHTML = icon 

              titleEl.insertBefore(iconNode, titleInnerEl);
            //}
            }
          }
        })
      })
  }

  removeIcon(path: string) {
    const fileExplorers = this.app.workspace.getLeavesOfType('file-explorer')
    fileExplorers.forEach(fileExplorer => {
      //@ts-expect-error
      const fileItem = fileExplorer.view.fileItems[path];
      if (fileItem) {
        const titleEl = fileItem.titleEl;
        const titleInnerEl = fileItem.titleInnerEl;


        const existingIcon = titleEl.querySelector('.obsidian-icon-multiplayer');
        if (existingIcon) {
          existingIcon.remove();
        }
      }
    })
  }

  static getSharedFolder(path: string) : SharedFolder {
    // @ts-expect-error, not typed
    return app.plugins.plugins['obsidian-multiplayer'].sharedFolders.find((sharedFolder: SharedFolder) => path.contains(sharedFolder.basePath))
  }

  onunload() {
    this.sharedFolders.forEach(sharedFolder => { sharedFolder.destroy() })
    console.log("unloading plugin");
    this.saveSettings()
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
}
class SharedFolderModal extends Modal {
  plugin: Multiplayer;
  folder: TFolder;

  constructor(app: App, plugin: Multiplayer, folder: TFolder) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('modal-style-multiplayer');
    contentEl.empty();
    const sharedFolder = this.plugin.sharedFolders.find(sharedFolder => this.folder.path.contains(sharedFolder.basePath))
    if (sharedFolder) {
      contentEl.createEl("h2", { text: "SharedFolder already exists" });
      contentEl.createEl('p', { text: 'This folder is already a multiplayer sharedFolder.'})
      const button = contentEl.createEl('button', { text: 'OK', attr: { class: 'btn btn-ok' } })
      button.onClickEvent((ev) => {
        this.close()
      })
    } else {
      contentEl.createEl("h2", { text: "Create a new sharedFolder" });
      contentEl.createEl("form", "form-multiplayer",
      (form) => {

          form.createEl("label", {
            attr: { for: "sharedFolder-password" },
            text: "Optional password"
          })

          form.createEl("input", {
            type: "password",
            attr: {
              name: "password",
              id: "sharedFolder-password"
            },
            placeholder: "SharedFolder password",
          });

          form.createEl("label", {
            attr: { for: "sharedFolder-servers" },
            text: "Optional signaling servers"
          })

          form.createEl("input", {
            type: "text",
            attr: {
              name: "servers",
              id: "sharedFolder-servers"
            },
            placeholder: "wss://signaling.yjs.dev",
          });

          form.createEl("button", {
            text: "Create",
            type: "submit",
          });

          form.onsubmit = async (e) => {
            e.preventDefault();
            // @ts-expect-error, not typed
            const servers = form.querySelector('input[name="servers"]').value || DEFAULT_SIGNALING_SERVERS
            const signalingServers = servers.split(',');

            const sharedFolders = this.plugin.settings.sharedFolders

            // @ts-expect-error, not typed
            const password = form.querySelector('input[name="password"]').value;
            const path = this.folder.path
            const settings = {guid: randomUUID(), path: path, signalingServers, password}
            this.plugin.settings.sharedFolders.push(settings)
            this.plugin.saveSettings();
            //@ts-expect-error
            this.plugin.sharedFolders.push(new SharedFolder(settings, this.app.vault.adapter.getBasePath()))
            this.plugin.addIcons()
            this.close();
          }
        })
      }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class UnshareFolderModal extends Modal {
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
    const sharedFolder = this.plugin.sharedFolders.find(sharedFolder => this.folder.basePath == sharedFolder.basePath)
    if (sharedFolder) {
      contentEl.createEl("h2", { text: "Unshare Folder" });
      contentEl.createEl('p', { text: 'Do you want to unshare this folder?'})
      const button = contentEl.createEl('button', { text: 'Unshare Folder', attr: { class: 'btn btn-danger' } })
      button.onClickEvent((ev) => {
        this.plugin.settings.sharedFolders = this.plugin.settings.sharedFolders.filter(el => el.path !== sharedFolder.basePath)
        this.plugin.sharedFolders = this.plugin.sharedFolders.filter(el => el.basePath !== sharedFolder.basePath)
        this.plugin.saveSettings()
        this.plugin.removeIcon(this.folder.basePath)
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
class MultiplayerSettingTab extends PluginSettingTab {

  plugin: Multiplayer;
  constructor(app: App, plugin: Multiplayer) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Settings for my awesome plugin." });
    new Setting(containerEl)
      .setName("Setting #1")
      .setDesc("It's a secret")
      .addText((text) =>
        text
          .setPlaceholder("Enter your secret")
          .setValue("")
      );
  }
}
