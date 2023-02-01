'use strict';

import {
  App,
  Modal,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  MarkdownView
} from "obsidian";

import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'

import { yCollab } from 'y-codemirror.next'
import { Extension} from '@codemirror/state'
import { EditorView } from "@codemirror/view";
import { IndexeddbPersistence } from 'y-indexeddb'
import { around } from "monkey-around"
import * as random from 'lib0/random'
import { Awareness } from "y-protocols/awareness";
import { randomUUID } from "crypto";

interface MultiplayerSettings {
  sharedFolders: SharedFolderSettings[];
}

const DEFAULT_SETTINGS: MultiplayerSettings = {
  sharedFolders: [],
};

const DEFAULT_SIGNALING_SERVERS = 'wss://signaling.yjs.dev, wss://y-webrtc-signaling-eu.herokuapp.com, wss://y-webrtc-signaling-us.herokuapp.com'
interface SharedFolderSettings {
  guid: string
  path: string 
  signalingServers?: string[]
  password?: string
}

export const usercolors = [
  { color: '#30bced', light: '#30bced33' },
  { color: '#6eeb83', light: '#6eeb8333' },
  { color: '#ffbc42', light: '#ffbc4233' },
  { color: '#ecd444', light: '#ecd44433' },
  { color: '#ee6352', light: '#ee635233' },
  { color: '#9ac2c9', light: '#9ac2c933' },
  { color: '#8acb88', light: '#8acb8833' },
  { color: '#1be7ff', light: '#1be7ff33' }
]

class SharedFolder {
  guid: string
  root: Y.Doc
  basePath: string
  ids: Y.Map<string> // Maps document paths to guids
  docs: Map<string, SharedDoc> // Maps guids to SharedDocs
  persistence: IndexeddbPersistence
  provider: WebrtcProvider

  constructor({guid, path, signalingServers, password}: SharedFolderSettings) {
    this.basePath = path
    this.guid = guid
    this.root = new Y.Doc()
    this.ids = this.root.getMap("docs")
    this.docs = new Map()
    this.persistence = new IndexeddbPersistence(guid, this.root)
    this.provider = new WebrtcProvider(guid, this.root)
  }

  // Get the shared doc for a file
  getDoc(path: string, create: boolean = true): SharedDoc {
    if (!path.startsWith(this.basePath)) {
      throw new Error('Path is not in shared folder: ' + path)
    }
    const id = this.ids.get(path)
    if (id !== undefined) {
      const doc = this.docs.get(id)
      if (doc !== undefined) {
        return doc
      } 
    } 

    if (create) 
      return this.createDoc(path)
    else
      throw new Error('No shared doc for path: ' + path)
  }

  // Create a new shared doc
  createDoc(path: string): SharedDoc {
    if (!path.startsWith(this.basePath)) {
      throw new Error('Path is not in shared folder: ' + path)
    }

    const guid = this.ids.get(path) || randomUUID()
    this.docs.set(guid,new SharedDoc(path, guid))
    this.ids.set(path, guid)
    console.log('Created ydoc', path), guid
    return this.docs.get(guid)
  }

  destroy()
  {
    this.docs.forEach(doc => doc.destroy())
  }

}

class SharedDoc {
  guid: string
  provider: WebrtcProvider;
  persistence: IndexeddbPersistence
  ydoc: Y.Doc
  path: string

  constructor(path: string, guid: string) {
    console.log('Creating shared doc', path, guid)
    this.ydoc = new Y.Doc()
    this.persistence = new IndexeddbPersistence(guid, this.ydoc)
    this.provider = new WebrtcProvider(guid, this.ydoc)
    this.path = path
    this.guid = guid
  }


editorBinding(path: string, userColor?: {color: string, light: string}): Extension {
    if (userColor === undefined) {
      userColor = usercolors[random.uint32() % usercolors.length]
    }

    console.log('document loaded: ', path)
    const yText = this.ydoc.getText('contents')
    const undoManager = new Y.UndoManager(yText)

    this.provider.awareness.setLocalStateField('user', {
      name: 'Anonymous ' + Math.floor(Math.random() * 100),
      color: userColor.color,
      colorLight: userColor.light
    })

    return yCollab(yText, this.provider.awareness, { undoManager })

  }

  destroy() {
    if (this.provider) {
      this.provider.destroy()
    }
    if (this.persistence) {
      this.persistence.destroy()
    }
  }

}
export default class Multiplayer extends Plugin {
  settings: MultiplayerSettings;
  sharedFolders: SharedFolder[];
  extensions: Map<string, Extension>;

  async onload() {
    console.log("loading multiplayer");
    // select a random color for this user
    await this.loadSettings();
    this.sharedFolders = [ ]

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
     
    const patchOnLoadFile = around(MarkdownView.prototype, {
      // replace MarkdownView.onLoadFile() with the following function
      onLoadFile(old) { // old is the original onLoadFile function
        return function (file) { // onLoadFile takes one argument, file
            const sharedFolder = Multiplayer.getSharedFolder(file.path) 
            if (sharedFolder) {
              try {
                const sharedDoc = sharedFolder.getDoc(file.path)
                const binding = sharedDoc.editorBinding(file.path)
                // @ts-expect-error, not typed
                app.plugins.plugins['obsidian-multiplayer'].registerEditorExtension(binding)
                app.workspace.updateOptions()
                const text = sharedDoc.ydoc.getText('contents').toString()
                this.editor.setValue(text) 

                console.log("binding yjs")
              }
              catch (e) {
                console.error(e.message)
              }
            }
           

          return old.call(this, file); // now call the orignal function and bind the current scope to it
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
              console.log('unbinding yjs')
              subdoc.destroy()
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
    this.register(patchOnLoadFile);
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
