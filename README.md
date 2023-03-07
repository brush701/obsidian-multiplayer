![](banner.png)
![](https://img.shields.io/github/downloads/brush701/obsidian-multiplayer/total) 
![](https://img.shields.io/github/license/brush701/obsidian-multiplayer)
![](https://img.shields.io/github/manifest-json/v/brush701/obsidian-multiplayer)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/brush701?style=social)](https://github.com/sponsors/brush701)
[![Paypal](https://img.shields.io/badge/PayPal-brush701-yellow?style=social&logo=paypal)](https://www.paypal.me/brush701)


## ⚠️ Pre-Alpha Software ⚠ ️ 
This software is in the pre-alpha stage. There is a real risk of data loss, DO NOT USE THIS WITH YOUR REGULAR VAULT!

## About
This is a real-time collaboration plugin for [Obsidian](https://obsidian.md).

The goal is to achieve functionality similar to Google Docs by building on top of [Yjs](www.yjs.dev). 

## Demo
Todo

## Installing
### From within Obsidian
Once the plugin goes live, the following will work:

From Obsidian, you can activate this plugin within Obsidian by doing the following:

- Open Settings > Third-party plugin
- Make sure Safe mode is off
- Click Browse community plugins
- Search for "Advanced Tables"
- Click Install

Once installed, close the community plugins window and activate the newly installed plugin
### Build from Source
Clone this repository, then run `npm install` and `npm run build`. The resulting file, `main.js`, will be placed in the test vault located at `test/vault/.obsidian/plugins/obsidian-multiplayer`. You can test the plugin using the test vault, or you can copy the `obsidian-multiplayer` folder to another vault. 
## Usage 
### Creating a SharedFolder
Collaboration is built around the notion of SharedFolders: groups of files which are simultaneously editable by many users. Unlike Google Docs, we do not yet provide fine-grained permissioning. Any user that has the SharedFolder's ID and password can access and modify its contents. Access can only be revoked by generating a new ID and password for the SharedFolder. SharedFolders cannot be nested — all subfolders will be shared with the same access controls.

SharedFolders are created from the right-click menu on folders in the vault: just choose "New Multiplayer SharedFolder" to begin the process. If you are creating a SharedFolder for the first time, you can generate a new ID and choose a password; if the SharedFolder was shared with you simply enter the ID and password you were provided.

If you convert a folder that already has files in it into a SharedFolder _and_ that SharedFolder is already in use by other people _and_ one of those other people already created a file with the same path as a document already in your local folder, then their "preexisting" shared document will overwrite your local copy. We should probably throw up a warning dialog here, but I haven't gotten to it yet. Best practice is only set up empty folders as SharedFolders unless you are very confident in what you're doing.

### Collaboration
Once you have created a SharedFolder, you can start collaborating. First right-click the folder and choose "Copy GUID", then share that GUID (along with the password, if applicable) with your collaborators. It's outside the scope of this plugin to handle secure transmission of paswords, but consider using a password manager or E2EE messaging platform like Signal for this purpose. 

Once your collaborators have the GUID & password, they can create an empty folder in their vault and right-click to turn it into a SharedFolder. They should enter the GUID and password at the modal that pops up, at which point any files created by any collaborators will be replicated across peers. Note that the file content is lazy-loaded. If you delete a file from the SharedFolder, it will be moved to the local trash folder on remote peers (`vault-root/.trash`). 

## Security
Because we use a peer-to-peer protocol (WebRTC), all file data is exchanged directly with your collaborators and does not hit any third party servers. In order to find peers, we do run a lightweight signaling server that does not see any of the data contained in your files. For additional security and access control, you can specify a password which will be used to encrypt your communciations. All collaborators on a file must have this password. Passwords are encrypted using `AES-GCM` and a key derived from a master password that the user must enter when the plugin loads. 