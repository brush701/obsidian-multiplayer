'use strict';

import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'

import { yCollab } from 'y-codemirror.next'
import { Extension} from '@codemirror/state'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as random from 'lib0/random'
import { randomUUID } from "crypto";
import { existsSync, readFileSync, open} from "fs"
import { getPassword, setPassword } from './util';
export interface SharedTypeSettings {
  guid: string
  path: string 
  signalingServers: string[]
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
  private _persistence: IndexeddbPersistence
  private _provider: WebrtcProvider
  private _vaultRoot:string
 

  constructor(settings: SharedTypeSettings, vaultRoot: string) {
    this._vaultRoot = vaultRoot + "/"
    this.settings = settings
    this.root = new Y.Doc()
    this.ids = this.root.getMap("docs")
    this.docs = new Map()
    this._persistence = new IndexeddbPersistence(settings.guid, this.root)
    this._provider = new WebrtcProvider(settings.guid, this.root, {signaling: settings.signalingServers, password: getPassword(settings.guid)})
    this._provider.on("update", (update: Uint8Array, origin: any, doc: Y.Doc) => {
      let map = doc.getMap<string>("docs")
      map.forEach((path, guid) => {
        if (existsSync(path)) {
          open(path,"w", () => {}) //create the file
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
        return this.createDoc(path)
      }
    } else if (create) 
      return this.createDoc(path, true)
    else
      throw new Error('No shared doc for path: ' + path)
  }

  // Create a new shared doc
  createDoc(path: string, loadFromDisk:boolean = false): SharedDoc {
    if (!path.startsWith(this.settings.path)) {
      throw new Error('Path is not in shared folder: ' + path)
    }

    var contents = ""
    if (loadFromDisk && existsSync(this._vaultRoot+path)) {
      contents = readFileSync(this._vaultRoot+path, "utf-8")
    }

    const guid = this.ids.get(path) || randomUUID()
    const doc = new SharedDoc(path, guid, this)
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

  destroy()
  {
    this.docs.forEach(doc => {
      doc.destroy()
      this.docs.delete(doc.guid)
    })

  }

}

export class SharedDoc {
  guid: string
  private _parent: SharedFolder
  private _provider: WebrtcProvider;
  private _binding: Extension;

    public get binding(): Extension {
        if (!this._binding) {
            const userColor = usercolors[random.uint32() % usercolors.length]

            const yText = this.ydoc.getText('contents')
            const undoManager = new Y.UndoManager(yText)

            this._provider.awareness.setLocalStateField('user', {
                name: 'Anonymous ' + Math.floor(Math.random() * 100),
                color: userColor.color,
                colorLight: userColor.light
            })

            this._binding = yCollab(yText, this._provider.awareness, { undoManager })
        }
        return this._binding;
    }

  private _persistence: IndexeddbPersistence
  ydoc: Y.Doc
  path: string

  public get text(): string {
    return this.ydoc.getText('contents').toString()
  }

  constructor(path: string, guid: string, parent: SharedFolder) {
    console.log('Creating shared doc', path, guid)
    this._parent = parent
    this.ydoc = new Y.Doc()
    this._persistence = new IndexeddbPersistence(guid, this.ydoc)
    this._provider = new WebrtcProvider(guid, this.ydoc, {password: getPassword(guid), signaling: parent.settings.signalingServers})
    this.path = path
    this.guid = guid
    this.connect()
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
    if(!this._provider) this._provider = new WebrtcProvider(this.guid, this.ydoc, {password: getPassword(this.guid), signaling: this._parent.settings.signalingServers})
    if (!this._provider.connected)
        this._provider.connect()
  }

  // This method cleanly disconnects the underlying provider. It is
  // preferred b/c the getter will auto reconnect
  close() {
    this._provider.disconnect()
    this._provider.destroy()
    this._provider = null

    this._binding = null

    this._persistence.destroy()
    this._persistence = undefined
  } 

  destroy() {
    if (this._provider) {
      this._provider.destroy()
    }
    if (this._persistence) {
      this._persistence.destroy()
    }
  }

}