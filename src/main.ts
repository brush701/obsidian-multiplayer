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
  Notice
} from "obsidian";

import { SharedFolder, SharedTypeSettings } from './sharedTypes'
import { MultiplayerSettings } from './types'
import { AuthManager } from './auth'

import { Extension} from '@codemirror/state'
import { around } from "monkey-around"
import { SharedFolderModal, UnshareFolderModal } from "./modals";

const DEFAULT_SETTINGS: MultiplayerSettings = {
  serverUrl: '',
  username: '',
  sharedFolders: [],
};

const ICON_SVG_URI = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='18' cy='5' r='3'%3E%3C/circle%3E%3Ccircle cx='6' cy='12' r='3'%3E%3C/circle%3E%3Ccircle cx='18' cy='19' r='3'%3E%3C/circle%3E%3Cline x1='8.59' y1='13.51' x2='15.42' y2='17.49'%3E%3C/line%3E%3Cline x1='15.41' y1='6.51' x2='8.59' y2='10.49'%3E%3C/line%3E%3C/svg%3E")`

export default class Multiplayer extends Plugin {
  settings: MultiplayerSettings;
  authManager: AuthManager;
  sharedFolders: SharedFolder[];
  private _extensions: Extension[];
  private _iconStyleEl: HTMLStyleElement | null = null;

  async onload() {
    console.log("loading multiplayer");
    await this.loadSettings();
    this.authManager = new AuthManager(this.app, this.settings)
    this.sharedFolders = [ ]
    this._extensions = []
    this.setup()
  }

  setup() {
    this.registerObsidianProtocolHandler('multiplayer/callback', (params) => {
      this.authManager.handleAuthCallback(params as Record<string, string>)
    })

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
              view.editor.setValue(sharedDoc.text)
              this.registerEditorExtension(extensions)
              this.app.workspace.updateOptions()
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
  
    this.refreshIconStyles();
  }

  refreshIconStyles() {
    if (!this._iconStyleEl) {
      this._iconStyleEl = document.head.createEl('style');
    }
    this._iconStyleEl.textContent = this.sharedFolders.map(folder => {
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
    }).join('\n');
  }

  getSharedFolder(path: string) : SharedFolder {

    return this.sharedFolders.find((sharedFolder: SharedFolder) => path.contains(sharedFolder.settings.path))

  }

  

  onunload() {
    this.sharedFolders.forEach(sharedFolder => { sharedFolder.destroy() })
    this._iconStyleEl?.remove();
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

  }
}
