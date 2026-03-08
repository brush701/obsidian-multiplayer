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
  RoomMember,
} from '../src/types'
import {
  makeRoomListItem,
  makeRoomDetail,
  makeRoomMember,
  makeCreateRoomResult,
  makeJoinResult,
} from './factories'

// ── AuthManager mock ──────────────────────────────────────────────────────────

export interface AuthManagerMock extends IAuthManager {
  signIn: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
  getAccessToken: ReturnType<typeof vi.fn>
  handleAuthCallback: ReturnType<typeof vi.fn>
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
    handleAuthCallback: vi.fn(),
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
    getVersion: vi.fn().mockResolvedValue({ server: '1.0.0', apiVersion: '1', minPluginVersion: '1.0.0' }),
    listRooms: vi.fn().mockResolvedValue([makeRoomListItem()]),
    createRoom: vi.fn().mockResolvedValue(makeCreateRoomResult()),
    getRoom: vi.fn().mockResolvedValue(makeRoomDetail()),
    deleteRoom: vi.fn().mockResolvedValue(undefined),
    getMyRole: vi.fn().mockResolvedValue({ role: 'EDITOR' }),
    joinRoom: vi.fn().mockResolvedValue(makeJoinResult()),
    createInvite: vi.fn().mockResolvedValue({ inviteUrl: 'https://example.com/join?token=abc' }),
    revokeInvite: vi.fn().mockResolvedValue(undefined),
    updateMemberRole: vi.fn().mockResolvedValue({ userId: 'user-001', role: 'VIEWER' }),
    removeMember: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
