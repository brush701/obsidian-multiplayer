import {
  App,
  Modal,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  MarkdownView,
} from "obsidian";

//import CodeMirror from 'codemirror'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'

import { CodemirrorBinding } from 'y-codemirror'
import 'codemirror/mode/javascript/javascript.js'
//import { IndexeddbPersistence } from 'y-indexeddb'
import { LeveldbPersistence } from 'y-leveldb'
import { around } from "monkey-around"

interface MultiplayerSettings {
  rooms: RoomSettings[];
}

const DEFAULT_SETTINGS: MultiplayerSettings = {
  rooms: [],
};

interface RoomSettings {
  name: string
  root: string 
  provider: string
  persistence: string
}

class Room {
  constructor({name, root, provider, persistence}: RoomSettings) {
  }
}

export default class Multiplayer extends Plugin {
  settings: MultiplayerSettings;
  rooms: Room[];

  async onload() {
    console.log("loading plugin");
    
    const patchOnLoadFile = around(MarkdownView.prototype, {
      // replace MarkdownView.onLoadFile() with the following function
      onLoadFile(old) { // old is the original onLoadFile function
        return function (file) { // onLoadFile takes one argument, file
          const cm = this.editor.cm;
          console.log(file)
          if (cm) {
            cm.state.fileName = file.path;
          }
          return old.call(this, file); // now call the orignal function and bind the current scope to it
        }
      }
    });
    
    // register the patch with Obsidian's register method so that it gets unloaded properly
    this.register(patchOnLoadFile);
  
    await this.loadSettings();

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file: TFile) => {
        // Add a menu item to the folder context menu to create a board
        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle('New Multiplayer Room')
              .setIcon('dot-network')
              .onClick(() => new RoomModal(this.app, file).open());
          });
        }
      })
    );

    this.addSettingTab(new MultiplayerSettingTab(this.app, this));

    const persistence = new LeveldbPersistence('multiplayer.db')

    this.settings.rooms.forEach(async (room: RoomSettings) => {
      //const doc = await persistence.getYDoc(room.root)
      //const provider = new WebrtcProvider(room.name,doc) 
      //this.rooms.push(new Room(room))
    })

    // TODO: need to implement Rooms & SubDocuments
    const ydoc = new Y.Doc()
    const provider = new WebrtcProvider('quill-demo-room', ydoc)
   // const persistence = new IndexeddbPersistence('quill-demo-room', ydoc)
    const yText = ydoc.getText('codemirror')

    this.registerCodeMirror((cm: CodeMirror.Editor) => { 
      console.log(cm.state.fileName)
      const binding = new CodemirrorBinding(yText, cm, provider.awareness)
      console.log("binding yjs")
    })
  }

  onunload() {
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
  constructor(app: App, folder: TFolder) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.setText("Woah!");
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
          .onChange(async (value) => {
            console.log("Secret: " + value);
            this.plugin.settings.rooms.push(new RoomSettings());
            await this.plugin.saveSettings();
          })
      );
  }
}
