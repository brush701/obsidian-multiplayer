import {
  Plugin
} from 'obsidian';


import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { CodemirrorBinding } from 'y-codemirror'
import 'codemirror/mode/javascript/javascript.js'

export default class MultiplayerPlugin extends Plugin {
  yDoc: Y.Doc;
  binding: CodemirrorBinding;
  provider: WebrtcProvider;

  async onload() {
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('brush-test');
    this.provider = new WebrtcProvider(
      'brush-test',
      ydoc
    )

    this.registerCodeMirror(editor => {
      this.binding = new CodemirrorBinding(ytext, editor, this.provider.awareness)
      });
    console.log("loaded obsidian-multiplayer")
  }

  async onunload() {
    this.binding.destroy()
    console.log('unloaded obsidian-multiplayer');
  }

}
