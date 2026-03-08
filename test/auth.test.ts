// Suite: AuthManager
// Scope: Unit
// Spec: TASK-8 — [P2-S1] AuthManager core + TASK-9 — [P2-S2] PKCE sign-in flow
// What this suite validates:
//   - Fresh instance starts unauthenticated with null userInfo and null token
//   - signOut() resets state and emits auth-changed
//   - Event system: on() registers, off() removes, handlers called on emit
//   - PKCE parameter generation (base64url, correct lengths)
//   - signIn() opens browser with correct authorize URL
//   - handleAuthCallback() bridges protocol handler to signIn() flow
//   - Token exchange and userInfo fetch on successful callback
//   - State mismatch rejection
//   - Non-2xx token response error handling
//   - Concurrent signIn() deduplication
//   - Cleanup of code_verifier and state after flow

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AuthManager } from '../src/auth'
import { App } from 'obsidian'
import { makeMultiplayerSettings } from './factories'

const openExternalStub = vi.fn<[string], void>()

function createAuthManager(serverUrl = 'https://example.com') {
  const app = new App()
  const settings = makeMultiplayerSettings({ serverUrl })
  return new AuthManager(app, settings, { openUrl: openExternalStub })
}

// Helper: mock fetch to return token + userinfo responses
function mockFetchSuccess(
  tokenResponse = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    token_type: 'Bearer',
    expires_in: 3600,
  },
  userInfoResponse = {
    sub: '550e8400-e29b-41d4-a716-446655440000',
    email: 'alice@company.com',
    name: 'Alice Chen',
  }
) {
  return vi.fn((url: string) => {
    if (url.includes('/auth/token')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      })
    }
    if (url.includes('/auth/userinfo')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(userInfoResponse),
      })
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`))
  })
}

function mockFetchTokenFailure(status = 400) {
  return vi.fn((url: string) => {
    if (url.includes('/auth/token')) {
      return Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve({ error: 'invalid_grant', error_description: 'bad code' }),
      })
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`))
  })
}

// Helper: start signIn and wait for browser to open, return the authorize URL
async function signInAndGetUrl(auth: AuthManager): Promise<URL> {
  await vi.waitFor(() => {
    expect(openExternalStub).toHaveBeenCalled()
  })
  return new URL(openExternalStub.mock.calls[openExternalStub.mock.calls.length - 1][0])
}

describe('AuthManager', () => {
  beforeEach(() => {
    openExternalStub.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initial state', () => {
    it('isAuthenticated is false', () => {
      const auth = createAuthManager()
      expect(auth.isAuthenticated).toBe(false)
    })

    it('userInfo is null', () => {
      const auth = createAuthManager()
      expect(auth.userInfo).toBeNull()
    })

    it('getAccessToken() returns null', async () => {
      const auth = createAuthManager()
      const token = await auth.getAccessToken()
      expect(token).toBeNull()
    })
  })

  describe('signOut()', () => {
    it('sets isAuthenticated to false and userInfo to null', async () => {
      const auth = createAuthManager()
      await auth.signOut()
      expect(auth.isAuthenticated).toBe(false)
      expect(auth.userInfo).toBeNull()
    })

    it('emits auth-changed', async () => {
      const auth = createAuthManager()
      const handler = vi.fn()
      auth.on('auth-changed', handler)
      await auth.signOut()
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('event system', () => {
    it('on() registers a handler that is called on emit', async () => {
      const auth = createAuthManager()
      const handler = vi.fn()
      auth.on('auth-changed', handler)
      await auth.signOut() // triggers emit
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('supports multiple handlers', async () => {
      const auth = createAuthManager()
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      auth.on('auth-changed', handler1)
      auth.on('auth-changed', handler2)
      await auth.signOut()
      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('off() removes a handler so it is not called', async () => {
      const auth = createAuthManager()
      const handler = vi.fn()
      auth.on('auth-changed', handler)
      auth.off('auth-changed', handler)
      await auth.signOut()
      expect(handler).not.toHaveBeenCalled()
    })

    it('off() only removes the specified handler', async () => {
      const auth = createAuthManager()
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      auth.on('auth-changed', handler1)
      auth.on('auth-changed', handler2)
      auth.off('auth-changed', handler1)
      await auth.signOut()
      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('adding the same handler twice only registers it once', async () => {
      const auth = createAuthManager()
      const handler = vi.fn()
      auth.on('auth-changed', handler)
      auth.on('auth-changed', handler)
      await auth.signOut()
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('signIn() — PKCE flow', () => {
    it('opens browser with correct authorize URL', async () => {
      vi.stubGlobal('fetch', mockFetchSuccess())

      const auth = createAuthManager('https://auth.example.com')
      const signInPromise = auth.signIn()
      const url = await signInAndGetUrl(auth)

      expect(url.origin).toBe('https://auth.example.com')
      expect(url.pathname).toBe('/auth/authorize')
      expect(url.searchParams.get('client_id')).toBe('obsidian-multiplayer')
      expect(url.searchParams.get('redirect_uri')).toBe('obsidian://multiplayer/callback')
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('scope')).toBe('openid profile email')
      expect(url.searchParams.get('code_challenge')).toBeTruthy()
      expect(url.searchParams.get('state')).toBeTruthy()

      auth.handleAuthCallback({ code: 'test-code', state: url.searchParams.get('state')! })
      await signInPromise
    })

    it('code_challenge is base64url SHA-256 of code_verifier', async () => {
      const fetchMock = mockFetchSuccess()
      vi.stubGlobal('fetch', fetchMock)

      const auth = createAuthManager()
      const signInPromise = auth.signIn()
      const url = await signInAndGetUrl(auth)

      const codeChallenge = url.searchParams.get('code_challenge')!
      const state = url.searchParams.get('state')!

      auth.handleAuthCallback({ code: 'test-code', state })
      await signInPromise

      // Get the code_verifier from the token exchange request
      const tokenCall = fetchMock.mock.calls.find((c: string[]) => c[0].includes('/auth/token'))
      const body = new URLSearchParams(tokenCall![1].body)
      const codeVerifier = body.get('code_verifier')!

      // Recompute challenge from verifier and compare
      const encoder = new TextEncoder()
      const hash = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier))
      const hashBytes = new Uint8Array(hash)
      let binary = ''
      for (let i = 0; i < hashBytes.length; i++) {
        binary += String.fromCharCode(hashBytes[i])
      }
      const expectedChallenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      expect(codeChallenge).toBe(expectedChallenge)
    })

    it('sends correct token exchange request', async () => {
      const fetchMock = mockFetchSuccess()
      vi.stubGlobal('fetch', fetchMock)

      const auth = createAuthManager('https://auth.example.com')
      const signInPromise = auth.signIn()
      const url = await signInAndGetUrl(auth)

      auth.handleAuthCallback({ code: 'auth-code-123', state: url.searchParams.get('state')! })
      await signInPromise

      const tokenCall = fetchMock.mock.calls.find((c: string[]) => c[0].includes('/auth/token'))
      expect(tokenCall![0]).toBe('https://auth.example.com/auth/token')
      expect(tokenCall![1].method).toBe('POST')
      expect(tokenCall![1].headers['Content-Type']).toBe('application/x-www-form-urlencoded')

      const body = new URLSearchParams(tokenCall![1].body)
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('auth-code-123')
      expect(body.get('client_id')).toBe('obsidian-multiplayer')
      expect(body.get('redirect_uri')).toBe('obsidian://multiplayer/callback')
      expect(body.get('code_verifier')).toBeTruthy()
    })

    it('sets isAuthenticated and userInfo after successful flow', async () => {
      vi.stubGlobal('fetch', mockFetchSuccess())

      const auth = createAuthManager()
      const signInPromise = auth.signIn()
      const url = await signInAndGetUrl(auth)

      auth.handleAuthCallback({ code: 'test-code', state: url.searchParams.get('state')! })
      await signInPromise

      expect(auth.isAuthenticated).toBe(true)
      expect(auth.userInfo).toEqual({ email: 'alice@company.com', name: 'Alice Chen' })
    })

    it('getAccessToken() returns token after successful sign-in', async () => {
      vi.stubGlobal('fetch', mockFetchSuccess())

      const auth = createAuthManager()
      const signInPromise = auth.signIn()
      const url = await signInAndGetUrl(auth)

      auth.handleAuthCallback({ code: 'test-code', state: url.searchParams.get('state')! })
      await signInPromise

      const token = await auth.getAccessToken()
      expect(token).toBe('test-access-token')
    })

    it('emits auth-changed exactly once on success', async () => {
      vi.stubGlobal('fetch', mockFetchSuccess())

      const auth = createAuthManager()
      const handler = vi.fn()
      auth.on('auth-changed', handler)

      const signInPromise = auth.signIn()
      const url = await signInAndGetUrl(auth)

      auth.handleAuthCallback({ code: 'test-code', state: url.searchParams.get('state')! })
      await signInPromise

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('stays unauthenticated on state mismatch', async () => {
      vi.stubGlobal('fetch', mockFetchSuccess())

      const auth = createAuthManager()
      const signInPromise = auth.signIn()
      await signInAndGetUrl(auth)

      // Send callback with wrong state
      auth.handleAuthCallback({ code: 'test-code', state: 'wrong-state' })
      await signInPromise

      expect(auth.isAuthenticated).toBe(false)
      expect(auth.userInfo).toBeNull()
    })

    it('stays unauthenticated on non-2xx token response', async () => {
      vi.stubGlobal('fetch', mockFetchTokenFailure(400))

      const auth = createAuthManager()
      const signInPromise = auth.signIn()
      const url = await signInAndGetUrl(auth)

      auth.handleAuthCallback({ code: 'test-code', state: url.searchParams.get('state')! })
      await signInPromise

      expect(auth.isAuthenticated).toBe(false)
      expect(auth.userInfo).toBeNull()
    })

    it('stays unauthenticated on network error during token exchange', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      const auth = createAuthManager()
      const signInPromise = auth.signIn()
      const url = await signInAndGetUrl(auth)

      auth.handleAuthCallback({ code: 'test-code', state: url.searchParams.get('state')! })
      await signInPromise

      expect(auth.isAuthenticated).toBe(false)
      expect(auth.userInfo).toBeNull()
    })

    it('second signIn() call returns the same promise', async () => {
      vi.stubGlobal('fetch', mockFetchSuccess())

      const auth = createAuthManager()
      const promise1 = auth.signIn()
      const promise2 = auth.signIn()

      expect(promise2).toBe(promise1)

      // Only one browser window opened
      await vi.waitFor(() => {
        expect(openExternalStub).toHaveBeenCalledTimes(1)
      })

      const url = new URL(openExternalStub.mock.calls[0][0])
      auth.handleAuthCallback({ code: 'test-code', state: url.searchParams.get('state')! })
      await promise1
    })

    it('cleans up code_verifier and state after successful flow', async () => {
      vi.stubGlobal('fetch', mockFetchSuccess())

      const auth = createAuthManager()
      const signInPromise = auth.signIn()
      const url = await signInAndGetUrl(auth)

      auth.handleAuthCallback({ code: 'test-code', state: url.searchParams.get('state')! })
      await signInPromise

      expect((auth as Record<string, unknown>)['_codeVerifier']).toBeNull()
      expect((auth as Record<string, unknown>)['_state']).toBeNull()
      expect((auth as Record<string, unknown>)['_pendingSignIn']).toBeNull()
    })

    it('cleans up code_verifier and state after failed flow', async () => {
      vi.stubGlobal('fetch', mockFetchTokenFailure())

      const auth = createAuthManager()
      const signInPromise = auth.signIn()
      const url = await signInAndGetUrl(auth)

      auth.handleAuthCallback({ code: 'test-code', state: url.searchParams.get('state')! })
      await signInPromise

      expect((auth as Record<string, unknown>)['_codeVerifier']).toBeNull()
      expect((auth as Record<string, unknown>)['_state']).toBeNull()
      expect((auth as Record<string, unknown>)['_pendingSignIn']).toBeNull()
    })

    it('can sign in again after a completed flow', async () => {
      vi.stubGlobal('fetch', mockFetchSuccess())

      const auth = createAuthManager()

      // First sign-in
      const signIn1 = auth.signIn()
      const url1 = await signInAndGetUrl(auth)
      auth.handleAuthCallback({ code: 'code-1', state: url1.searchParams.get('state')! })
      await signIn1
      expect(auth.isAuthenticated).toBe(true)

      // Sign out, then sign in again
      await auth.signOut()
      openExternalStub.mockClear()

      const signIn2 = auth.signIn()
      const url2 = await signInAndGetUrl(auth)
      auth.handleAuthCallback({ code: 'code-2', state: url2.searchParams.get('state')! })
      await signIn2
      expect(auth.isAuthenticated).toBe(true)
    })
  })

  describe('handleAuthCallback()', () => {
    it('does not throw when no sign-in is in progress', () => {
      const auth = createAuthManager()
      expect(() => auth.handleAuthCallback({ code: 'test', state: 'test' })).not.toThrow()
      expect(auth.isAuthenticated).toBe(false)
    })

    it('rejects sign-in when missing code', async () => {
      vi.stubGlobal('fetch', mockFetchSuccess())

      const auth = createAuthManager()
      const signInPromise = auth.signIn()
      await signInAndGetUrl(auth)

      // Callback without code
      auth.handleAuthCallback({ state: 'some-state' })
      await signInPromise

      expect(auth.isAuthenticated).toBe(false)
    })
  })

  describe('PKCE parameter quality', () => {
    it('code_verifier and state are base64url encoded (no +, /, or =)', async () => {
      const fetchMock = mockFetchSuccess()
      vi.stubGlobal('fetch', fetchMock)

      const auth = createAuthManager()
      const signInPromise = auth.signIn()
      const url = await signInAndGetUrl(auth)

      const state = url.searchParams.get('state')!
      const codeChallenge = url.searchParams.get('code_challenge')!

      // Verify code_challenge and state are base64url
      expect(codeChallenge).not.toMatch(/[+/=]/)
      expect(state).not.toMatch(/[+/=]/)

      auth.handleAuthCallback({ code: 'test-code', state })
      await signInPromise

      // Verify code_verifier from token request is base64url
      const tokenCall = fetchMock.mock.calls.find((c: string[]) => c[0].includes('/auth/token'))
      const body = new URLSearchParams(tokenCall![1].body)
      const codeVerifier = body.get('code_verifier')!
      expect(codeVerifier).not.toMatch(/[+/=]/)
      // 64 bytes base64url ≈ 86 chars
      expect(codeVerifier.length).toBeGreaterThan(40)
    })
  })
})
