// Suite: AuthManager
// Scope: Unit
// Spec: TASK-8 — [P2-S1] AuthManager core
// What this suite validates:
//   - Fresh instance starts unauthenticated with null userInfo and null token
//   - signOut() resets state and emits auth-changed
//   - signIn() throws (stub, not yet implemented)
//   - Event system: on() registers, off() removes, handlers called on emit
// What is explicitly NOT tested here:
//   - OAuth PKCE flow (TASK-9)
//   - Token persistence / SecretStorage (TASK-10)
//   - Token refresh logic (TASK-11)

import { describe, it, expect, vi } from 'vitest'
import { AuthManager } from '../src/auth'
import { App } from 'obsidian'
import { makeMultiplayerSettings } from './factories'

function createAuthManager() {
  const app = new App()
  const settings = makeMultiplayerSettings({ serverUrl: 'https://example.com' })
  return new AuthManager(app, settings)
}

describe('AuthManager', () => {
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

  describe('signIn()', () => {
    it('throws (stub not yet implemented)', async () => {
      const auth = createAuthManager()
      await expect(auth.signIn()).rejects.toThrow('not yet implemented')
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
})
