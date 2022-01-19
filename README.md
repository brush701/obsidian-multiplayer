## Obsidian Multiplayer

This is a real-time collaboration plugin for [Obsidian](https://obsidian.md).

The goal is to achieve functionality similar to Google Docs by building on top of [Yjs](www.yjs.dev). 

**Note:** This plugin is still in early alpha and definitely has bugs, which could result in loss of data! Please back up your vaults before use.

### Creating a Room
Collaboration is built around the notion of Rooms: groups of files which are simultaneously editable by many users. Unlike Google Docs, we do not provide fine-grained permissioning. Everything is built on top of the Yjs WebRTC connector, which is fundamentally peer-to-peer. There are no administrators. Any user that has the Room's ID and password can access and modify its contents. Access can only be revoked by generating a new ID and password for the room. 

Rooms are created from the right-click menu on folders in the vault: just choose "New Room" to begin the process. If you are creating a Room for the first time, you can generate a new ID and choose a password; if the Room was shared with you simply enter the ID and password you were provided.