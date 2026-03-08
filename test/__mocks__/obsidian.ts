// Minimal stubs for the Obsidian host API.
// Only the surface area used by the plugin source is represented here.
// Tests that need more detail should extend these stubs locally.

class DataAdapter {
  getBasePath(): string { return '/vault' }
}

class Vault {
  adapter = new DataAdapter()
}

export class App {
  vault = new Vault()
  private _localStorage = new Map<string, string>()
  saveLocalStorage(key: string, value: string | null): void {
    if (value === null) {
      this._localStorage.delete(key)
    } else {
      this._localStorage.set(key, value)
    }
  }
  loadLocalStorage(key: string): string | null {
    return this._localStorage.get(key) ?? null
  }
}

export class Plugin {
  app: App
  constructor(app: App, _manifest: unknown) {
    this.app = app
  }
  async loadData(): Promise<unknown> { return {} }
  async saveData(_data: unknown): Promise<void> {}
  addSettingTab(_tab: unknown): void {}
  registerEvent(_event: unknown): void {}
  register(_fn: unknown): void {}
  registerEditorExtension(_ext: unknown): void {}
  registerObsidianProtocolHandler(_action: string, _handler: unknown): void {}
}

export class PluginSettingTab {
  app: App
  constructor(app: App, _plugin: unknown) {
    this.app = app
  }
}

export class Setting {
  constructor(_containerEl: unknown) {}
  setName(_name: string): this { return this }
  setDesc(_desc: string): this { return this }
  addText(_cb: (_text: unknown) => void): this { return this }
}

export class ButtonComponent {
  constructor(_containerEl: unknown) {}
  setButtonText(_text: string): this { return this }
  onClick(_cb: (_e: unknown) => void): this { return this }
}

export class Notice {
  constructor(_message: string) {}
}

export class TFile {
  path: string
  constructor(path: string) { this.path = path }
}

export class TFolder {
  path: string
  constructor(path: string) { this.path = path }
}

export class MarkdownView {
}

export class FileSystemAdapter extends DataAdapter {}

export function requestUrl() {
  throw new Error('requestUrl must be mocked in tests')
}
