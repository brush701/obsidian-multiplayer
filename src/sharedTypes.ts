'use strict';

import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'

import { yCollab } from 'y-codemirror.next'
import { Extension} from '@codemirror/state'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as random from 'lib0/random'
import { randomUUID } from "crypto";
import * as fs from 'fs'

export interface SharedFolderSettings {
  guid: string
  path: string 
  signalingServers?: string[]
  password?: string
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
  guid: string
  root: Y.Doc
  basePath: string
  ids: Y.Map<string> // Maps document paths to guids
  docs: Map<string, SharedDoc> // Maps guids to SharedDocs
  private _persistence: IndexeddbPersistence
  private _provider: WebrtcProvider

  constructor({guid, path, signalingServers, password}: SharedFolderSettings) {
    this.basePath = path
    this.guid = guid
    this.root = new Y.Doc()
    this.ids = this.root.getMap("docs")
    this.docs = new Map()
    this._persistence = new IndexeddbPersistence(guid, this.root)
    this._provider = new WebrtcProvider(guid, this.root)
    this._provider.on("update", (update: Uint8Array, origin: any, doc: Y.Doc) => {
      let map = doc.getMap<string>("docs")
      map.forEach((path, guid) => {
        if (!fs.existsSync(path)) {
          fs.open(path,"w", () => {}) //create the file
        }
      })
    })
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
    const doc = new SharedDoc(path, guid)
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

  constructor(path: string, guid: string) {
    console.log('Creating shared doc', path, guid)
    this.ydoc = new Y.Doc()
    this._persistence = new IndexeddbPersistence(guid, this.ydoc)
    this._provider = new WebrtcProvider(guid, this.ydoc)
    this.path = path
    this.guid = guid
  }


  connect() {
    if (!this._persistence) this._persistence = new IndexeddbPersistence(this.guid, this.ydoc) 
    if(!this._provider) this._provider = new WebrtcProvider(this.guid, this.ydoc)
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