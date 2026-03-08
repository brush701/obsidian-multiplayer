// Suite: SharedFolderModal
// Scope: Unit
// Spec: TASK-17 — [P3-S2] SharedFolderModal: Create tab
// What this suite validates:
//   - Successful room creation stores settings, calls addSharedFolder, and closes
//   - AuthRequiredError shows "Sign in first." notice
//   - ApiRequestError shows "Could not create room: …" notice
//   - Double-click guard prevents concurrent createRoom calls
//   - Empty room name is a no-op

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { App, TFolder } from 'obsidian'
import { SharedFolderModal } from '../src/modals'
import { AuthRequiredError, ApiRequestError } from '../src/api'
import { makeCreateRoomResult, makeJoinResult } from './factories'

// Capture Notice messages
const notices: string[] = []
vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('obsidian')>('obsidian')
  return {
    ...actual,
    Notice: class {
      constructor(message: string) { notices.push(message) }
    },
  }
})

// Mock SharedFolder so the constructor doesn't create real WebSocket/IDB connections
vi.mock('../src/sharedTypes', () => ({
  SharedFolder: class {
    settings: unknown
    constructor(settings: unknown) { this.settings = settings }
  },
}))

// Minimal mock plugin that satisfies SharedFolderModal's needs
function makePlugin(overrides: Record<string, unknown> = {}) {
  return {
    settings: { sharedFolders: [], serverUrl: 'https://example.com', username: '' },
    sharedFolders: [],
    apiClient: {
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
    },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    addSharedFolder: vi.fn(),
    refreshIconStyles: vi.fn(),
    ...overrides,
  }
}

// Build a modal and wire internal state that onOpen() normally sets via DOM
function buildModal(folderPath = 'my-folder', pluginOverrides: Record<string, unknown> = {}) {
  const plugin = makePlugin(pluginOverrides)
  const folder = new TFolder(folderPath)
  const app = new App()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modal = new SharedFolderModal(app as any, plugin as any, folder)

  const inputEl = { value: folder.name, focus: vi.fn() }
  const btnEl = { disabled: false, textContent: 'Create Room' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(modal as any).roomNameInput = inputEl
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(modal as any).createBtn = btnEl
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(modal as any).close = vi.fn()

  return { modal, plugin, inputEl, btnEl }
}

describe('SharedFolderModal — Create tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notices.length = 0
  })

  it('pre-fills room name with the folder name', () => {
    const { inputEl } = buildModal('projects/my-notes')
    expect(inputEl.value).toBe('my-notes')
  })

  describe('handleCreate — success', () => {
    it('calls createRoom, saves settings, adds folder, and closes', async () => {
      const result = makeCreateRoomResult({ guid: 'room-abc', name: 'My Room' })
      const createRoom = vi.fn().mockResolvedValue(result)
      const { modal, plugin } = buildModal('shared-stuff', {
        apiClient: { createRoom },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleCreate()

      expect(createRoom).toHaveBeenCalledWith('shared-stuff')
      expect(plugin.settings.sharedFolders).toHaveLength(1)
      expect(plugin.settings.sharedFolders[0]).toMatchObject({
        guid: 'room-abc',
        name: 'My Room',
        path: 'shared-stuff',
      })
      expect(plugin.saveSettings).toHaveBeenCalled()
      expect(plugin.addSharedFolder).toHaveBeenCalled()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((modal as any).close).toHaveBeenCalled()
    })
  })

  describe('handleCreate — AuthRequiredError', () => {
    it('shows "Sign in first." notice and resets button', async () => {
      const { modal, plugin, btnEl } = buildModal('folder', {
        apiClient: { createRoom: vi.fn().mockRejectedValue(new AuthRequiredError()) },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleCreate()

      expect(notices).toContain('Sign in first.')
      expect(btnEl.textContent).toBe('Create Room')
      expect(btnEl.disabled).toBe(false)
      expect(plugin.saveSettings).not.toHaveBeenCalled()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((modal as any).close).not.toHaveBeenCalled()
    })
  })

  describe('handleCreate — ApiRequestError', () => {
    it('shows error message notice and resets button', async () => {
      const apiError = new ApiRequestError({
        error: 'CONFLICT',
        message: 'Room already exists',
        statusCode: 409,
      })
      const { modal, plugin, btnEl } = buildModal('folder', {
        apiClient: { createRoom: vi.fn().mockRejectedValue(apiError) },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleCreate()

      expect(notices).toContain('Could not create room: Room already exists')
      expect(btnEl.textContent).toBe('Create Room')
      expect(plugin.saveSettings).not.toHaveBeenCalled()
    })
  })

  describe('double-click guard', () => {
    it('ignores second call while first is in flight', async () => {
      let resolveCreate!: (v: unknown) => void
      const createRoom = vi.fn().mockImplementation(() => new Promise(r => { resolveCreate = r }))

      const { modal } = buildModal('folder', { apiClient: { createRoom } })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p1 = (modal as any).handleCreate()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p2 = (modal as any).handleCreate()

      resolveCreate(makeCreateRoomResult())
      await p1
      await p2

      expect(createRoom).toHaveBeenCalledTimes(1)
    })
  })

  describe('empty room name', () => {
    it('does nothing when room name is empty', async () => {
      const createRoom = vi.fn()
      const { modal, inputEl } = buildModal('folder', { apiClient: { createRoom } })
      inputEl.value = '   '

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleCreate()

      expect(createRoom).not.toHaveBeenCalled()
    })
  })
})

// ── Join tab ────────────────────────────────────────────────────────────────

function buildJoinModal(folderPath = 'my-folder', pluginOverrides: Record<string, unknown> = {}) {
  const plugin = makePlugin(pluginOverrides)
  const folder = new TFolder(folderPath)
  const app = new App()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modal = new SharedFolderModal(app as any, plugin as any, folder)

  const inviteInputEl = { value: '', focus: vi.fn() }
  const joinBtnEl = { disabled: false, textContent: 'Join Room' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(modal as any).inviteInput = inviteInputEl
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(modal as any).joinBtn = joinBtnEl
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(modal as any).close = vi.fn()

  return { modal, plugin, inviteInputEl, joinBtnEl }
}

describe('SharedFolderModal — Join tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notices.length = 0
  })

  describe('token extraction', () => {
    it('extracts token from a URL with ?token= parameter', async () => {
      const joinRoom = vi.fn().mockResolvedValue(makeJoinResult())
      const { modal, inviteInputEl } = buildJoinModal('folder', {
        apiClient: { createRoom: vi.fn(), joinRoom },
      })
      inviteInputEl.value = 'https://server.com/join?token=abc-123'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleJoin()

      expect(joinRoom).toHaveBeenCalledWith('abc-123')
    })

    it('uses raw input as token when not a URL', async () => {
      const joinRoom = vi.fn().mockResolvedValue(makeJoinResult())
      const { modal, inviteInputEl } = buildJoinModal('folder', {
        apiClient: { createRoom: vi.fn(), joinRoom },
      })
      inviteInputEl.value = 'abc-123'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleJoin()

      expect(joinRoom).toHaveBeenCalledWith('abc-123')
    })
  })

  describe('handleJoin — success', () => {
    it('calls joinRoom, saves settings, adds folder, and closes', async () => {
      const result = makeJoinResult({ guid: 'room-xyz', name: 'Joined Room' })
      const joinRoom = vi.fn().mockResolvedValue(result)
      const { modal, plugin, inviteInputEl } = buildJoinModal('target-folder', {
        apiClient: { createRoom: vi.fn(), joinRoom },
      })
      inviteInputEl.value = 'some-token'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleJoin()

      expect(joinRoom).toHaveBeenCalledWith('some-token')
      expect(plugin.settings.sharedFolders).toHaveLength(1)
      expect(plugin.settings.sharedFolders[0]).toMatchObject({
        guid: 'room-xyz',
        name: 'Joined Room',
        path: 'target-folder',
      })
      expect(plugin.saveSettings).toHaveBeenCalled()
      expect(plugin.addSharedFolder).toHaveBeenCalled()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((modal as any).close).toHaveBeenCalled()
    })
  })

  describe('handleJoin — AuthRequiredError', () => {
    it('shows "Sign in first." notice and resets button', async () => {
      const { modal, plugin, inviteInputEl, joinBtnEl } = buildJoinModal('folder', {
        apiClient: { createRoom: vi.fn(), joinRoom: vi.fn().mockRejectedValue(new AuthRequiredError()) },
      })
      inviteInputEl.value = 'some-token'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleJoin()

      expect(notices).toContain('Sign in first.')
      expect(joinBtnEl.textContent).toBe('Join Room')
      expect(joinBtnEl.disabled).toBe(false)
      expect(plugin.saveSettings).not.toHaveBeenCalled()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((modal as any).close).not.toHaveBeenCalled()
    })
  })

  describe('handleJoin — 404 ApiRequestError', () => {
    it('shows "invalid or expired" notice', async () => {
      const apiError = new ApiRequestError({
        error: 'NOT_FOUND',
        message: 'Invite not found',
        statusCode: 404,
      })
      const { modal, inviteInputEl } = buildJoinModal('folder', {
        apiClient: { createRoom: vi.fn(), joinRoom: vi.fn().mockRejectedValue(apiError) },
      })
      inviteInputEl.value = 'bad-token'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleJoin()

      expect(notices).toContain('Invite link is invalid or has expired.')
    })
  })

  describe('handleJoin — 410 ApiRequestError', () => {
    it('shows "invalid or expired" notice', async () => {
      const apiError = new ApiRequestError({
        error: 'GONE',
        message: 'Invite expired',
        statusCode: 410,
      })
      const { modal, inviteInputEl } = buildJoinModal('folder', {
        apiClient: { createRoom: vi.fn(), joinRoom: vi.fn().mockRejectedValue(apiError) },
      })
      inviteInputEl.value = 'expired-token'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleJoin()

      expect(notices).toContain('Invite link is invalid or has expired.')
    })
  })

  describe('handleJoin — other ApiRequestError', () => {
    it('shows generic error notice', async () => {
      const apiError = new ApiRequestError({
        error: 'FORBIDDEN',
        message: 'Already a member',
        statusCode: 403,
      })
      const { modal, inviteInputEl } = buildJoinModal('folder', {
        apiClient: { createRoom: vi.fn(), joinRoom: vi.fn().mockRejectedValue(apiError) },
      })
      inviteInputEl.value = 'some-token'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleJoin()

      expect(notices).toContain('Could not join room: Already a member')
    })
  })

  describe('double-click guard', () => {
    it('ignores second call while first is in flight', async () => {
      let resolveJoin!: (v: unknown) => void
      const joinRoom = vi.fn().mockImplementation(() => new Promise(r => { resolveJoin = r }))

      const { modal, inviteInputEl } = buildJoinModal('folder', {
        apiClient: { createRoom: vi.fn(), joinRoom },
      })
      inviteInputEl.value = 'some-token'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p1 = (modal as any).handleJoin()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p2 = (modal as any).handleJoin()

      resolveJoin(makeJoinResult())
      await p1
      await p2

      expect(joinRoom).toHaveBeenCalledTimes(1)
    })
  })

  describe('empty input', () => {
    it('does nothing when input is empty', async () => {
      const joinRoom = vi.fn()
      const { modal, inviteInputEl } = buildJoinModal('folder', {
        apiClient: { createRoom: vi.fn(), joinRoom },
      })
      inviteInputEl.value = '   '

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).handleJoin()

      expect(joinRoom).not.toHaveBeenCalled()
    })
  })
})
