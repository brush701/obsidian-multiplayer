import type { App } from 'obsidian'
import type { MultiplayerSettings } from './types'
import type { IAuthManager } from './types'

type AuthEvent = 'auth-changed'

export class AuthManager implements IAuthManager {
  private _app: App
  private _settings: MultiplayerSettings
  private _isAuthenticated: boolean = false
  private _userInfo: { email: string; name: string } | null = null
  private _listeners: Set<() => void> = new Set()

  constructor(app: App, settings: MultiplayerSettings) {
    this._app = app
    this._settings = settings
  }

  get isAuthenticated(): boolean {
    return this._isAuthenticated
  }

  get userInfo(): { email: string; name: string } | null {
    return this._userInfo
  }

  async getAccessToken(): Promise<string | null> {
    if (!this._isAuthenticated) {
      return null
    }
    // Stub: real token retrieval wired in TASK-10 (SecretStorage) + TASK-11 (refresh)
    return null
  }

  async signIn(): Promise<void> {
    // Stub: real OAuth PKCE flow wired in TASK-9
    throw new Error('signIn() not yet implemented — see TASK-9')
  }

  async signOut(): Promise<void> {
    this._isAuthenticated = false
    this._userInfo = null
    // Stub: real token clearing wired in TASK-10 + TASK-12
    this._emit('auth-changed')
  }

  on(_event: AuthEvent, handler: () => void): void {
    this._listeners.add(handler)
  }

  off(_event: AuthEvent, handler: () => void): void {
    this._listeners.delete(handler)
  }

  private _emit(_event: AuthEvent): void {
    for (const handler of this._listeners) {
      handler()
    }
  }
}
