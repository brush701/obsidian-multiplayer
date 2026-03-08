// Suite: TokenStore
// Scope: Unit
// Spec: TASK-10 — [P2-S3] Token storage (SecretStorage)
// What this suite validates:
//   - save() persists tokens, load() retrieves them
//   - clear() removes all tokens so load() returns null
//   - load() returns null when keys are missing or only partially present
//   - save() overwrites previously stored values

import { describe, it, expect } from 'vitest'
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
  it('load() returns null on fresh adapter', async () => {
    const store = createTokenStore()
    expect(await store.load()).toBeNull()
  })

  it('save() then load() returns matching StoredTokens', async () => {
    const store = createTokenStore()
    await store.save(sampleTokens)
    const loaded = await store.load()
    expect(loaded).toEqual(sampleTokens)
  })

  it('clear() then load() returns null', async () => {
    const store = createTokenStore()
    await store.save(sampleTokens)
    await store.clear()
    expect(await store.load()).toBeNull()
  })

  it('save() then clear() then load() returns null', async () => {
    const store = createTokenStore()
    await store.save(sampleTokens)
    await store.clear()
    const loaded = await store.load()
    expect(loaded).toBeNull()
  })

  it('load() returns null if only a subset of keys exist', async () => {
    const app = new App()
    // Write only 2 of 5 keys directly
    await app.vault.adapter.store('mp-access-token', 'partial')
    await app.vault.adapter.store('mp-user-email', 'partial@test.com')

    const store = new TokenStore(app)
    expect(await store.load()).toBeNull()
  })

  it('save() overwrites previous values', async () => {
    const store = createTokenStore()
    await store.save(sampleTokens)

    const updated: StoredTokens = {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: '2026-12-31T23:59:59.000Z',
      email: 'bob@company.com',
      name: 'Bob Smith',
    }
    await store.save(updated)

    const loaded = await store.load()
    expect(loaded).toEqual(updated)
  })
})
