import {
  App,
  Modal,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  MarkdownView,
  Workspace,
} from "obsidian";

import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'

import { yCollab } from 'y-codemirror.next'
import { EditorState, StateField, Extension} from '@codemirror/state'
import { IndexeddbPersistence } from 'y-indexeddb'
import { around } from "monkey-around"
import * as random from 'lib0/random'
import { createHash } from 'crypto'

interface MultiplayerSettings {
  rooms: RoomSettings[];
}

const DEFAULT_SETTINGS: MultiplayerSettings = {
  rooms: [],
};

const LEVELDB_PERSISTENCE_NAME = 'multiplayer.db';
const DEFAULT_SIGNALING_SERVERS = 'wss://signaling.yjs.dev, wss://y-webrtc-signaling-eu.herokuapp.com, wss://y-webrtc-signaling-us.herokuapp.com'
interface RoomSettings {
  name: string
  path: string 
  signalingServers?: string[]
  password?: string
}

class Room {
  provider: WebrtcProvider;
  persistence: IndexeddbPersistence
  doc: Y.Doc
  path: string
  name: string

  constructor({name, path, signalingServers, password}: RoomSettings) {
    this.doc = new Y.Doc()
    this.persistence = new IndexeddbPersistence(name, this.doc)
    this.provider = new WebrtcProvider(name, this.doc, {
      signaling: signalingServers || DEFAULT_SIGNALING_SERVERS.split(','),
      password: password
    });
    this.path = path
    this.name = name
  }
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

export default class Multiplayer extends Plugin {
  settings: MultiplayerSettings;
  persistence: IndexeddbPersistence
  rooms: Room[];

  async onload() {
    console.log("loading plugin");
    // select a random color for this user
    const userColor = usercolors[random.uint32() % usercolors.length]
    await this.loadSettings();
    this.rooms = [ ]

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file: TFile) => {
        // Add a menu item to the folder context menu to create a board
        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle('New Multiplayer Room')
              .setIcon('dot-network')
              .onClick(() => new RoomModal(this.app, this, file).open());
          });
        }
      })
    );

    this.addSettingTab(new MultiplayerSettingTab(this.app, this));

    this.settings.rooms.forEach(async (room: RoomSettings) => {
      this.rooms.push(new Room(room))
    })
    
    const patchOnLoadFile = around(MarkdownView.prototype, {
      // replace MarkdownView.onLoadFile() with the following function
      onLoadFile(old) { // old is the original onLoadFile function
        return function (file) { // onLoadFile takes one argument, file
          const cm = this.editor.cm;
          if (cm) {
            cm.state.fileName = file.path;

            const room = Multiplayer.getRoom(cm.state.fileName) 
            if (room) {
              const fileName = cm.state.fileName.toLowerCase()
              const yText = room.doc.getText(fileName)
              const undoManager = new Y.UndoManager(yText)

              room.provider.awareness.setLocalStateField('user', {
                name: 'Anonymous ' + Math.floor(Math.random() * 100),
                color: userColor.color,
                colorLight: userColor.light
              })
              cm.state.ybinding = yCollab(yText, room.provider.awareness, { undoManager })
              app.plugins.plugins['obsidian-multiplayer'].registerEditorExtension(cm.state.ybinding)
              app.workspace.updateOptions()

              console.log("binding yjs")
            }
          }

          return old.call(this, file); // now call the orignal function and bind the current scope to it
        }
      }
    });

    const patchOnUnloadFile = around(MarkdownView.prototype, {
      // replace MarkdownView.onLoadFile() with the following function
      onUnloadFile(old) { // old is the original onLoadFile function
        return function (file) { // onLoadFile takes one argument, file
          const cm = this.editor.cm;
          if (cm) {
            cm.state.fileName = file.path;

            const room = Multiplayer.getRoom(cm.state.fileName) 
            if (room) {
              room.provider.destroy()
              room.persistence.destroy()
              console.log("unbinding yjs")

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
  static getRoom(path: string) : Room {
    return app.plugins.plugins['obsidian-multiplayer'].rooms.find(room => path.contains(room.path))
  }

  onunload() {
    this.rooms.forEach(room => {
      room.persistence.destroy()
      room.provider.destroy()
    })
        console.log("unloading plugin");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
}
class RoomModal extends Modal {
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
    const room = this.plugin.rooms.find(room => this.folder.path.contains(room.path))
    if (room) {
      contentEl.createEl("h2", { text: "Room already exists" });
      contentEl.createEl('p', { text: 'This folder is already a multiplayer room.'})
      contentEl.createEl('p', { text: 'If you want to change the settings, please delete the room first.'})
      const button = contentEl.createEl('button', { text: 'Delete Room', attr: { class: 'btn btn-danger' } })
      button.onClickEvent((ev) => {
        this.plugin.settings.rooms = this.plugin.settings.rooms.filter(el => el.path !== room.path)
        this.plugin.saveSettings()
        this.close()
      })
    } else {
      contentEl.createEl("h2", { text: "Create a new room" });
      contentEl.createEl("form", "form-multiplayer",
      (form) => {

          form.createEl("label", {
            attr: { for: "room-name" },
            text: "Room name"
          })

          form.createEl("input", {
            type: "text",
            attr: {
              name: "name",
              id: "room-name"
            },
            placeholder: "Room name",
          });
          
          form.createEl("label", {
            attr: { for: "room-password" },
            text: "Optional password"
          })

          form.createEl("input", {
            type: "password",
            attr: {
              name: "password",
              id: "room-password"
            },
            placeholder: "Room password",
          });

          form.createEl("label", {
            attr: { for: "room-servers" },
            text: "Optional signaling servers"
          })

          form.createEl("input", {
            type: "text",
            attr: {
              name: "servers",
              id: "room-servers"
            },
            placeholder: "wss://signaling.yjs.dev",
          });

          form.createEl("button", {
            text: "Create",
            type: "submit",
          });

          form.onsubmit = async (e) => {
            e.preventDefault();
            const name = form.querySelector('input[name="name"]').value;
            const servers = form.querySelector('input[name="servers"]').value || DEFAULT_SIGNALING_SERVERS
            const signalingServers = servers.split(',');

            const rooms = this.plugin.settings.rooms
            if (rooms.find(room => room.name === name)) {
              alert('A room with this name already exists.')
              return
            }

            const password = form.querySelector('input[name="password"]').value;
            const path = this.folder.path
            this.plugin.settings.rooms.push({name, path, signalingServers, password})
            this.plugin.saveSettings();
            this.plugin.rooms.push(new Room({name, path, signalingServers, password}))
          

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
