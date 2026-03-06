// Typed mock helpers for system-boundary interfaces.
//
// Convention: mock ONLY at system boundaries (AuthManager, ApiClient).
// Internal collaborators (e.g. SharedFolder, SharedDoc) must NOT be mocked —
// test those through their public interfaces directly.
//
// Usage:
//   const auth = makeAuthManagerMock()
//   auth.isAuthenticated.mockReturnValue(true)
//   auth.getAccessToken.mockResolvedValue('tok')

import { vi } from 'vitest'
import type {
  AuthManager,
  ApiClient,
  StoredTokens,
  RoomSummary,
  RoomDetail,
  RoomMember,
} from '../src/types'
import { makeStoredTokens, makeRoomSummary, makeRoomDetail, makeRoomMember } from './factories'

// ── AuthManager mock ──────────────────────────────────────────────────────────

export type AuthManagerMock = {
  [K in keyof AuthManager]: ReturnType<typeof vi.fn>
}

export function makeAuthManagerMock(
  overrides: Partial<AuthManagerMock> = {}
): AuthManagerMock {
  return {
    isAuthenticated: vi.fn().mockReturnValue(false),
    getAccessToken: vi.fn<[], Promise<string>>().mockResolvedValue('test-access-token'),
    refreshTokens: vi.fn<[], Promise<StoredTokens>>().mockResolvedValue(makeStoredTokens()),
    login: vi.fn<[string, string], Promise<StoredTokens>>().mockResolvedValue(makeStoredTokens()),
    logout: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  }
}

// ── ApiClient mock ────────────────────────────────────────────────────────────

export type ApiClientMock = {
  [K in keyof ApiClient]: ReturnType<typeof vi.fn>
}

export function makeApiClientMock(
  overrides: Partial<ApiClientMock> = {}
): ApiClientMock {
  return {
    listRooms: vi.fn<[], Promise<RoomSummary[]>>().mockResolvedValue([makeRoomSummary()]),
    getRoom: vi.fn<[string], Promise<RoomDetail>>().mockResolvedValue(makeRoomDetail()),
    createRoom: vi.fn<[string, string[]], Promise<RoomSummary>>().mockResolvedValue(makeRoomSummary()),
    deleteRoom: vi.fn<[string], Promise<void>>().mockResolvedValue(undefined),
    addMember: vi.fn<[string, string, RoomMember['role']], Promise<RoomMember>>().mockResolvedValue(makeRoomMember()),
    removeMember: vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  }
}
