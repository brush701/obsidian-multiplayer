// Suite: Test Infrastructure
// Scope: Unit
// Spec: docs/issues/64 — [Testing-S1] Test infrastructure and conventions
// Author: brush701
// What this suite validates:
//   - Factory functions produce valid objects with correct defaults
//   - Factory overrides are applied correctly
//   - Mock helpers for AuthManager and ApiClient are correctly typed and usable
//   - fast-check property-based testing is functional
// What is explicitly NOT tested here:
//   - Obsidian plugin lifecycle or host API integration
//   - Network or IndexedDB behaviour
// Critical cases (require human review before deletion):
//   - Property: makeSharedTypeSettings guid is always a non-empty string
//   - Property: makeStoredTokens expiresAt is always a number

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'

import {
  makeSharedTypeSettings,
  makeMultiplayerSettings,
  makeStoredTokens,
  makeRoomMember,
  makeRoomSummary,
  makeRoomDetail,
} from './factories'
import { makeAuthManagerMock, makeApiClientMock } from './mocks'

// ── Factory: SharedTypeSettings ───────────────────────────────────────────────

describe('makeSharedTypeSettings', () => {
  it('returns valid defaults', () => {
    const s = makeSharedTypeSettings()
    expect(typeof s.guid).toBe('string')
    expect(s.guid.length).toBeGreaterThan(0)
    expect(typeof s.path).toBe('string')
    expect(typeof s.name).toBe('string')
  })

  it('applies overrides', () => {
    const s = makeSharedTypeSettings({ path: 'my-notes' })
    expect(s.path).toBe('my-notes')
    // non-overridden fields keep defaults
    expect(s.guid).toBe('aaaaaaaa-0000-0000-0000-000000000001')
  })
})

// ── Factory: MultiplayerSettings ─────────────────────────────────────────────

describe('makeMultiplayerSettings', () => {
  it('returns valid defaults', () => {
    const s = makeMultiplayerSettings()
    expect(s.username).toBe('Anonymous')
    expect(Array.isArray(s.sharedFolders)).toBe(true)
    expect(s.sharedFolders).toHaveLength(0)
  })

  it('applies overrides', () => {
    const folder = makeSharedTypeSettings({ path: 'collab' })
    const s = makeMultiplayerSettings({ username: 'bob', sharedFolders: [folder] })
    expect(s.username).toBe('bob')
    expect(s.sharedFolders).toHaveLength(1)
  })
})

// ── Factory: StoredTokens ─────────────────────────────────────────────────────

describe('makeStoredTokens', () => {
  it('returns valid defaults', () => {
    const t = makeStoredTokens()
    expect(typeof t.accessToken).toBe('string')
    expect(typeof t.refreshToken).toBe('string')
    expect(t.expiresAt).toBeGreaterThan(Date.now())
  })

  it('applies overrides', () => {
    const t = makeStoredTokens({ accessToken: 'custom-tok' })
    expect(t.accessToken).toBe('custom-tok')
  })
})

// ── Factory: RoomMember ───────────────────────────────────────────────────────

describe('makeRoomMember', () => {
  it('returns valid defaults', () => {
    const m = makeRoomMember()
    expect(typeof m.userId).toBe('string')
    expect(['owner', 'editor', 'viewer']).toContain(m.role)
  })

  it('applies overrides', () => {
    const m = makeRoomMember({ role: 'owner', username: 'carol' })
    expect(m.role).toBe('owner')
    expect(m.username).toBe('carol')
  })
})

// ── Factory: RoomSummary ──────────────────────────────────────────────────────

describe('makeRoomSummary', () => {
  it('returns valid defaults', () => {
    const r = makeRoomSummary()
    expect(typeof r.id).toBe('string')
    expect(typeof r.name).toBe('string')
    expect(r.memberCount).toBeGreaterThanOrEqual(0)
  })
})

// ── Factory: RoomDetail ───────────────────────────────────────────────────────

describe('makeRoomDetail', () => {
  it('returns valid defaults with embedded members', () => {
    const r = makeRoomDetail()
    expect(Array.isArray(r.members)).toBe(true)
    expect(r.members.length).toBeGreaterThan(0)
    expect(typeof r.encryptionEnabled).toBe('boolean')
  })

  it('applies deep overrides', () => {
    const r = makeRoomDetail({ name: 'deep-override', memberCount: 3 })
    expect(r.name).toBe('deep-override')
    expect(r.memberCount).toBe(3)
  })
})

// ── Mock: AuthManager ─────────────────────────────────────────────────────────

describe('makeAuthManagerMock', () => {
  it('provides callable stubs with default return values', async () => {
    const auth = makeAuthManagerMock()
    expect(auth.isAuthenticated()).toBe(false)
    const token = await auth.getAccessToken()
    expect(typeof token).toBe('string')
  })

  it('allows per-test stub overrides', async () => {
    const auth = makeAuthManagerMock({
      isAuthenticated: vi.fn().mockReturnValue(true),
    })
    expect(auth.isAuthenticated()).toBe(true)
  })

  it('records calls', async () => {
    const auth = makeAuthManagerMock()
    await auth.login('alice', 'pw')
    expect(auth.login).toHaveBeenCalledWith('alice', 'pw')
    expect(auth.login).toHaveBeenCalledTimes(1)
  })
})

// ── Mock: ApiClient ───────────────────────────────────────────────────────────

describe('makeApiClientMock', () => {
  it('provides callable stubs that resolve with factory defaults', async () => {
    const api = makeApiClientMock()
    const rooms = await api.listRooms()
    expect(Array.isArray(rooms)).toBe(true)
    expect(rooms[0].id).toBe('room-001')
  })

  it('allows override of a single method', async () => {
    const api = makeApiClientMock({
      listRooms: vi.fn().mockResolvedValue([]),
    })
    const rooms = await api.listRooms()
    expect(rooms).toHaveLength(0)
  })
})

// ── Property-based tests (fast-check) ────────────────────────────────────────

describe('property-based: factories produce structurally valid objects', () => {
  it('makeSharedTypeSettings guid is always a non-empty string regardless of overrides', () => {
    fc.assert(
      fc.property(
        fc.record({
          path: fc.string({ minLength: 1 }),
        }),
        (overrides) => {
          const s = makeSharedTypeSettings(overrides)
          return typeof s.guid === 'string' && s.guid.length > 0
        }
      )
    )
  })

  it('makeStoredTokens expiresAt is always a finite number', () => {
    fc.assert(
      fc.property(
        fc.record({
          accessToken: fc.string({ minLength: 1 }),
          refreshToken: fc.string({ minLength: 1 }),
        }),
        (overrides) => {
          const t = makeStoredTokens(overrides)
          return Number.isFinite(t.expiresAt)
        }
      )
    )
  })

  it('makeRoomMember role is always one of the valid role values', () => {
    const validRoles = ['owner', 'editor', 'viewer'] as const
    fc.assert(
      fc.property(
        fc.record({ username: fc.string({ minLength: 1 }) }),
        (overrides) => {
          const m = makeRoomMember(overrides)
          return validRoles.includes(m.role)
        }
      )
    )
  })
})
