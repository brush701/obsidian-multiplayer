'use strict';

import * as Y from 'yjs'

import { yCollab } from 'y-codemirror.next'
import { Extension} from '@codemirror/state'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { randomUUID } from "crypto";
import { existsSync, readFileSync, open, mkdirSync} from "fs"
import { dirname } from 'path';
import { Notice } from 'obsidian';
import Multiplayer from './main';
export interface SharedTypeSettings {
  guid: string
  path: string
  name: string
}

const usercolors = [
  { color: '#30bced', light: '#30bced33' },
  { color: '#6eeb83', light: '#6eeb8333' },
  { color: '#ffbc42', light: '#ffbc4233' },
  { color: '#ecd444', light: '#ecd44433' },
  { color: '#ee6352', light: '#ee635233' },
  { color: '#9ac2c9', light: '#9ac2c933' },
  { color: '#8acb88', light: '#8acb8833' },
  { color: '#1be7ff', light: '#1be7ff33' }
]
 export class SharedFolder {
  settings: SharedTypeSettings
  root: Y.Doc
  ids: Y.Map<string> // Maps document paths to guids
  docs: Map<string, SharedDoc> // Maps guids to SharedDocs
  plugin: Multiplayer

  private _persistence: IndexeddbPersistence
  private _provider: WebsocketProvider
  private _vaultRoot:string

  constructor(settings: SharedTypeSettings, vaultRoot: string, plugin: Multiplayer) {
    this.plugin = plugin
    this._vaultRoot = vaultRoot + "/"
    this.settings = settings
    this.root = new Y.Doc()
    this.ids = this.root.getMap("docs")
    this.docs = new Map()
    this._persistence = new IndexeddbPersistence(settings.guid, this.root)

    const wsBase = `${plugin.settings.serverUrl}/room`
    this._provider = new WebsocketProvider(wsBase, settings.guid, this.root, { connect: false })
    this._provider.on('connection-close', (event: CloseEvent) => {
      this._handleCloseCode(event)
    })
    if (plugin.settings.serverUrl) {
      this._connectWithAuth()
    }
    this.root.on("update", (update: Uint8Array, origin: any, doc: Y.Doc) => {
      let map = doc.getMap<string>("docs")
      map.forEach((guid, path) => {
        let fullPath = this._vaultRoot + path 
        if (!existsSync(fullPath)) {
          let dir = dirname(fullPath)
          if (!existsSync(dir)) { 
            mkdirSync(dir, { recursive: true})
          }
          open(fullPath,"w", () => {}) //create the file
        }
      })
      // delete files that are no longer shared
      let files = this.plugin.app.vault.getFiles()
      files.forEach(file => {
        // if the file is in the shared folder and not in the map, move it to the Trash
        if (file.path.startsWith(this.settings.path) && !map.has(file.path)) {
          this.plugin.app.vault.adapter.trashLocal(file.path)
        }
      })
    })
  }

  // Get the shared doc for a file
  getDoc(path: string, create: boolean = true): SharedDoc {
    if (!path.startsWith(this.settings.path)) {
      throw new Error('Path is not in shared folder: ' + path)
    }
    const id = this.ids.get(path)
    if (id !== undefined) {
      const doc = this.docs.get(id)
      if (doc !== undefined) {
        return doc
      } else {
        return this.createDoc(path, true)
      }
    } else if (create) {
      return this.createDoc(path, true)
    } else {
      throw new Error('No shared doc for path: ' + path)
    }
  }

  // Create a new shared doc
  createDoc(path: string, loadFromDisk:boolean = false): SharedDoc {
    if (!path.startsWith(this.settings.path)) {
      throw new Error('Path is not in shared folder: ' + path)
    }

    const guid = this.ids.get(path) || randomUUID()
    if (this.docs.get(guid)) throw new Error("Shared doc already exists: " + path)

    const doc = new SharedDoc(path, guid, this)

    var contents = ""
    if (loadFromDisk && existsSync(this._vaultRoot+path)) {
      contents = readFileSync(this._vaultRoot+path, "utf-8")
    }

    const text = doc.ydoc.getText("contents")
    doc.onceSynced().then( () => {
      if (contents && text.toString() != contents)
      text.insert(0, contents)
    })

    this.docs.set(guid, doc)
    this.ids.set(path, guid)
    
    console.log('Created ydoc', path, guid)
     return doc
   }

   deleteDoc(path: string) {
     if (!path.startsWith(this.settings.path)) {
       throw new Error('Path is not in shared folder: ' + path)
     }

     const guid = this.ids.get(path)
     if (guid) {
       this.ids.delete(path)
       this.docs.get(guid).destroy()
       this.docs.delete(guid)
     }
   }
  
  renameDoc(newpath: string, oldpath: string) {
     if (!oldpath.startsWith(this.settings.path)) {
       throw new Error('Path is not in shared folder: ' + oldpath)
     }

    const guid = this.ids.get(oldpath)
    if (guid) {
      this.ids.delete(oldpath)
      this.ids.set(newpath, guid)
   }

  }

  private async _connectWithAuth(): Promise<void> {
    const token = await this.plugin.authManager.getAccessToken()
    if (!token) {
      new Notice('Not signed in — cannot connect to room.')
      return
    }
    this._provider.params = { token }
    this._provider.connect()
  }

  private _handleCloseCode(event: CloseEvent | null): void {
    if (!event) return
    switch (event.code) {
      case 4001:
        this._provider.disconnect()
        new Notice('Session expired — please sign in again.')
        this.plugin.authManager.signOut()
        break
      case 4003:
        new Notice(`Access denied to ${this.settings.name}.`)
        this._removeFromSettings()
        break
      case 4004:
        new Notice(`Room '${this.settings.name}' no longer exists.`)
        this._removeFromSettings()
        break
    }
  }

  private _removeFromSettings(): void {
    this._provider.disconnect()
    const idx = this.plugin.settings.sharedFolders.indexOf(this.settings)
    if (idx !== -1) {
      this.plugin.settings.sharedFolders.splice(idx, 1)
    }
    this.plugin.sharedFolders = this.plugin.sharedFolders.filter(f => f !== this)
    this.destroy()
    this.plugin.saveSettings()
    this.plugin.refreshIconStyles()
  }

  destroy()
  {
    this.docs.forEach(doc => {
      doc.destroy()
      this.docs.delete(doc.guid)
    })
    this._provider.destroy()
  }

}

export class SharedDoc {
  guid: string
  private _parent: SharedFolder
  private _binding: Extension;

    public get binding(): Extension {
        if (!this._binding) {
            const yText = this.ydoc.getText('contents')
            const undoManager = new Y.UndoManager(yText)
            this._binding = yCollab(yText, this._provider.awareness, { undoManager })
        }
        return this._binding;
    }

  private _persistence: IndexeddbPersistence
  private _provider: WebsocketProvider
  ydoc: Y.Doc
  path: string
  username: string

  public get text(): string {
    return this.ydoc.getText('contents').toString()
  }


  constructor(path: string, guid: string, parent: SharedFolder) {
    console.log('Creating shared doc', path, guid)
    this._parent = parent
    this.ydoc = new Y.Doc()
    this._persistence = new IndexeddbPersistence(guid, this.ydoc)
    this.path = path
    this.guid = guid

    const serverUrl = parent.plugin.settings.serverUrl
    const wsBase = `${serverUrl}/room`
    this._provider = new WebsocketProvider(wsBase, guid, this.ydoc, { connect: false })
    this._provider.on('connection-close', (event: CloseEvent) => {
      if (event && (event.code === 4001 || event.code === 4003 || event.code === 4004)) {
        this._provider.disconnect()
      }
    })
    if (serverUrl) {
      this._connectWithAuth()
    }

    const userColor = usercolors[Math.floor(Math.random() * usercolors.length)]
    this._provider.awareness.setLocalStateField('user', {
      name: parent.plugin.settings.username,
      color: userColor.color,
      colorLight: userColor.light
    })
  }

  private async _connectWithAuth(): Promise<void> {
    const token = await this._parent.plugin.authManager.getAccessToken()
    if (!token) return
    this._provider.params = { token }
    this._provider.connect()
  }

  /**
   * Use this Promise to take action the first time the IndexedDB persistence syncs
   * @returns {Promise} A Promise resolving once the IndexedDB persitence has synced
   */
  onceSynced() {
    return new Promise((resolve) => {
      this._persistence.once("synced", resolve)
    })
  }


  connect() {
    if (!this._persistence) this._persistence = new IndexeddbPersistence(this.guid, this.ydoc)
  }

  // This method cleanly tears down the doc's persistence, provider, and binding.
  close() {
    this._binding = null

    this._provider.destroy()
    this._persistence.destroy()
    this._persistence = undefined
  }

  destroy() {
    this._provider?.destroy()
    if (this._persistence) {
      this._persistence.destroy()
    }
  }

}