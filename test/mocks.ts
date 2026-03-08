// Typed mock helpers for system-boundary interfaces.
//
// Convention: mock ONLY at system boundaries (AuthManager, ApiClient).
// Internal collaborators (e.g. SharedFolder, SharedDoc) must NOT be mocked —
// test those through their public interfaces directly.
//
// Usage:
//   const auth = makeAuthManagerMock()
//   auth.isAuthenticated  // false by default
//   auth.getAccessToken() // resolves to null

import { vi } from 'vitest'
import type {
  IAuthManager,
  ApiClient,
  RoomSummary,
  RoomDetail,
  RoomMember,
} from '../src/types'
import { makeRoomSummary, makeRoomDetail, makeRoomMember } from './factories'

// ── AuthManager mock ──────────────────────────────────────────────────────────

export interface AuthManagerMock extends IAuthManager {
  signIn: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
  getAccessToken: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
}

export function makeAuthManagerMock(
  overrides: Partial<AuthManagerMock> = {}
): AuthManagerMock {
  return {
    isAuthenticated: false,
    userInfo: null,
    signIn: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    signOut: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    getAccessToken: vi.fn<[], Promise<string | null>>().mockResolvedValue(null),
    on: vi.fn(),
    off: vi.fn(),
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
