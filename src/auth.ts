import type { App } from 'obsidian'
import { Notice } from 'obsidian'
import type { MultiplayerSettings } from './types'
import type { IAuthManager } from './types'

type AuthEvent = 'auth-changed'

interface AuthCallbackParams {
  code: string
  state: string
}

export interface AuthManagerDeps {
  openUrl: (url: string) => void
}

const defaultDeps: AuthManagerDeps = {
  openUrl: (url: string) => {
    // electron is available at runtime in Obsidian's Electron environment
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { shell } = require('electron')
    shell.openExternal(url)
  },
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class AuthManager implements IAuthManager {
  private _app: App
  private _settings: MultiplayerSettings
  private _deps: AuthManagerDeps
  private _isAuthenticated: boolean = false
  private _userInfo: { email: string; name: string } | null = null
  private _listeners: Set<() => void> = new Set()

  // PKCE flow state (in-memory only, never persisted)
  private _pendingSignIn: Promise<void> | null = null
  private _codeVerifier: string | null = null
  private _state: string | null = null
  private _resolveCallback: ((params: AuthCallbackParams) => void) | null = null
  private _rejectCallback: ((reason: Error) => void) | null = null

  // In-memory token storage (placeholder for TASK-10 SecretStorage)
  private _accessToken: string | null = null
  private _refreshToken: string | null = null

  constructor(app: App, settings: MultiplayerSettings, deps: AuthManagerDeps = defaultDeps) {
    this._app = app
    this._settings = settings
    this._deps = deps
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
    return this._accessToken
  }

  signIn(): Promise<void> {
    if (this._pendingSignIn) {
      return this._pendingSignIn
    }

    this._pendingSignIn = this._doSignIn().finally(() => {
      this._cleanup()
    })
    return this._pendingSignIn
  }

  private async _doSignIn(): Promise<void> {
    // Step 1: Generate PKCE parameters
    this._codeVerifier = this._generateCodeVerifier()
    this._state = this._generateState()
    const codeChallenge = await this._computeCodeChallenge(this._codeVerifier)

    // Step 2: Create a promise that waits for the protocol handler callback
    const callbackPromise = new Promise<AuthCallbackParams>((resolve, reject) => {
      this._resolveCallback = resolve
      this._rejectCallback = reject
    })

    // Step 3: Open browser to authorize endpoint
    const params = new URLSearchParams({
      client_id: 'obsidian-multiplayer',
      redirect_uri: 'obsidian://multiplayer/callback',
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: this._state,
      scope: 'openid profile email',
    })

    const authorizeUrl = `${this._settings.serverUrl}/auth/authorize?${params.toString()}`
    this._deps.openUrl(authorizeUrl)

    // Step 4: Wait for callback, validate, and exchange
    try {
      const callbackParams = await callbackPromise

      // Step 5: Validate state
      if (callbackParams.state !== this._state) {
        new Notice('Sign-in failed — invalid state parameter.')
        return
      }

      // Step 6: Exchange code for tokens
      const tokenResponse = await this._exchangeCodeForTokens(callbackParams.code)
      this._accessToken = tokenResponse.access_token
      this._refreshToken = tokenResponse.refresh_token

      // Step 7: Fetch user info
      const userInfo = await this._fetchUserInfo(tokenResponse.access_token)
      this._userInfo = { email: userInfo.email, name: userInfo.name }
      this._isAuthenticated = true
      this._emit('auth-changed')
    } catch {
      new Notice('Sign-in failed — try again.')
    }
  }

  handleAuthCallback(params: Record<string, string>): void {
    const code = params['code']
    const state = params['state']

    if (!this._resolveCallback) {
      new Notice('No sign-in in progress.')
      return
    }

    if (!code || !state) {
      new Notice('Sign-in failed — missing parameters.')
      this._rejectCallback?.(new Error('Missing code or state'))
      return
    }

    this._resolveCallback({ code, state })
  }

  async signOut(): Promise<void> {
    this._isAuthenticated = false
    this._userInfo = null
    this._accessToken = null
    this._refreshToken = null
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

  private _cleanup(): void {
    this._codeVerifier = null
    this._state = null
    this._resolveCallback = null
    this._rejectCallback = null
    this._pendingSignIn = null
  }

  private _generateCodeVerifier(): string {
    const bytes = new Uint8Array(64)
    crypto.getRandomValues(bytes)
    return base64urlEncode(bytes)
  }

  private _generateState(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return base64urlEncode(bytes)
  }

  private async _computeCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(verifier)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return base64urlEncode(new Uint8Array(hash))
  }

  private async _exchangeCodeForTokens(code: string): Promise<{
    access_token: string
    refresh_token: string
    token_type: string
    expires_in: number
  }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: this._codeVerifier!,
      client_id: 'obsidian-multiplayer',
      redirect_uri: 'obsidian://multiplayer/callback',
    })

    const response = await fetch(`${this._settings.serverUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`)
    }

    return response.json()
  }

  private async _fetchUserInfo(accessToken: string): Promise<{
    sub: string
    email: string
    name: string
  }> {
    const response = await fetch(`${this._settings.serverUrl}/auth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      throw new Error(`UserInfo fetch failed: ${response.status}`)
    }

    return response.json()
  }
}
