## Obsidian Multiplayer

This is a real-time collaboration plugin for [Obsidian](https://obsidian.md).

The goal is to achieve functionality similar to Google Docs by building on top of [Yjs](www.yjs.dev). 

**Note:** This plugin is still in development and is pre-alpha. It definitely has bugs, which could result in loss of data! Please back up your vaults before use. I don't have a lot of time to work on it right now, so collaborators are welcome!

### Creating a Room
Collaboration is built around the notion of Rooms: groups of files which are simultaneously editable by many users. Unlike Google Docs, we do not provide fine-grained permissioning. Everything is built on top of the Yjs WebRTC connector, which is fundamentally peer-to-peer. There are no administrators. Any user that has the Room's ID and password can access and modify its contents. Access can only be revoked by generating a new ID and password for the room. Rooms cannot be nested and room names must be unique on their signalling servers. We may switch to the Matrix-CRDT provider which would allow us to leverage all the goodness of Matrix for auth, hosting, and E2EE.

Rooms are created from the right-click menu on folders in the vault: just choose "New Room" to begin the process. If you are creating a Room for the first time, you can generate a new ID and choose a password; if the Room was shared with you simply enter the ID and password you were provided.

CRDTs stored in persistence layer (eg leveldb). Local markdown files are "snapshots" but Obsidian does a good job of keeping them synced. Note that there could be (probably are??) some pernicious bugs related to this since we're not doing anything particularly clever to manage keeping these things in sync.