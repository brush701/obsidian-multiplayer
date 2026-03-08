// Core domain types for the obsidian-multiplayer plugin.
// These are used throughout the codebase and in test factories.

import { SharedTypeSettings } from './sharedTypes'

export interface MultiplayerSettings {
  sharedFolders: SharedTypeSettings[]
  username: string
}

// Tokens stored locally after authentication with a multiplayer server.
export interface StoredTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // Unix timestamp (ms)
}

// Lightweight summary of a room returned from list endpoints.
export interface RoomSummary {
  id: string
  name: string
  ownerUsername: string
  memberCount: number
  createdAt: number // Unix timestamp (ms)
}

// Full details of a room including its member list.
export interface RoomDetail extends RoomSummary {
  members: RoomMember[]
  encryptionEnabled: boolean
}

// A single member of a room.
export interface RoomMember {
  userId: string
  username: string
  role: 'owner' | 'editor' | 'viewer'
  joinedAt: number // Unix timestamp (ms)
}

// Interface for the authentication boundary — mocked in tests.
export interface AuthManager {
  isAuthenticated(): boolean
  getAccessToken(): Promise<string>
  refreshTokens(): Promise<StoredTokens>
  login(username: string, password: string): Promise<StoredTokens>
  logout(): Promise<void>
}

// Interface for the API client boundary — mocked in tests.
export interface ApiClient {
  listRooms(): Promise<RoomSummary[]>
  getRoom(id: string): Promise<RoomDetail>
  createRoom(name: string): Promise<RoomSummary>
  deleteRoom(id: string): Promise<void>
  addMember(roomId: string, userId: string, role: RoomMember['role']): Promise<RoomMember>
  removeMember(roomId: string, userId: string): Promise<void>
}
