import {
  MarkdownSourceView,
  MarkdownView,
  Plugin
} from 'obsidian';

import * as CodeMirror from 'codemirror'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { CodemirrorBinding } from 'y-codemirror'
import 'codemirror/mode/javascript/javascript.js'

export default class MultiplayerPlugin extends Plugin {
  yDoc: Y.Doc;
  binding: CodemirrorBinding;
  provider: WebrtcProvider;

  get editor(): CodeMirror.Editor {
    const view = this.app.workspace.activeLeaf.view;
    if (!(view instanceof MarkdownView)) return null;

    const sourceView = view.sourceMode;
    return (sourceView as MarkdownSourceView).cmEditor;
  }

  async onload() {
    const ydoc = new Y.Doc()
    var ytext = ydoc.getText('brush-test');
    this.provider = new WebrtcProvider(
      'brush-test',
      ydoc
    )
    this.binding = new CodemirrorBinding(ytext, this.editor, this.provider.awareness)
    console.log("loaded obsidian-multiplayer")
  }

  async onunload() {
    this.binding.destroy()
    console.log('unloaded obsidian-multiplayer');
  }

}
