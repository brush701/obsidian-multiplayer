// Core domain types for the obsidian-multiplayer plugin.
// These are used throughout the codebase and in test factories.
// Types in this file match the server API contract in API.md.

import { SharedTypeSettings } from './sharedTypes'

export interface MultiplayerSettings {
  serverUrl: string
  username: string
  sharedFolders: SharedTypeSettings[]
}

// ── Roles ────────────────────────────────────────────────────────────────────

export type RoomRole = 'OWNER' | 'EDITOR' | 'VIEWER'

// ── Room types ───────────────────────────────────────────────────────────────

/** Returned by `GET /api/rooms` (list). */
export interface RoomListItem {
  guid: string
  name: string
  role: RoomRole
  orgId: string
}

/** Returned by `GET /api/rooms/:guid` (detail). */
export interface RoomDetail {
  guid: string
  name: string
  orgId: string
  openToOrg: boolean
  members: RoomMember[]
}

/** A member within a RoomDetail. */
export interface RoomMember {
  userId: string
  email: string
  name: string
  role: RoomRole
}

// ── Request/response types ───────────────────────────────────────────────────

/** Returned by `POST /api/rooms` (create). */
export interface CreateRoomResult {
  guid: string
  name: string
  orgId: string
}

/** Returned by `POST /api/rooms/join`. */
export interface JoinResult {
  guid: string
  name: string
}

/** Returned by `POST /api/rooms/:guid/invites`. */
export interface InviteResponse {
  inviteUrl: string
}

/** Returned by `PUT /api/rooms/:guid/members/:userId`. */
export interface MemberRoleResult {
  userId: string
  role: RoomRole
}

/** Returned by `GET /api/rooms/:guid/me`. */
export interface MyRoleResult {
  role: RoomRole
}

/** Returned by `GET /api/version`. */
export interface VersionInfo {
  server: string
  apiVersion: string
  minPluginVersion: string
}

// ── Error types ──────────────────────────────────────────────────────────────

export interface ApiError {
  error: string
  message: string
  statusCode: number
  details?: { field: string; message: string }[]
}

// ── Invite expiry ────────────────────────────────────────────────────────────

export type InviteExpiry = '1d' | '7d' | '30d'

// ── Auth boundary ────────────────────────────────────────────────────────────

/** Interface for the authentication boundary — mocked in tests. */
export interface IAuthManager {
  signIn(): Promise<void>
  signOut(): Promise<void>
  getAccessToken(): Promise<string | null>
  handleAuthCallback(params: Record<string, string>): void
  readonly isAuthenticated: boolean
  readonly userInfo: { email: string; name: string } | null
  on(event: 'auth-changed', handler: () => void): void
  off(event: 'auth-changed', handler: () => void): void
}

// ── API client boundary ──────────────────────────────────────────────────────

/** Interface for the API client boundary — mocked in tests. */
export interface ApiClient {
  getVersion(): Promise<VersionInfo>
  listRooms(): Promise<RoomListItem[]>
  createRoom(name: string): Promise<CreateRoomResult>
  getRoom(guid: string): Promise<RoomDetail>
  deleteRoom(guid: string): Promise<void>
  getMyRole(guid: string): Promise<MyRoleResult>
  joinRoom(token: string): Promise<JoinResult>
  createInvite(guid: string, role: 'EDITOR' | 'VIEWER', expiresIn: InviteExpiry): Promise<InviteResponse>
  revokeInvite(guid: string, token: string): Promise<void>
  updateMemberRole(guid: string, userId: string, role: 'EDITOR' | 'VIEWER'): Promise<MemberRoleResult>
  removeMember(guid: string, userId: string): Promise<void>
}
