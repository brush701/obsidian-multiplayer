// Suite: TektiteApiClient — Integration
// Scope: Integration
// Spec: TASK-36 — [Testing-S7] Integration test layer (WebSocket provider + API)
// What this suite validates:
//   - API client correctly serialises requests and deserialises server responses
//     when exercised against VCR cassettes (nock interceptors replaying recorded
//     server responses matching the API.md contract).
//   - Expired access token triggers a refresh before the API call proceeds.
//
// What is explicitly NOT tested here:
//   - Network-level failures (timeout, DNS, TLS) — those belong in unit tests
//   - WebSocket integration — see ws-close-codes.integration.test.ts
//
// VCR cassettes are in test/integration/cassettes/ and tagged with apiVersion.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import { TektiteApiClient, AuthRequiredError } from '../../src/api'
import type { IAuthManager, RoomListItem, RoomDetail, CreateRoomResult, JoinResult, InviteResponse, MemberRoleResult, VersionInfo, MyRoleResult } from '../../src/types'
import { playCassette, loadCassette, fetchRequestUrl } from './cassette-helpers'

const SERVER = 'https://tektite.test'

function makeAuth(token: string | null = 'test-access-token'): IAuthManager {
  return {
    getAccessToken: vi.fn().mockResolvedValue(token),
    signIn: vi.fn(),
    signOut: vi.fn(),
    signOutWithAuthError: vi.fn(),
    restoreSession: vi.fn(),
    isAuthenticated: token !== null,
    hasAuthError: false,
    userInfo: null,
    on: vi.fn(),
    off: vi.fn(),
  }
}

beforeEach(() => {
  nock.disableNetConnect()
})

afterEach(() => {
  nock.cleanAll()
  nock.enableNetConnect()
})

// ── Cassette metadata ────────────────────────────────────────────────────────

describe('cassette discipline', () => {
  const cassetteNames = [
    'getVersion',
    'listRooms',
    'createRoom',
    'getRoom',
    'getMyRole',
    'joinRoom',
    'createInvite',
    'revokeInvite',
    'updateMemberRole',
    'removeMember',
    'deleteRoom',
  ]

  it.each(cassetteNames)('%s cassette is tagged with apiVersion', (name) => {
    const cassette = loadCassette(name)
    expect(cassette._cassette.apiVersion).toBe('1')
    expect(cassette._cassette.serverVersion).toBeTruthy()
    expect(cassette._cassette.recordedAt).toBeTruthy()
  })
})

// ── getVersion (unauthenticated) ─────────────────────────────────────────────

describe('getVersion', () => {
  it('deserialises VersionInfo from server response', async () => {
    const scope = playCassette(SERVER, 'getVersion', { requireAuth: false })
    const client = new TektiteApiClient(SERVER, makeAuth(null), fetchRequestUrl)

    const result: VersionInfo = await client.getVersion()

    expect(result).toEqual({
      server: '1.2.0',
      apiVersion: '1',
      minPluginVersion: '1.0.0',
    })
    expect(scope.isDone()).toBe(true)
  })
})

// ── listRooms ────────────────────────────────────────────────────────────────

describe('listRooms', () => {
  it('deserialises RoomSummary[] from server response', async () => {
    const scope = playCassette(SERVER, 'listRooms')
    const client = new TektiteApiClient(SERVER, makeAuth(), fetchRequestUrl)

    const result: RoomListItem[] = await client.listRooms()

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(
      expect.objectContaining({
        guid: expect.any(String),
        name: 'Q4 Planning',
        role: 'OWNER',
        orgId: expect.any(String),
      }),
    )
    expect(result[1]).toEqual(
      expect.objectContaining({
        name: 'Engineering Hub',
        role: 'EDITOR',
      }),
    )
    expect(scope.isDone()).toBe(true)
  })
})

// ── createRoom ───────────────────────────────────────────────────────────────

describe('createRoom', () => {
  it('sends correct request body and deserialises CreateRoomResult', async () => {
    const scope = playCassette(SERVER, 'createRoom')
    const client = new TektiteApiClient(SERVER, makeAuth(), fetchRequestUrl)

    const result: CreateRoomResult = await client.createRoom('Q4 Planning')

    expect(result).toEqual({
      guid: '770e8400-e29b-41d4-a716-446655440000',
      name: 'Q4 Planning',
      orgId: '880e8400-e29b-41d4-a716-446655440000',
    })
    expect(scope.isDone()).toBe(true)
  })
})

// ── getRoom ──────────────────────────────────────────────────────────────────

describe('getRoom', () => {
  it('deserialises RoomDetail with members array', async () => {
    const scope = playCassette(SERVER, 'getRoom')
    const client = new TektiteApiClient(SERVER, makeAuth(), fetchRequestUrl)

    const result: RoomDetail = await client.getRoom(
      '770e8400-e29b-41d4-a716-446655440000',
    )

    expect(result.guid).toBe('770e8400-e29b-41d4-a716-446655440000')
    expect(result.name).toBe('Q4 Planning')
    expect(result.openToOrg).toBe(false)
    expect(result.members).toHaveLength(2)
    expect(result.members[0]).toEqual(
      expect.objectContaining({
        userId: expect.any(String),
        email: 'alice@company.com',
        name: 'Alice Chen',
        role: 'OWNER',
      }),
    )
    expect(scope.isDone()).toBe(true)
  })
})

// ── getMyRole ────────────────────────────────────────────────────────────────

describe('getMyRole', () => {
  it('deserialises MyRoleResult', async () => {
    const scope = playCassette(SERVER, 'getMyRole')
    const client = new TektiteApiClient(SERVER, makeAuth(), fetchRequestUrl)

    const result: MyRoleResult = await client.getMyRole(
      '770e8400-e29b-41d4-a716-446655440000',
    )

    expect(result).toEqual({ role: 'EDITOR' })
    expect(scope.isDone()).toBe(true)
  })
})

// ── joinRoom ─────────────────────────────────────────────────────────────────

describe('joinRoom', () => {
  it('sends invite token and deserialises JoinResult', async () => {
    const scope = playCassette(SERVER, 'joinRoom')
    const client = new TektiteApiClient(SERVER, makeAuth(), fetchRequestUrl)

    const result: JoinResult = await client.joinRoom(
      'aab38e00-1234-5678-9abc-def012345678',
    )

    expect(result).toEqual({
      guid: '770e8400-e29b-41d4-a716-446655440000',
      name: 'Q4 Planning',
    })
    expect(scope.isDone()).toBe(true)
  })
})

// ── createInvite ─────────────────────────────────────────────────────────────

describe('createInvite', () => {
  it('sends role/expiry and returns invite URL string', async () => {
    const scope = playCassette(SERVER, 'createInvite')
    const client = new TektiteApiClient(SERVER, makeAuth(), fetchRequestUrl)

    const result: InviteResponse = await client.createInvite(
      '770e8400-e29b-41d4-a716-446655440000',
      'EDITOR',
      '7d',
    )

    expect(result.inviteUrl).toBe(
      'https://multiplayer.company.com/join?token=aab38e00-1234-5678-9abc-def012345678',
    )
    expect(scope.isDone()).toBe(true)
  })
})

// ── revokeInvite ─────────────────────────────────────────────────────────────

describe('revokeInvite', () => {
  it('sends DELETE and resolves void (204)', async () => {
    const scope = playCassette(SERVER, 'revokeInvite')
    const client = new TektiteApiClient(SERVER, makeAuth(), fetchRequestUrl)

    await expect(
      client.revokeInvite(
        '770e8400-e29b-41d4-a716-446655440000',
        'aab38e00-1234-5678-9abc-def012345678',
      ),
    ).resolves.toBeUndefined()
    expect(scope.isDone()).toBe(true)
  })
})

// ── updateMemberRole ─────────────────────────────────────────────────────────

describe('updateMemberRole', () => {
  it('sends PUT with role body and deserialises MemberRoleResult', async () => {
    const scope = playCassette(SERVER, 'updateMemberRole')
    const client = new TektiteApiClient(SERVER, makeAuth(), fetchRequestUrl)

    const result: MemberRoleResult = await client.updateMemberRole(
      '770e8400-e29b-41d4-a716-446655440000',
      '660e8400-e29b-41d4-a716-446655440000',
      'VIEWER',
    )

    expect(result).toEqual({
      userId: '660e8400-e29b-41d4-a716-446655440000',
      role: 'VIEWER',
    })
    expect(scope.isDone()).toBe(true)
  })
})

// ── removeMember ─────────────────────────────────────────────────────────────

describe('removeMember', () => {
  it('sends DELETE and resolves void (204)', async () => {
    const scope = playCassette(SERVER, 'removeMember')
    const client = new TektiteApiClient(SERVER, makeAuth(), fetchRequestUrl)

    await expect(
      client.removeMember(
        '770e8400-e29b-41d4-a716-446655440000',
        '660e8400-e29b-41d4-a716-446655440000',
      ),
    ).resolves.toBeUndefined()
    expect(scope.isDone()).toBe(true)
  })
})

// ── deleteRoom ───────────────────────────────────────────────────────────────

describe('deleteRoom', () => {
  it('sends DELETE and resolves void (204)', async () => {
    const scope = playCassette(SERVER, 'deleteRoom')
    const client = new TektiteApiClient(SERVER, makeAuth(), fetchRequestUrl)

    await expect(
      client.deleteRoom('770e8400-e29b-41d4-a716-446655440000'),
    ).resolves.toBeUndefined()
    expect(scope.isDone()).toBe(true)
  })
})

// ── Token refresh on expiry ──────────────────────────────────────────────────

describe('token refresh', () => {
  it('getAccessToken() is called per-request so AuthManager can refresh transparently', async () => {
    // The ApiClient delegates token management entirely to AuthManager.
    // Each request calls getAccessToken(), which may internally refresh an
    // expired token before returning. We verify the returned token reaches
    // the server via the Authorization header.
    const auth = makeAuth()
    ;(auth.getAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue('fresh-token')

    const scope = nock(SERVER)
      .get('/api/rooms')
      .matchHeader('Authorization', 'Bearer fresh-token')
      .reply(200, [])

    const client = new TektiteApiClient(SERVER, auth, fetchRequestUrl)
    const result = await client.listRooms()

    expect(result).toEqual([])
    expect(auth.getAccessToken).toHaveBeenCalledTimes(1)
    expect(scope.isDone()).toBe(true)
  })

  it('each API call fetches a fresh token — tokens are not cached by the client', async () => {
    // If the AuthManager returns a new token on the second call (e.g. after
    // a silent refresh), the client must send the updated token.
    const auth = makeAuth()
    let callCount = 0
    ;(auth.getAccessToken as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        callCount++
        return `token-${callCount}`
      },
    )

    const scope = nock(SERVER)
      .get('/api/rooms')
      .matchHeader('Authorization', 'Bearer token-1')
      .reply(200, [])
      .get('/api/rooms')
      .matchHeader('Authorization', 'Bearer token-2')
      .reply(200, [])

    const client = new TektiteApiClient(SERVER, auth, fetchRequestUrl)
    await client.listRooms()
    await client.listRooms()

    expect(auth.getAccessToken).toHaveBeenCalledTimes(2)
    expect(scope.isDone()).toBe(true)
  })

  it('null token from getAccessToken() throws AuthRequiredError — no network call made', async () => {
    const auth = makeAuth(null)

    // No nock scope — if a network call is made, nock will error
    const client = new TektiteApiClient(SERVER, auth, fetchRequestUrl)

    await expect(client.listRooms()).rejects.toThrow('Authentication required')
    expect(auth.getAccessToken).toHaveBeenCalledTimes(1)
  })
})
