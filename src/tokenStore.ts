import type { App } from 'obsidian'

// Obsidian's DataAdapter has undocumented LocalForage-backed methods for
// key-value storage that don't touch the vault filesystem.
interface SecretAdapter {
  store(key: string, value: string): Promise<void>
  load(key: string): Promise<string | null>
  remove(key: string): Promise<void>
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
  private _app: App

  constructor(app: App) {
    this._app = app
  }

  private get _adapter(): SecretAdapter {
    return this._app.vault.adapter as unknown as SecretAdapter
  }

  async save(tokens: StoredTokens): Promise<void> {
    const adapter = this._adapter
    await adapter.store(KEYS.accessToken, tokens.accessToken)
    await adapter.store(KEYS.refreshToken, tokens.refreshToken)
    await adapter.store(KEYS.expiresAt, tokens.expiresAt)
    await adapter.store(KEYS.email, tokens.email)
    await adapter.store(KEYS.name, tokens.name)
  }

  async load(): Promise<StoredTokens | null> {
    const adapter = this._adapter
    const accessToken = await adapter.load(KEYS.accessToken)
    const refreshToken = await adapter.load(KEYS.refreshToken)
    const expiresAt = await adapter.load(KEYS.expiresAt)
    const email = await adapter.load(KEYS.email)
    const name = await adapter.load(KEYS.name)

    if (!accessToken || !refreshToken || !expiresAt || !email || !name) {
      return null
    }

    return { accessToken, refreshToken, expiresAt, email, name }
  }

  async clear(): Promise<void> {
    const adapter = this._adapter
    await adapter.remove(KEYS.accessToken)
    await adapter.remove(KEYS.refreshToken)
    await adapter.remove(KEYS.expiresAt)
    await adapter.remove(KEYS.email)
    await adapter.remove(KEYS.name)
  }
}
