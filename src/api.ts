import type {
  MultiplayerSettings,
  ApiClient,
  IAuthManager,
  VersionInfo,
  RoomListItem,
  CreateRoomResult,
  RoomDetail,
  MyRoleResult,
  JoinResult,
  InviteResponse,
  InviteExpiry,
  MemberRoleResult,
} from './types'

export class AuthRequiredError extends Error {
  constructor() {
    super('Authentication required')
    this.name = 'AuthRequiredError'
  }
}

export class ApiRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export class TektiteApiClient implements ApiClient {
  constructor(
    private settings: MultiplayerSettings,
    private auth: IAuthManager,
  ) {}

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.auth.getAccessToken()
    if (token === null) throw new AuthRequiredError()
    return { Authorization: `Bearer ${token}` }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers = await this.getAuthHeaders()
    const url = `${this.settings.serverUrl}${path}`
    const init: RequestInit = { method, headers: { ...headers } }

    if (body !== undefined) {
      ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    const response = await fetch(url, init)

    if (!response.ok) {
      let errorCode = 'UNKNOWN'
      let message = `HTTP ${response.status}`
      try {
        const err = await response.json()
        errorCode = err.error ?? errorCode
        message = err.message ?? message
      } catch {
        // body wasn't JSON — keep defaults
      }
      throw new ApiRequestError(response.status, errorCode, message)
    }

    if (response.status === 204) return undefined as T

    return response.json() as Promise<T>
  }

  async getVersion(): Promise<VersionInfo> {
    return this.request('GET', '/api/version')
  }

  async listRooms(): Promise<RoomListItem[]> {
    return this.request('GET', '/api/rooms')
  }

  async createRoom(name: string): Promise<CreateRoomResult> {
    return this.request('POST', '/api/rooms', { name })
  }

  async getRoom(guid: string): Promise<RoomDetail> {
    return this.request('GET', `/api/rooms/${guid}`)
  }

  async deleteRoom(guid: string): Promise<void> {
    return this.request('DELETE', `/api/rooms/${guid}`)
  }

  async getMyRole(guid: string): Promise<MyRoleResult> {
    return this.request('GET', `/api/rooms/${guid}/me`)
  }

  async joinRoom(token: string): Promise<JoinResult> {
    return this.request('POST', '/api/rooms/join', { token })
  }

  async createInvite(
    guid: string,
    role: 'EDITOR' | 'VIEWER',
    expiresIn: InviteExpiry,
  ): Promise<InviteResponse> {
    return this.request('POST', `/api/rooms/${guid}/invites`, { role, expiresIn })
  }

  async revokeInvite(guid: string, token: string): Promise<void> {
    return this.request('DELETE', `/api/rooms/${guid}/invites/${token}`)
  }

  async updateMemberRole(
    guid: string,
    userId: string,
    role: 'EDITOR' | 'VIEWER',
  ): Promise<MemberRoleResult> {
    return this.request('PUT', `/api/rooms/${guid}/members/${userId}`, { role })
  }

  async removeMember(guid: string, userId: string): Promise<void> {
    return this.request('DELETE', `/api/rooms/${guid}/members/${userId}`)
  }
}
