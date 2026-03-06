// Object Mother factory functions for core domain types.
// Each factory accepts an optional overrides object so callers only specify
// the fields relevant to a given test scenario.

import type { SharedTypeSettings } from '../src/sharedTypes'
import type {
  MultiplayerSettings,
  StoredTokens,
  RoomSummary,
  RoomDetail,
  RoomMember,
} from '../src/types'

// ── SharedTypeSettings ────────────────────────────────────────────────────────

export function makeSharedTypeSettings(
  overrides: Partial<SharedTypeSettings> = {}
): SharedTypeSettings {
  return {
    guid: 'aaaaaaaa-0000-0000-0000-000000000001',
    path: 'shared-folder',
    signalingServers: ['wss://signaling.example.com'],
    ...overrides,
  }
}

// ── MultiplayerSettings ───────────────────────────────────────────────────────

export function makeMultiplayerSettings(
  overrides: Partial<MultiplayerSettings> = {}
): MultiplayerSettings {
  return {
    sharedFolders: [],
    username: 'Anonymous',
    ...overrides,
  }
}

// ── StoredTokens ──────────────────────────────────────────────────────────────

export function makeStoredTokens(
  overrides: Partial<StoredTokens> = {}
): StoredTokens {
  return {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3_600_000, // 1 hour from now
    ...overrides,
  }
}

// ── RoomMember ────────────────────────────────────────────────────────────────

export function makeRoomMember(
  overrides: Partial<RoomMember> = {}
): RoomMember {
  return {
    userId: 'user-001',
    username: 'alice',
    role: 'editor',
    joinedAt: 1_700_000_000_000,
    ...overrides,
  }
}

// ── RoomSummary ───────────────────────────────────────────────────────────────

export function makeRoomSummary(
  overrides: Partial<RoomSummary> = {}
): RoomSummary {
  return {
    id: 'room-001',
    name: 'Test Room',
    ownerUsername: 'alice',
    memberCount: 1,
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

// ── RoomDetail ────────────────────────────────────────────────────────────────

export function makeRoomDetail(
  overrides: Partial<RoomDetail> = {}
): RoomDetail {
  return {
    id: 'room-001',
    name: 'Test Room',
    ownerUsername: 'alice',
    memberCount: 1,
    createdAt: 1_700_000_000_000,
    members: [makeRoomMember()],
    signalingServers: ['wss://signaling.example.com'],
    encryptionEnabled: true,
    ...overrides,
  }
}
