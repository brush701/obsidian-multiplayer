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
              .setTitle('New Multiplayer SharedFolder')
              .setIcon('dot-network')
              .onClick(() => new SharedFolderModal(this.app, this, file).open());
          });
        }
      })
    );

    this.addSettingTab(new MultiplayerSettingTab(this.app, this));

    this.settings.sharedFolders.forEach((sharedFolder: SharedFolderSettings) => {
      const newSharedFolder = new SharedFolder(sharedFolder)
      this.sharedFolders.push(newSharedFolder)
    })
   
    var extensions = this._extensions
    this.app.workspace.on("file-open", file => {
    //const patchOnLoadFile = around(MarkdownView.prototype, {
      //onLoadFile(old) {
       // return function (file) {
        //  let ret = old.call(this, file)
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
          //return ret
       // }
      //}
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
    //this.register(patchOnLoadFile);
    this.register(patchOnUnloadFile);
  
  }

  // this makes me queasy, but it works
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
      contentEl.createEl('p', { text: 'If you want to change the settings, please delete the sharedFolder first.'})
      const button = contentEl.createEl('button', { text: 'Delete SharedFolder', attr: { class: 'btn btn-danger' } })
      button.onClickEvent((ev) => {
        this.plugin.settings.sharedFolders = this.plugin.settings.sharedFolders.filter(el => el.path !== sharedFolder.basePath)
        this.plugin.saveSettings()
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
            this.plugin.sharedFolders.push(new SharedFolder(settings))

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
