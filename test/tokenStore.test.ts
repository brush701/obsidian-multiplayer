// Suite: TokenStore
// Scope: Unit
// Spec: TASK-10 — [P2-S3] Token storage (SecretStorage)
// What this suite validates:
//   - save() persists tokens, load() retrieves them
//   - clear() removes all tokens so load() returns null
//   - load() returns null when keys are missing or only partially present
//   - save() overwrites previously stored values
//   - Property: stored tokens round-trip correctly for arbitrary valid strings

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { App } from 'obsidian'
import { TokenStore } from '../src/tokenStore'
import type { StoredTokens } from '../src/tokenStore'

function createTokenStore(): TokenStore {
  const app = new App()
  return new TokenStore(app)
}

const sampleTokens: StoredTokens = {
  accessToken: 'access-abc-123',
  refreshToken: 'refresh-xyz-789',
  expiresAt: '2026-03-08T20:00:00.000Z',
  email: 'alice@company.com',
  name: 'Alice Chen',
}

describe('TokenStore', () => {
  it('load() returns null on fresh app', () => {
    const store = createTokenStore()
    expect(store.load()).toBeNull()
  })

  it('save() then load() returns matching StoredTokens', () => {
    const store = createTokenStore()
    store.save(sampleTokens)
    expect(store.load()).toEqual(sampleTokens)
  })

  it('clear() then load() returns null', () => {
    const store = createTokenStore()
    store.save(sampleTokens)
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('save() then clear() then load() returns null', () => {
    const store = createTokenStore()
    store.save(sampleTokens)
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('load() returns null if only a subset of keys exist', () => {
    const app = new App()
    // Write only 2 of 5 keys directly
    app.saveLocalStorage('mp-access-token', 'partial')
    app.saveLocalStorage('mp-user-email', 'partial@test.com')

    const store = new TokenStore(app)
    expect(store.load()).toBeNull()
  })

  it('save() overwrites previous values', () => {
    const store = createTokenStore()
    store.save(sampleTokens)

    const updated: StoredTokens = {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: '2026-12-31T23:59:59.000Z',
      email: 'bob@company.com',
      name: 'Bob Smith',
    }
    store.save(updated)

    expect(store.load()).toEqual(updated)
  })

  it('property: stored tokens round-trip correctly for any valid string values', () => {
    const nonEmpty = fc.string({ minLength: 1 })
    fc.assert(
      fc.property(
        nonEmpty, nonEmpty, nonEmpty, nonEmpty, nonEmpty,
        (accessToken, refreshToken, expiresAt, email, name) => {
          const store = createTokenStore()
          const tokens: StoredTokens = { accessToken, refreshToken, expiresAt, email, name }
          store.save(tokens)
          expect(store.load()).toEqual(tokens)
        },
      ),
    )
  })
})
