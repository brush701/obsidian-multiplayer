// Object Mother factory functions for core domain types.
// Each factory accepts an optional overrides object so callers only specify
// the fields relevant to a given test scenario.

import type { SharedTypeSettings } from '../src/sharedTypes'
import type {
  MultiplayerSettings,
  RoomListItem,
  RoomDetail,
  RoomMember,
  CreateRoomResult,
  JoinResult,
  InviteResponse,
} from '../src/types'

// ── SharedTypeSettings ────────────────────────────────────────────────────────

export function makeSharedTypeSettings(
  overrides: Partial<SharedTypeSettings> = {}
): SharedTypeSettings {
  return {
    guid: 'aaaaaaaa-0000-0000-0000-000000000001',
    path: 'shared-folder',
    name: '',
    ...overrides,
  }
}

// ── MultiplayerSettings ───────────────────────────────────────────────────────

export function makeMultiplayerSettings(
  overrides: Partial<MultiplayerSettings> = {}
): MultiplayerSettings {
  return {
    serverUrl: '',
    username: '',
    sharedFolders: [],
    ...overrides,
  }
}

// ── RoomMember ────────────────────────────────────────────────────────────────

export function makeRoomMember(
  overrides: Partial<RoomMember> = {}
): RoomMember {
  return {
    userId: 'user-001',
    email: 'alice@test.com',
    name: 'Alice',
    role: 'EDITOR',
    ...overrides,
  }
}

// ── RoomListItem ──────────────────────────────────────────────────────────────

export function makeRoomListItem(
  overrides: Partial<RoomListItem> = {}
): RoomListItem {
  return {
    guid: 'room-001',
    name: 'Test Room',
    role: 'OWNER',
    orgId: 'org-001',
    ...overrides,
  }
}

// ── RoomDetail ────────────────────────────────────────────────────────────────

export function makeRoomDetail(
  overrides: Partial<RoomDetail> = {}
): RoomDetail {
  return {
    guid: 'room-001',
    name: 'Test Room',
    orgId: 'org-001',
    openToOrg: false,
    members: [makeRoomMember()],
    ...overrides,
  }
}

// ── CreateRoomResult ──────────────────────────────────────────────────────────

export function makeCreateRoomResult(
  overrides: Partial<CreateRoomResult> = {}
): CreateRoomResult {
  return {
    guid: 'room-001',
    name: 'Test Room',
    orgId: 'org-001',
    ...overrides,
  }
}

// ── JoinResult ────────────────────────────────────────────────────────────────

export function makeJoinResult(
  overrides: Partial<JoinResult> = {}
): JoinResult {
  return {
    guid: 'room-001',
    name: 'Test Room',
    ...overrides,
  }
}

// ── InviteResponse ───────────────────────────────────────────────────────────

export function makeInviteResponse(
  overrides: Partial<InviteResponse> = {}
): InviteResponse {
  return {
    inviteUrl: 'https://example.com/join?token=invite-token-001',
    ...overrides,
  }
}
