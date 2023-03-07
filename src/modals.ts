import { Modal, TFolder, App, FileSystemAdapter } from "obsidian";
import  Multiplayer from "./main"
import { randomUUID } from "crypto";
import { SharedFolder } from "./sharedTypes";

const DEFAULT_SIGNALING_SERVERS = 'wss://signaling.tektite.team'
export class SharedFolderModal extends Modal {
  plugin: Multiplayer;
  folder: TFolder;

  constructor(app: App, plugin: Multiplayer, folder: TFolder) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('modal-style-multiplayer');
    contentEl.empty();
    const sharedFolder = this.plugin.sharedFolders.find(sharedFolder => this.folder.path.contains(sharedFolder.settings.path))
    if (sharedFolder) {
      contentEl.createEl("h2", { text: "SharedFolder already exists" });
      contentEl.createEl('p', { text: 'This folder is already a multiplayer sharedFolder.'})
      const button = contentEl.createEl('button', { text: 'OK', attr: { class: 'btn btn-ok' } })
      button.onClickEvent((ev) => {
        this.close()
      })
    } else {
      contentEl.createEl("h2", { text: "Create a new sharedFolder" });
      contentEl.createEl("form", "form-multiplayer",
        (form) => {
          form.createEl("label", {
            attr: { for: "sharedFolder-guid" },
            text: "Optional GUID: "
          })

          form.createEl("input", {
            type: "text",
            attr: {
              name: "guid",
              id: "sharedFolder-guid"
            },
            placeholder: "SharedFolder password",
          });

          form.createEl("br")

          form.createEl("label", {
            attr: { for: "sharedFolder-password" },
            text: "Optional password: "
          })

          form.createEl("input", {
            type: "password",
            attr: {
              name: "password",
              id: "sharedFolder-password"
            },
            placeholder: "SharedFolder password",
          });
          form.createEl("br")
          form.createEl("br")

          form.createEl("button", {
            text: "Create",
            type: "submit",
          });
          form.onsubmit = async (e) => {
            e.preventDefault();
            // @ts-expect-error, not typed
            const guid = form.querySelector('input[name="guid"]').value || randomUUID()

            const servers = DEFAULT_SIGNALING_SERVERS
            const signalingServers = servers.split(',');
            
            // @ts-expect-error, not typed
            const password = form.querySelector('input[name="password"]').value;
            const path = this.folder.path
            const settings = { guid: guid , path: path, signalingServers: signalingServers, encPw: this.plugin.pwMgr.encryptPassword(password)}
            this.plugin.settings.sharedFolders.push(settings)
            this.plugin.saveSettings();
            this.plugin.sharedFolders.push(new SharedFolder(settings, (this.app.vault.adapter as FileSystemAdapter).getBasePath(), this.plugin))
            this.plugin.addIcons()
            this.close();
          }
        })
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class UnshareFolderModal extends Modal {
  plugin: Multiplayer;
  folder: SharedFolder;

  constructor(app: App, plugin: Multiplayer, folder: SharedFolder) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('modal-style-multiplayer');
    contentEl.empty();
    const sharedFolder = this.plugin.sharedFolders.find(sharedFolder => this.folder.settings.path == sharedFolder.settings.path)
    if (sharedFolder) {
      contentEl.createEl("h2", { text: "Unshare Folder" });
      contentEl.createEl('p', { text: 'Are you sure you want to unshare this folder?'})
      const button = contentEl.createEl('button', { text: 'Unshare Folder', attr: { class: 'btn btn-danger' } })
      button.onClickEvent((ev) => {
        this.plugin.settings.sharedFolders = this.plugin.settings.sharedFolders.filter(el => el.path !== sharedFolder.settings.path)
        this.plugin.sharedFolders = this.plugin.sharedFolders.filter(el => el.settings.path !== sharedFolder.settings.path)
        this.plugin.saveSettings()
        this.plugin.removeIcon(this.folder.settings.path)
        this.folder.docs.forEach(doc => {
          doc.destroy()
        })
        this.folder.destroy()
        this.close()
      })
    } 
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class PasswordModal extends Modal {
  plugin: Multiplayer;
  onSubmit: (result: string) => void


  constructor(app: App, plugin: Multiplayer, onSubmit: (result: string) => void) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('modal-style-multiplayer');
    contentEl.empty();
    contentEl.createEl("h2", { text: "Multiplayer Password" });
    contentEl.createEl('p', { text: 'Please provide your master password. If this is your first time loading the plugin, you can set your new password here.'})
    contentEl.createEl("form", "form-multiplayer",
      (form) => {
        form.createEl("label", {
          attr: { for: "password" },
          text: "Password: "
        })

        form.createEl("input", {
          type: "password",
          attr: {
            name: "password",
            id: "password"
          }
        });

        form.createEl("br")
        form.createEl("br")

        form.createEl("button", {
          text: "Create",
          type: "submit",
        });

        form.onsubmit = async (e) => {
          e.preventDefault();
          // @ts-expect-error, not typed
          const password = form.querySelector('input[name="password"]').value
          this.close()
          this.onSubmit(password)
        }
      })
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class ResetPasswordModal extends Modal {
  plugin: Multiplayer;
  onSubmit: (result: string) => void


  constructor(app: App, plugin: Multiplayer, onSubmit: (result: string) => void) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('modal-style-multiplayer');
    contentEl.empty();
    contentEl.createEl("h2", { text: "Reset Master Password" });
    contentEl.createEl("form", "form-multiplayer",
      (form) => {
        form.createEl("label", {
          attr: { for: "password" },
          text: "New Password: "
        })

        form.createEl("input", {
          type: "password",
          attr: {
            name: "password",
            id: "password"
          }
        });

        form.createEl("br")
        form.createEl("br")

        form.createEl("button", {
          text: "Create",
          type: "submit",
        });

        form.onsubmit = async (e) => {
          e.preventDefault();
          // @ts-expect-error, not typed
          const password = form.querySelector('input[name="password"]').value
          this.close()
          this.onSubmit(password)
        }
      })
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}