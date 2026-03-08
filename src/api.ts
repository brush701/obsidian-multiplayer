import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'

import type {
  ApiClient,
  ApiError,
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

/** Thrown when getAccessToken() returns null — no network call is made. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Authentication required')
    this.name = 'AuthRequiredError'
  }
}

/** Thrown on non-2xx responses. Carries the server's ApiError fields. */
export class ApiRequestError extends Error {
  public readonly apiError: ApiError

  constructor(apiError: ApiError) {
    super(apiError.message)
    this.name = 'ApiRequestError'
    this.apiError = apiError
  }

  get statusCode(): number { return this.apiError.statusCode }
  get errorCode(): string { return this.apiError.error }
}

/**
 * Function signature matching Obsidian's requestUrl.
 * Injected via constructor for testability.
 */
export type RequestUrlFn = (request: RequestUrlParam) => Promise<RequestUrlResponse>

export class TektiteApiClient implements ApiClient {
  private readonly serverUrl: string

  constructor(
    serverUrl: string,
    private auth: IAuthManager,
    private requestUrlFn: RequestUrlFn,
  ) {
    this.serverUrl = serverUrl
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.auth.getAccessToken()
    if (token === null) throw new AuthRequiredError()
    return { Authorization: `Bearer ${token}` }
  }

  private async request<T>(
    method: string,
    path: string,
    options?: { body?: unknown; auth?: boolean },
  ): Promise<T> {
    const { body, auth = true } = options ?? {}
    const headers: Record<string, string> = auth ? await this.getAuthHeaders() : {}
    const url = `${this.serverUrl}${path}`

    const params: RequestUrlParam = { url, method, headers, throw: false }

    if (body !== undefined) {
      params.contentType = 'application/json'
      params.body = JSON.stringify(body)
    }

    const response = await this.requestUrlFn(params)

    if (response.status < 200 || response.status >= 300) {
      let apiError: ApiError = {
        error: 'UNKNOWN',
        message: `HTTP ${response.status}`,
        statusCode: response.status,
      }
      try {
        const parsed = JSON.parse(response.text)
        apiError = {
          error: parsed.error ?? apiError.error,
          message: parsed.message ?? apiError.message,
          statusCode: response.status,
          details: parsed.details,
        }
      } catch {
        // body wasn't JSON — keep defaults
      }
      throw new ApiRequestError(apiError)
    }

    if (response.status === 204) return undefined as T

    return JSON.parse(response.text) as T
  }

  async getVersion(): Promise<VersionInfo> {
    return this.request('GET', '/api/version', { auth: false })
  }

  async listRooms(): Promise<RoomListItem[]> {
    return this.request('GET', '/api/rooms')
  }

  async createRoom(name: string): Promise<CreateRoomResult> {
    return this.request('POST', '/api/rooms', { body: { name } })
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
    return this.request('POST', '/api/rooms/join', { body: { token } })
  }

  async createInvite(
    guid: string,
    role: 'EDITOR' | 'VIEWER',
    expiresIn: InviteExpiry,
  ): Promise<InviteResponse> {
    return this.request('POST', `/api/rooms/${guid}/invites`, { body: { role, expiresIn } })
  }

  async revokeInvite(guid: string, token: string): Promise<void> {
    return this.request('DELETE', `/api/rooms/${guid}/invites/${token}`)
  }

  async updateMemberRole(
    guid: string,
    userId: string,
    role: 'EDITOR' | 'VIEWER',
  ): Promise<MemberRoleResult> {
    return this.request('PUT', `/api/rooms/${guid}/members/${userId}`, { body: { role } })
  }

  async removeMember(guid: string, userId: string): Promise<void> {
    return this.request('DELETE', `/api/rooms/${guid}/members/${userId}`)
  }
}
