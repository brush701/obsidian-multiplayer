## Obsidian Multiplayer

This is a real-time collaboration plugin for [Obsidian](https://obsidian.md).

The goal is to achieve functionality similar to Google Docs by building on top of [Yjs](www.yjs.dev). 

**Note:** This plugin is still in development and is pre-alpha. It definitely has bugs, which could result in loss of data! Please back up your vaults before use. I don't have a lot of time to work on it right now, so collaborators are welcome!

### Creating a Room
Collaboration is built around the notion of Rooms: groups of files which are simultaneously editable by many users. Unlike Google Docs, we do not provide fine-grained permissioning. Everything is built on top of the Yjs WebRTC connector, which is fundamentally peer-to-peer. There are no administrators. Any user that has the Room's ID and password can access and modify its contents. Access can only be revoked by generating a new ID and password for the room. Rooms cannot be nested.

Ditch the original plan, cut over to websockets with a central server? Supports needed authentication mechanisms... 

Rooms are created from the right-click menu on folders in the vault: just choose "New Room" to begin the process. If you are creating a Room for the first time, you can generate a new ID and choose a password; if the Room was shared with you simply enter the ID and password you were provided.

CRDTs stored in persistence layer (eg leveldb). Local markdown files are "snapshots". This somewhat complicates the onLoad event. We need to make sure that once we load the file, we first sync changes down from the CRDT and don't start writing new ones until that's done. We're fine with whatever is written out to disk (probably need to double check that this is correct). 
