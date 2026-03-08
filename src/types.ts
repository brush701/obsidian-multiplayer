// Core domain types for the obsidian-multiplayer plugin.
// These are used throughout the codebase and in test factories.

import { SharedTypeSettings } from './sharedTypes'

export interface MultiplayerSettings {
  serverUrl: string
  username: string
  sharedFolders: SharedTypeSettings[]
}

// Lightweight summary of a room returned from list endpoints.
// TODO(TASK-39): Reconcile with API.md contract
export interface RoomSummary {
  id: string
  name: string
  ownerUsername: string
  memberCount: number
  createdAt: number // Unix timestamp (ms)
}

// Full details of a room including its member list.
// TODO(TASK-39): Reconcile with API.md contract
export interface RoomDetail extends RoomSummary {
  members: RoomMember[]
  encryptionEnabled: boolean
}

// A single member of a room.
// TODO(TASK-39): Reconcile with API.md contract
export interface RoomMember {
  userId: string
  username: string
  role: 'owner' | 'editor' | 'viewer'
  joinedAt: number // Unix timestamp (ms)
}

// Interface for the authentication boundary — mocked in tests.
export interface IAuthManager {
  signIn(): Promise<void>
  signOut(): Promise<void>
  getAccessToken(): Promise<string | null>
  readonly isAuthenticated: boolean
  readonly userInfo: { email: string; name: string } | null
  on(event: 'auth-changed', handler: () => void): void
  off(event: 'auth-changed', handler: () => void): void
}

// Interface for the API client boundary — mocked in tests.
// TODO(TASK-39): Reconcile with API.md contract
export interface ApiClient {
  listRooms(): Promise<RoomSummary[]>
  getRoom(id: string): Promise<RoomDetail>
  createRoom(name: string): Promise<RoomSummary>
  deleteRoom(id: string): Promise<void>
  addMember(roomId: string, userId: string, role: RoomMember['role']): Promise<RoomMember>
  removeMember(roomId: string, userId: string): Promise<void>
}
