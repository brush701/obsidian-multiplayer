// Suite: TektiteApiClient
// Scope: Unit
// Spec: TASK-16 — [P3-S1] API client
// What this suite validates:
//   - Auth guard: null token → AuthRequiredError, no fetch call
//   - Success paths: correct URL, method, headers, parsed response
//   - Error paths: non-2xx → ApiRequestError with status and message
//   - 204 responses: void methods resolve without parsing JSON

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TektiteApiClient, AuthRequiredError, ApiRequestError } from '../src/api'
import type { IAuthManager } from '../src/types'
import {
  makeMultiplayerSettings,
  makeRoomListItem,
  makeRoomDetail,
  makeCreateRoomResult,
  makeJoinResult,
} from './factories'

const SERVER = 'https://example.com'

function makeAuth(token: string | null = 'test-token'): IAuthManager {
  return {
    getAccessToken: vi.fn().mockResolvedValue(token),
    signIn: vi.fn(),
    signOut: vi.fn(),
    signOutWithAuthError: vi.fn(),
    restoreSession: vi.fn(),
    handleAuthCallback: vi.fn(),
    isAuthenticated: token !== null,
    hasAuthError: false,
    userInfo: null,
    on: vi.fn(),
    off: vi.fn(),
  }
}

function makeClient(token: string | null = 'test-token') {
  const auth = makeAuth(token)
  const settings = makeMultiplayerSettings({ serverUrl: SERVER })
  const client = new TektiteApiClient(settings, auth)
  return { client, auth }
}

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

function mockFetch204() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 204,
    json: () => { throw new Error('should not parse 204') },
  })
}

function mockFetchError(status: number, error = 'FORBIDDEN', message = 'Not allowed') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ error, message, statusCode: status }),
  })
}

let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ── Auth guard ──────────────────────────────────────────────────────────────

describe('auth guard', () => {
  const methods: [string, () => Promise<unknown>][] = (() => {
    const { client } = makeClient(null)
    return [
      ['getVersion', () => client.getVersion()],
      ['listRooms', () => client.listRooms()],
      ['createRoom', () => client.createRoom('test')],
      ['getRoom', () => client.getRoom('guid')],
      ['deleteRoom', () => client.deleteRoom('guid')],
      ['getMyRole', () => client.getMyRole('guid')],
      ['joinRoom', () => client.joinRoom('token')],
      ['createInvite', () => client.createInvite('guid', 'EDITOR', '7d')],
      ['revokeInvite', () => client.revokeInvite('guid', 'token')],
      ['updateMemberRole', () => client.updateMemberRole('guid', 'user', 'EDITOR')],
      ['removeMember', () => client.removeMember('guid', 'user')],
    ]
  })()

  it.each(methods)('%s throws AuthRequiredError when token is null', async (_, call) => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    await expect(call()).rejects.toThrow(AuthRequiredError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// ── Success paths ───────────────────────────────────────────────────────────

describe('success paths', () => {
  it('getVersion sends GET /api/version with auth header', async () => {
    const body = { server: '1.0.0', apiVersion: '1', minPluginVersion: '1.0.0' }
    globalThis.fetch = mockFetch(body) as unknown as typeof fetch
    const { client } = makeClient()
    const result = await client.getVersion()
    expect(result).toEqual(body)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SERVER}/api/version`,
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }),
    )
  })

  it('listRooms returns RoomListItem[]', async () => {
    const body = [makeRoomListItem()]
    globalThis.fetch = mockFetch(body) as unknown as typeof fetch
    const { client } = makeClient()
    expect(await client.listRooms()).toEqual(body)
  })

  it('createRoom sends POST with name body', async () => {
    const body = makeCreateRoomResult()
    globalThis.fetch = mockFetch(body, 201) as unknown as typeof fetch
    const { client } = makeClient()
    const result = await client.createRoom('Q4 Planning')
    expect(result).toEqual(body)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SERVER}/api/rooms`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Q4 Planning' }),
      }),
    )
  })

  it('getRoom sends GET /api/rooms/:guid', async () => {
    const body = makeRoomDetail()
    globalThis.fetch = mockFetch(body) as unknown as typeof fetch
    const { client } = makeClient()
    const result = await client.getRoom('room-guid')
    expect(result).toEqual(body)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SERVER}/api/rooms/room-guid`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('deleteRoom sends DELETE and resolves void', async () => {
    globalThis.fetch = mockFetch204() as unknown as typeof fetch
    const { client } = makeClient()
    await expect(client.deleteRoom('room-guid')).resolves.toBeUndefined()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SERVER}/api/rooms/room-guid`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('getMyRole sends GET /api/rooms/:guid/me', async () => {
    const body = { role: 'EDITOR' }
    globalThis.fetch = mockFetch(body) as unknown as typeof fetch
    const { client } = makeClient()
    expect(await client.getMyRole('room-guid')).toEqual(body)
  })

  it('joinRoom sends POST /api/rooms/join with token body', async () => {
    const body = makeJoinResult()
    globalThis.fetch = mockFetch(body) as unknown as typeof fetch
    const { client } = makeClient()
    const result = await client.joinRoom('invite-token')
    expect(result).toEqual(body)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SERVER}/api/rooms/join`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'invite-token' }),
      }),
    )
  })

  it('createInvite sends POST with role and expiresIn', async () => {
    const body = { inviteUrl: 'https://example.com/join?token=abc' }
    globalThis.fetch = mockFetch(body, 201) as unknown as typeof fetch
    const { client } = makeClient()
    const result = await client.createInvite('room-guid', 'EDITOR', '7d')
    expect(result).toEqual(body)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SERVER}/api/rooms/room-guid/invites`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ role: 'EDITOR', expiresIn: '7d' }),
      }),
    )
  })

  it('revokeInvite sends DELETE and resolves void', async () => {
    globalThis.fetch = mockFetch204() as unknown as typeof fetch
    const { client } = makeClient()
    await expect(client.revokeInvite('room-guid', 'invite-token')).resolves.toBeUndefined()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SERVER}/api/rooms/room-guid/invites/invite-token`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('updateMemberRole sends PUT with role body', async () => {
    const body = { userId: 'user-1', role: 'VIEWER' }
    globalThis.fetch = mockFetch(body) as unknown as typeof fetch
    const { client } = makeClient()
    const result = await client.updateMemberRole('room-guid', 'user-1', 'VIEWER')
    expect(result).toEqual(body)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SERVER}/api/rooms/room-guid/members/user-1`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ role: 'VIEWER' }),
      }),
    )
  })

  it('removeMember sends DELETE and resolves void', async () => {
    globalThis.fetch = mockFetch204() as unknown as typeof fetch
    const { client } = makeClient()
    await expect(client.removeMember('room-guid', 'user-1')).resolves.toBeUndefined()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SERVER}/api/rooms/room-guid/members/user-1`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

// ── Error paths ─────────────────────────────────────────────────────────────

describe('error paths', () => {
  it('non-2xx throws ApiRequestError with status and message', async () => {
    globalThis.fetch = mockFetchError(403, 'FORBIDDEN', 'You do not have access') as unknown as typeof fetch
    const { client } = makeClient()
    try {
      await client.getRoom('room-guid')
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiRequestError)
      expect((e as ApiRequestError).statusCode).toBe(403)
      expect((e as ApiRequestError).errorCode).toBe('FORBIDDEN')
      expect((e as ApiRequestError).message).toBe('You do not have access')
    }
  })

  it('non-JSON error body still throws with status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not JSON')),
    }) as unknown as typeof fetch
    const { client } = makeClient()
    try {
      await client.listRooms()
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiRequestError)
      expect((e as ApiRequestError).statusCode).toBe(500)
    }
  })
})
