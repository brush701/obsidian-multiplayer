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

interface MultiplayerSettings {
  rooms: RoomSettings[];
}

const DEFAULT_SETTINGS: MultiplayerSettings = {
  rooms: [],
};

const LEVELDB_PERSISTENCE_NAME = 'multiplayer.db';

interface RoomSettings {
  name: string
  path: string 
}

class Room {
  provider: WebrtcProvider;
  persistence: IndexeddbPersistence
  doc: Y.Doc
  path: string
  name: string

  constructor({name, path}: RoomSettings) {
    this.doc = new Y.Doc()
    this.persistence = new IndexeddbPersistence(name, this.doc)
    this.provider = new WebrtcProvider(name, this.doc);
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
          console.log(file)
          if (cm) {
            cm.state.fileName = file.path;

            const room = Multiplayer.getRoom(cm.state.fileName) 
            if (room) {
              const yText = room.doc.getText('codemirror')
              const undoManager = new Y.UndoManager(yText)

              room.provider.awareness.setLocalStateField('user', {
                name: 'Anonymous ' + Math.floor(Math.random() * 100),
                color: userColor.color,
                colorLight: userColor.light
              })

              app.plugins.plugins['obsidian-multiplayer'].registerEditorExtension(yCollab(yText, room.provider.awareness, { undoManager }))
              app.workspace.updateOptions()

              console.log("binding yjs")
            }
          }

          return old.call(this, file); // now call the orignal function and bind the current scope to it
        }
      }
    });

    // const patchOnUnloadFile = around(MarkdownView.prototype, {
    //   // replace MarkdownView.onUnloadFile() with the following function
    //   onUnloadFile(old) { // old is the original onUnloadFile function
    //     return function (file) { // onUnloadFile takes one argument, file
    //       const cm = this.editor.cm;
    //       if (cm && cm.state.ybinding) {
    //         app.plugins.plugins['obsidian-multiplayer'].unregisterEditorExtension(cm.state.ybinding)
    //         cm.state.ybinding.destroy()
    //         console.log("unbinding yjs")
    //       }
    //       return old.call(this, file); // now call the orignal function and bind the current scope to it
    //     }
    //   }
    // });
    
    // register the patches with Obsidian's register method so that it gets unloaded properly
    this.register(patchOnLoadFile);
    //this.register(patchOnUnloadFile);

    // for every editor that is loaded, bind the yjs provider to it if it's a room
    // this.registerCodeMirror((cm: CodeMirror.Editor) => { 
    //   console.log("registering codemirror")
    //   const room = this.getRoom(cm.state.fileName) 
    //   console.log(room)
    //   if (room) {
    //     const yText = room.doc.getText('codemirror')
    //     cm.state.ybinding = new CodemirrorBinding(yText, cm, room.provider.awareness)
    //     console.log("binding yjs")
    //   }
    // })
  
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

        form.createEl("button", {
          text: "Create",
          type: "submit",
        });

        form.onsubmit = async (e) => {
          e.preventDefault();
          const name = form.querySelector('input[name="name"]').value;
          const path = this.folder.path
          if (this.plugin.settings.rooms.find(room => room.name !== name)) {
            this.plugin.settings.rooms.push({name, path})
            this.plugin.saveSettings();
            this.plugin.rooms.push(new Room({name, path}))
          }

          this.close();
        }
      })
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
