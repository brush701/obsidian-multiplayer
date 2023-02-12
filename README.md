## Obsidian Multiplayer
## ⚠️ Pre-Alpha Software ⚠ ️ 
This software is in the pre-alpha stage. There is a real risk of data loss, DO NOT USE THIS WITH YOUR REGULAR VAULT!

### About
This is a real-time collaboration plugin for [Obsidian](https://obsidian.md).

The goal is to achieve functionality similar to Google Docs by building on top of [Yjs](www.yjs.dev). 
### Creating a SharedFolder
Collaboration is built around the notion of SharedFolders: groups of files which are simultaneously editable by many users. Unlike Google Docs, we do not provide fine-grained permissioning. Everything is built on top of the Yjs WebRTC connector, which is fundamentally peer-to-peer. There are no administrators. Any user that has the SharedFolder's ID and password (coming soon) can access and modify its contents. Access can only be revoked by generating a new ID and password for the sharedFolder. SharedFolders cannot be nested — all subfolders will be shared with the same access controls.

SharedFolders are created from the right-click menu on folders in the vault: just choose "New Multiplayer SharedFolder" to begin the process. If you are creating a SharedFolder for the first time, you can generate a new ID and choose a password; if the SharedFolder was shared with you simply enter the ID and password you were provided.

If you convert a folder that already has files in it into a SharedFolder _and_ that SharedFolder is already in use by other people _and_ one of those other people already created a file with the same path as a document already in your local folder, then their "preexisting" shared document will overwrite your local copy. We should probably throw up a warning dialog here, but I haven't gotten to it yet. Best practice is only set up empty folders as SharedFolders unless you are very confident in what you're doing.

### Internals
Objects representing conflict-free replicated data types (CRDTs) are stored in Obsidian's internal datastore (IndexedDB). Your local markdown files are "snapshots," but the CRDTs are the source of truth. We keep the two synced in real-time, so users shouldn't care too much about this detail. Note that there could be (probably are??) some pernicious bugs related to this since we're not doing anything particularly clever to manage the syncing.