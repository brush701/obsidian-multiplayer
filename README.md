## Obsidian Multiplayer

This is a real-time collaboration plugin for [Obsidian](https://obsidian.md).

The goal is to achieve functionality similar to Google Docs by building on top of [Yjs](www.yjs.dev). 

**Note:** This plugin is still in development and is pre-alpha. It definitely has bugs, which could result in loss of data! Please back up your vaults before use. I don't have a lot of time to work on it right now, so collaborators are welcome!

### Creating a Room
Collaboration is built around the notion of Rooms: groups of files which are simultaneously editable by many users. Unlike Google Docs, we do not provide fine-grained permissioning. Everything is built on top of the Yjs WebRTC connector, which is fundamentally peer-to-peer. There are no administrators. Any user that has the Room's ID and password can access and modify its contents. Access can only be revoked by generating a new ID and password for the room.

For access control, we can use nested Rooms. While each folder can have one one Room attached to it, sub-folders can be mapped to their own rooms. Users with access to a nested room cannot see files in parent rooms. (**Note:** this is unaudited. It's possible there's a way to access parent folders that I haven't identified, so don't rely on this for sensitive information!) 

Rooms are created from the right-click menu on folders in the vault: just choose "New Room" to begin the process. If you are creating a Room for the first time, you can generate a new ID and choose a password; if the Room was shared with you simply enter the ID and password you were provided.
