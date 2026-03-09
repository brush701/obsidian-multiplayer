// Suite: TektiteApiClient
// Scope: Unit
// Spec: TASK-16 — [P3-S1] API client
// What this suite validates:
//   - Auth guard: null token → AuthRequiredError, no requestUrl call
//   - getVersion() works without authentication
//   - Success paths: correct URL, method, headers, parsed response
//   - Error paths: non-2xx → ApiRequestError with ApiError fields
//   - 204 responses: void methods resolve without parsing JSON

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TektiteApiClient, AuthRequiredError, ApiRequestError } from '../src/api'
import type { RequestUrlFn } from '../src/api'
import type { IAuthManager } from '../src/types'
import {
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
    isAuthenticated: token !== null,
    hasAuthError: false,
    userInfo: null,
    on: vi.fn(),
    off: vi.fn(),
  }
}

function mockRequestUrl(body: unknown, status = 200): RequestUrlFn {
  return vi.fn().mockResolvedValue({
    status,
    headers: {},
    text: JSON.stringify(body),
    json: body,
    arrayBuffer: new ArrayBuffer(0),
  })
}

function mockRequestUrl204(): RequestUrlFn {
  return vi.fn().mockResolvedValue({
    status: 204,
    headers: {},
    text: '',
    json: null,
    arrayBuffer: new ArrayBuffer(0),
  })
}

function mockRequestUrlError(
  status: number,
  error = 'FORBIDDEN',
  message = 'Not allowed',
): RequestUrlFn {
  const body = { error, message, statusCode: status }
  return vi.fn().mockResolvedValue({
    status,
    headers: {},
    text: JSON.stringify(body),
    json: body,
    arrayBuffer: new ArrayBuffer(0),
  })
}

// ── Auth guard ──────────────────────────────────────────────────────────────

describe('auth guard', () => {
  // All authenticated methods (excludes getVersion which is unauthenticated)
  const methodNames = [
    'listRooms',
    'createRoom',
    'getRoom',
    'deleteRoom',
    'getMyRole',
    'joinRoom',
    'createInvite',
    'revokeInvite',
    'updateMemberRole',
    'removeMember',
  ] as const

  function callMethod(client: TektiteApiClient, name: string): Promise<unknown> {
    switch (name) {
      case 'listRooms': return client.listRooms()
      case 'createRoom': return client.createRoom('test')
      case 'getRoom': return client.getRoom('guid')
      case 'deleteRoom': return client.deleteRoom('guid')
      case 'getMyRole': return client.getMyRole('guid')
      case 'joinRoom': return client.joinRoom('token')
      case 'createInvite': return client.createInvite('guid', 'EDITOR', '7d')
      case 'revokeInvite': return client.revokeInvite('guid', 'token')
      case 'updateMemberRole': return client.updateMemberRole('guid', 'user', 'EDITOR')
      case 'removeMember': return client.removeMember('guid', 'user')
      default: throw new Error(`unknown method: ${name}`)
    }
  }

  it.each(methodNames)('%s throws AuthRequiredError when token is null', async (name) => {
    const reqFn = vi.fn() as unknown as RequestUrlFn
    const client = new TektiteApiClient(SERVER, makeAuth(null), reqFn)
    await expect(callMethod(client, name)).rejects.toThrow(AuthRequiredError)
    expect(reqFn).not.toHaveBeenCalled()
  })
})

// ── getVersion (unauthenticated) ────────────────────────────────────────────

describe('getVersion', () => {
  it('does not require auth — works when token is null', async () => {
    const body = { server: '1.0.0', apiVersion: '1', minPluginVersion: '1.0.0' }
    const reqFn = mockRequestUrl(body)
    const client = new TektiteApiClient(SERVER, makeAuth(null), reqFn)
    const result = await client.getVersion()
    expect(result).toEqual(body)
    expect(reqFn).toHaveBeenCalledWith(expect.objectContaining({
      url: `${SERVER}/api/version`,
      method: 'GET',
    }))
    // No Authorization header
    const callHeaders = (reqFn as ReturnType<typeof vi.fn>).mock.calls[0][0].headers
    expect(callHeaders).not.toHaveProperty('Authorization')
  })

  it('does not send Authorization header even when authenticated', async () => {
    const body = { server: '1.0.0', apiVersion: '1', minPluginVersion: '1.0.0' }
    const reqFn = mockRequestUrl(body)
    const client = new TektiteApiClient(SERVER, makeAuth('some-token'), reqFn)
    await client.getVersion()
    const callHeaders = (reqFn as ReturnType<typeof vi.fn>).mock.calls[0][0].headers
    expect(callHeaders).not.toHaveProperty('Authorization')
  })
})

// ── Success paths ───────────────────────────────────────────────────────────

describe('success paths', () => {
  it('listRooms sends GET /api/rooms with auth header', async () => {
    const body = [makeRoomListItem()]
    const reqFn = mockRequestUrl(body)
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    expect(await client.listRooms()).toEqual(body)
    expect(reqFn).toHaveBeenCalledWith(expect.objectContaining({
      url: `${SERVER}/api/rooms`,
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }))
  })

  it('createRoom sends POST with name body', async () => {
    const body = makeCreateRoomResult()
    const reqFn = mockRequestUrl(body, 201)
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    const result = await client.createRoom('Q4 Planning')
    expect(result).toEqual(body)
    expect(reqFn).toHaveBeenCalledWith(expect.objectContaining({
      url: `${SERVER}/api/rooms`,
      method: 'POST',
      body: JSON.stringify({ name: 'Q4 Planning' }),
      contentType: 'application/json',
    }))
  })

  it('getRoom sends GET /api/rooms/:guid', async () => {
    const body = makeRoomDetail()
    const reqFn = mockRequestUrl(body)
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    expect(await client.getRoom('room-guid')).toEqual(body)
    expect(reqFn).toHaveBeenCalledWith(expect.objectContaining({
      url: `${SERVER}/api/rooms/room-guid`,
      method: 'GET',
    }))
  })

  it('deleteRoom sends DELETE and resolves void', async () => {
    const reqFn = mockRequestUrl204()
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    await expect(client.deleteRoom('room-guid')).resolves.toBeUndefined()
    expect(reqFn).toHaveBeenCalledWith(expect.objectContaining({
      url: `${SERVER}/api/rooms/room-guid`,
      method: 'DELETE',
    }))
  })

  it('getMyRole sends GET /api/rooms/:guid/me', async () => {
    const body = { role: 'EDITOR' }
    const reqFn = mockRequestUrl(body)
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    expect(await client.getMyRole('room-guid')).toEqual(body)
  })

  it('joinRoom sends POST /api/rooms/join with token body', async () => {
    const body = makeJoinResult()
    const reqFn = mockRequestUrl(body)
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    expect(await client.joinRoom('invite-token')).toEqual(body)
    expect(reqFn).toHaveBeenCalledWith(expect.objectContaining({
      url: `${SERVER}/api/rooms/join`,
      method: 'POST',
      body: JSON.stringify({ token: 'invite-token' }),
    }))
  })

  it('createInvite sends POST with role and expiresIn', async () => {
    const body = { inviteUrl: 'https://example.com/join?token=abc' }
    const reqFn = mockRequestUrl(body, 201)
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    expect(await client.createInvite('room-guid', 'EDITOR', '7d')).toEqual(body)
    expect(reqFn).toHaveBeenCalledWith(expect.objectContaining({
      url: `${SERVER}/api/rooms/room-guid/invites`,
      method: 'POST',
      body: JSON.stringify({ role: 'EDITOR', expiresIn: '7d' }),
    }))
  })

  it('revokeInvite sends DELETE and resolves void', async () => {
    const reqFn = mockRequestUrl204()
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    await expect(client.revokeInvite('room-guid', 'invite-token')).resolves.toBeUndefined()
    expect(reqFn).toHaveBeenCalledWith(expect.objectContaining({
      url: `${SERVER}/api/rooms/room-guid/invites/invite-token`,
      method: 'DELETE',
    }))
  })

  it('updateMemberRole sends PUT with role body', async () => {
    const body = { userId: 'user-1', role: 'VIEWER' }
    const reqFn = mockRequestUrl(body)
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    expect(await client.updateMemberRole('room-guid', 'user-1', 'VIEWER')).toEqual(body)
    expect(reqFn).toHaveBeenCalledWith(expect.objectContaining({
      url: `${SERVER}/api/rooms/room-guid/members/user-1`,
      method: 'PUT',
      body: JSON.stringify({ role: 'VIEWER' }),
    }))
  })

  it('removeMember sends DELETE and resolves void', async () => {
    const reqFn = mockRequestUrl204()
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    await expect(client.removeMember('room-guid', 'user-1')).resolves.toBeUndefined()
    expect(reqFn).toHaveBeenCalledWith(expect.objectContaining({
      url: `${SERVER}/api/rooms/room-guid/members/user-1`,
      method: 'DELETE',
    }))
  })
})

// ── Error paths ─────────────────────────────────────────────────────────────

describe('error paths', () => {
  it('non-2xx throws ApiRequestError with ApiError fields', async () => {
    const reqFn = mockRequestUrlError(403, 'FORBIDDEN', 'You do not have access')
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    try {
      await client.getRoom('room-guid')
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiRequestError)
      const err = e as ApiRequestError
      expect(err.statusCode).toBe(403)
      expect(err.errorCode).toBe('FORBIDDEN')
      expect(err.message).toBe('You do not have access')
      expect(err.apiError).toEqual({
        error: 'FORBIDDEN',
        message: 'You do not have access',
        statusCode: 403,
      })
    }
  })

  it('non-JSON error body still throws with status', async () => {
    const reqFn = vi.fn().mockResolvedValue({
      status: 500,
      headers: {},
      text: 'Internal Server Error',
      json: null,
      arrayBuffer: new ArrayBuffer(0),
    }) as unknown as RequestUrlFn
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    try {
      await client.listRooms()
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiRequestError)
      const err = e as ApiRequestError
      expect(err.statusCode).toBe(500)
      expect(err.errorCode).toBe('UNKNOWN')
    }
  })

  it('preserves validation details from server', async () => {
    const details = [{ field: 'name', message: 'Must be between 1 and 500 characters' }]
    const body = { error: 'VALIDATION_ERROR', message: 'Request validation failed', statusCode: 400, details }
    const reqFn = vi.fn().mockResolvedValue({
      status: 400,
      headers: {},
      text: JSON.stringify(body),
      json: body,
      arrayBuffer: new ArrayBuffer(0),
    }) as unknown as RequestUrlFn
    const client = new TektiteApiClient(SERVER, makeAuth(), reqFn)
    try {
      await client.createRoom('')
      expect.unreachable('should have thrown')
    } catch (e) {
      const err = e as ApiRequestError
      expect(err.apiError.details).toEqual(details)
    }
  })
})
