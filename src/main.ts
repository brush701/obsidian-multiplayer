'use strict';

import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  MarkdownView,
  FileSystemAdapter,
  ButtonComponent,
  Notice
} from "obsidian";

import { SharedFolder, SharedTypeSettings } from './sharedTypes'

import { Extension} from '@codemirror/state'
import { around } from "monkey-around"
import * as util from './util'

import { PasswordModal, ResetPasswordModal, SharedFolderModal, UnshareFolderModal } from "./modals";
import { PasswordManager } from "./pwManager";

interface MultiplayerSettings {
  sharedFolders: SharedTypeSettings[];
  username: string
  salt: string
}

const DEFAULT_SETTINGS: MultiplayerSettings = {
  sharedFolders: [],
  salt: "",
  username: "Anonymous"
};

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>`

export default class Multiplayer extends Plugin {
  settings: MultiplayerSettings;
  sharedFolders: SharedFolder[];
  pwMgr: PasswordManager
  private _extensions: Extension[];

  async onload() {
    console.log("loading multiplayer");
    await this.loadSettings();
    this.sharedFolders = [ ]
    this._extensions = []
    new PasswordModal(this.app, this, (result: string) => {
      try {
      this.pwMgr = new PasswordManager(result, this)
      this.setup()
      } catch {
        new Notice("Incorrect multiplayer password")
        this.unload()
      }
    }).open()
  }

  setup() {
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file: TFile) => {
        // Add a menu item to the folder context menu to create a board
        if (file instanceof TFolder) {
          const isShared = this.sharedFolders.some(folder => {
            if (file.path.contains(folder.settings.path)) {
              menu.addItem((item) => {
                item
                  .setTitle('Delete Multiplayer Shared Folder')
                  .setIcon('dot-network')
                  .onClick(() => new UnshareFolderModal(this.app, this, folder).open());
              })

              menu.addItem((item) => {
                item
                  .setTitle('Copy GUID')
                  .onClick(() => navigator.clipboard.writeText(folder.settings.guid).then(() => {
                    new Notice("Copied GUID")
                  }))
              })

              menu.addItem((item) => {
                item
                  .setTitle('Copy Password')
                  .onClick(() => navigator.clipboard.writeText(this.pwMgr.getPassword(folder.settings.guid)).then(() => {
                    new Notice("Copied Password")
                  }))
              })

              return true
            }
          })

          if (!isShared) {
            menu.addItem((item) => {
              item
                .setTitle('New Multiplayer Shared Folder')
                .setIcon('dot-network')
                .onClick(() => new SharedFolderModal(this.app, this, file).open());
            });
          }
        }
      })
    );

    this.addSettingTab(new MultiplayerSettingTab(this.app, this));


    this.settings.sharedFolders.forEach((sharedFolder: SharedTypeSettings) => {
      const newSharedFolder = new SharedFolder(sharedFolder, (this.app.vault.adapter as FileSystemAdapter).getBasePath(), this)

      this.sharedFolders.push(newSharedFolder)
    })
   
    var extensions = this._extensions
    this.app.workspace.on("file-open", file => {
      if (file) {
        const sharedFolder = this.getSharedFolder(file.path)
        if (sharedFolder) {
          const sharedDoc = sharedFolder.getDoc(file.path)
          sharedDoc.connect()
          const view = this.app.workspace.getActiveViewOfType(MarkdownView)
          if (view) {
            extensions.push(sharedDoc.binding)
            sharedDoc.onceSynced().then(() => {
              this.registerEditorExtension(extensions)
              app.workspace.updateOptions()
              console.log("binding yjs")
            })
          }
        }
      }
    })

    this.app.vault.on("create", file => { 
      let folder = this.getSharedFolder(file.path)
      if (folder) {
        folder.createDoc(file.path)
      }
    })

    this.app.vault.on("delete", file => {
      let folder = this.getSharedFolder(file.path)
      if (folder) {
        folder.deleteDoc(file.path)
      }
    })

    this.app.vault.on("rename", (file, oldPath) => {
      let folder = this.getSharedFolder(oldPath)
      if (folder) {
        folder.renameDoc(file.path, oldPath)
      }

    })

    const plugin = this
    
    const patchOnUnloadFile = around(MarkdownView.prototype, {
      // replace MarkdownView.onLoadFile() with the following function
      onUnloadFile(old) { // old is the original onLoadFile function
        return function (file) { // onLoadFile takes one argument, file

          const sharedFolder = plugin.getSharedFolder(file.path) 

          if (sharedFolder) {
            try {
              const subdoc = sharedFolder.getDoc(file.path, false)
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
        const fileItem = fileExplorer.view.fileItems[folder.settings.path];
        if (fileItem) {
          const titleEl = fileItem.titleEl;
          const titleInnerEl = fileItem.titleInnerEl;

          // needs to check because of the refreshing the plugin will duplicate all the icons
          if (titleEl.children.length === 2 || titleEl.children.length === 1) {
              const existingIcon = titleEl.querySelector('.obsidian-icon-multiplayer');
              if (existingIcon) {
                existingIcon.remove();
              }

              const iconNode = titleEl.createDiv();
              iconNode.classList.add('obsidian-icon-multiplayer');

              iconNode.innerHTML = icon 

              titleEl.insertBefore(iconNode, titleInnerEl);
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

  getSharedFolder(path: string) : SharedFolder {

    return this.sharedFolders.find((sharedFolder: SharedFolder) => path.contains(sharedFolder.settings.path))

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

class MultiplayerSettingTab extends PluginSettingTab {

  plugin: Multiplayer;
  constructor(app: App, plugin: Multiplayer) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Multiplayer" });
    new Setting(containerEl)
      .setName("Username")
      .setDesc("The name that others will see over your caret")
      .addText((text) => {
        text.setValue(this.plugin.settings.username)
        text.onChange( value => {
          this.plugin.settings.username = value
          this.plugin.saveSettings()
        })
      }
      )

    new ButtonComponent(containerEl)
      .setButtonText("Backup Shared Folders")
      .onClick(e => {
        util.backup((this.app.vault.adapter as FileSystemAdapter).getBasePath() + "/.obsidian/plugins/obsidian-multiplayer") // For now, backup to the plugin folder
      })
     
     new ButtonComponent(containerEl)
      .setButtonText("Reset Master Password")
      .onClick(e => {
        new ResetPasswordModal(this.app, this.plugin, (result) => {
          this.plugin.pwMgr.resetPassword(result, this.plugin.sharedFolders.map(e => e.settings.guid))
        }).open()
      })
  }
}
