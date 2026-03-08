import type { App } from 'obsidian'

// Obsidian's App has undocumented localStorage methods (backed by
// electron's localStorage) for key-value storage outside the vault.
interface LocalStorageApp {
  saveLocalStorage(key: string, value: string | null): void
  loadLocalStorage(key: string): string | null
}

export interface StoredTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string // ISO 8601
  email: string
  name: string
}

const KEYS = {
  accessToken: 'mp-access-token',
  refreshToken: 'mp-refresh-token',
  expiresAt: 'mp-token-expiry',
  email: 'mp-user-email',
  name: 'mp-user-name',
} as const

export class TokenStore {
  private _app: LocalStorageApp

  constructor(app: App) {
    this._app = app as unknown as LocalStorageApp
  }

  save(tokens: StoredTokens): void {
    this._app.saveLocalStorage(KEYS.accessToken, tokens.accessToken)
    this._app.saveLocalStorage(KEYS.refreshToken, tokens.refreshToken)
    this._app.saveLocalStorage(KEYS.expiresAt, tokens.expiresAt)
    this._app.saveLocalStorage(KEYS.email, tokens.email)
    this._app.saveLocalStorage(KEYS.name, tokens.name)
  }

  load(): StoredTokens | null {
    const accessToken = this._app.loadLocalStorage(KEYS.accessToken)
    const refreshToken = this._app.loadLocalStorage(KEYS.refreshToken)
    const expiresAt = this._app.loadLocalStorage(KEYS.expiresAt)
    const email = this._app.loadLocalStorage(KEYS.email)
    const name = this._app.loadLocalStorage(KEYS.name)

    if (!accessToken || !refreshToken || !expiresAt || !email || !name) {
      return null
    }

    return { accessToken, refreshToken, expiresAt, email, name }
  }

  clear(): void {
    this._app.saveLocalStorage(KEYS.accessToken, null)
    this._app.saveLocalStorage(KEYS.refreshToken, null)
    this._app.saveLocalStorage(KEYS.expiresAt, null)
    this._app.saveLocalStorage(KEYS.email, null)
    this._app.saveLocalStorage(KEYS.name, null)
  }
}
