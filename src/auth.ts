import type { App } from 'obsidian'
import { Notice } from 'obsidian'
import type { MultiplayerSettings } from './types'
import type { IAuthManager } from './types'
import { TokenStore } from './tokenStore'
import type { Server, IncomingMessage, ServerResponse } from 'http'

type AuthEvent = 'auth-changed'

interface AuthCallbackParams {
  code: string
  state: string
}

const SIGN_IN_TIMEOUT_MS = 120_000 // 2 minutes

export interface AuthManagerDeps {
  openUrl: (url: string) => void
  createServer?: (handler: (req: IncomingMessage, res: ServerResponse) => void) => Server
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
  private _tokenStore: TokenStore
  private _isAuthenticated = false
  private _hasAuthError = false
  private _userInfo: { email: string; name: string } | null = null
  private _listeners: Set<() => void> = new Set()

  // PKCE flow state (in-memory only, never persisted)
  private _pendingSignIn: Promise<void> | null = null
  private _codeVerifier: string | null = null
  private _state: string | null = null
  private _callbackServer: Server | null = null

  // In-memory cache of tokens (persisted via TokenStore)
  private _accessToken: string | null = null
  private _pendingRefresh: Promise<string | null> | null = null

  constructor(app: App, settings: MultiplayerSettings, deps: AuthManagerDeps = defaultDeps) {
    this._app = app
    this._settings = settings
    this._deps = deps
    this._tokenStore = new TokenStore(app)
  }

  get isAuthenticated(): boolean {
    return this._isAuthenticated
  }

  get hasAuthError(): boolean {
    return this._hasAuthError
  }

  get userInfo(): { email: string; name: string } | null {
    return this._userInfo
  }

  async getAccessToken(): Promise<string | null> {
    if (!this._isAuthenticated) {
      return null
    }

    const tokens = this._tokenStore.load()
    if (!tokens) {
      return null
    }

    const msUntilExpiry = new Date(tokens.expiresAt).getTime() - Date.now()
    if (msUntilExpiry > 60_000) {
      return this._accessToken
    }

    // Token is near expiry or expired — refresh it
    if (this._pendingRefresh) {
      return this._pendingRefresh
    }

    this._pendingRefresh = this._refreshTokens(tokens.refreshToken).finally(() => {
      this._pendingRefresh = null
    })
    return this._pendingRefresh
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

    // Step 2: Start loopback HTTP server and wait for callback (RFC 8252 §7.3)
    const { callbackParams, redirectUri } = await this._startCallbackServer()

    // Step 3: Open browser to authorize endpoint
    const params = new URLSearchParams({
      client_id: 'obsidian-multiplayer',
      redirect_uri: redirectUri,
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
      const result = await callbackParams

      // Step 5: Validate state
      if (result.state !== this._state) {
        new Notice('Sign-in failed — invalid state parameter.')
        return
      }

      // Step 6: Exchange code for tokens
      const tokenResponse = await this._exchangeCodeForTokens(result.code, redirectUri)
      this._accessToken = tokenResponse.access_token

      // Step 7: Fetch user info
      const userInfo = await this._fetchUserInfo(tokenResponse.access_token)
      this._userInfo = { email: userInfo.email, name: userInfo.name }

      // Step 8: Persist tokens to localStorage
      const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      this._tokenStore.save({
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt,
        email: userInfo.email,
        name: userInfo.name,
      })

      this._isAuthenticated = true
      this._hasAuthError = false
      this._emit('auth-changed')
    } catch {
      new Notice('Sign-in failed — try again.')
    }
  }

  private _startCallbackServer(): Promise<{
    callbackParams: Promise<AuthCallbackParams>
    redirectUri: string
  }> {
    return new Promise((resolveSetup) => {
      let resolveCallback: (params: AuthCallbackParams) => void
      let rejectCallback: (reason: Error) => void

      const callbackParams = new Promise<AuthCallbackParams>((resolve, reject) => {
        resolveCallback = resolve
        rejectCallback = reject
      })

      const timeout = setTimeout(() => {
        rejectCallback(new Error('Sign-in timed out'))
        this._shutdownCallbackServer()
      }, SIGN_IN_TIMEOUT_MS)

      const createServer = this._deps.createServer ?? (() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const http = require('http')
        return http.createServer()
      })

      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1`)
        if (url.pathname !== '/callback') {
          res.writeHead(404)
          res.end()
          return
        }

        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><p>Sign-in complete. You can close this tab.</p></body></html>')

        clearTimeout(timeout)

        if (!code || !state) {
          rejectCallback(new Error('Missing code or state'))
        } else {
          resolveCallback({ code, state })
        }

        this._shutdownCallbackServer()
      })

      this._callbackServer = server

      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        const redirectUri = `http://127.0.0.1:${port}/callback`
        resolveSetup({ callbackParams, redirectUri })
      })
    })
  }

  private _shutdownCallbackServer(): void {
    if (this._callbackServer) {
      this._callbackServer.close()
      this._callbackServer = null
    }
  }

  async signOutWithAuthError(): Promise<void> {
    this._hasAuthError = true
    await this.signOut()
  }

  async signOut(): Promise<void> {
    // Fire-and-forget server-side logout (best-effort, never blocks local sign-out)
    if (this._accessToken) {
      fetch(`${this._settings.serverUrl}/auth/logout`, {
        headers: { Authorization: `Bearer ${this._accessToken}` },
      }).catch(() => {})
    }

    this._isAuthenticated = false
    this._userInfo = null
    this._accessToken = null
    this._tokenStore.clear()
    this._emit('auth-changed')
  }

  async restoreSession(): Promise<void> {
    const tokens = this._tokenStore.load()
    if (!tokens) return

    // Restore user info and auth state first so _refreshTokens can work
    this._userInfo = { email: tokens.email, name: tokens.name }
    this._accessToken = tokens.accessToken
    this._isAuthenticated = true

    const msUntilExpiry = new Date(tokens.expiresAt).getTime() - Date.now()
    if (msUntilExpiry <= 0) {
      // Access token expired — try refresh (refresh token has 30-day sliding window)
      const newToken = await this._refreshTokens(tokens.refreshToken)
      if (!newToken) {
        // _refreshTokens already called signOut() and emitted auth-changed
        return
      }
    }

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
    this._pendingSignIn = null
    this._shutdownCallbackServer()
  }

  private async _refreshTokens(refreshToken: string): Promise<string | null> {
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: 'obsidian-multiplayer',
      })

      const response = await fetch(`${this._settings.serverUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })

      if (!response.ok) {
        this._hasAuthError = true
        await this.signOut()
        new Notice('Session expired — please sign in again')
        return null
      }

      const data: { access_token: string; refresh_token: string; expires_in: number } =
        await response.json()

      const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
      this._tokenStore.save({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
        email: this._userInfo?.email ?? '',
        name: this._userInfo?.name ?? '',
      })

      this._accessToken = data.access_token
      return data.access_token
    } catch {
      this._hasAuthError = true
      await this.signOut()
      new Notice('Session expired — please sign in again')
      return null
    }
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

  private async _exchangeCodeForTokens(code: string, redirectUri: string): Promise<{
    access_token: string
    refresh_token: string
    token_type: string
    expires_in: number
  }> {
    if (!this._codeVerifier) {
      throw new Error('No code verifier — signIn() must be called first')
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: this._codeVerifier,
      client_id: 'obsidian-multiplayer',
      redirect_uri: redirectUri,
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
