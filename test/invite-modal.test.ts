// Suite: InviteModal
// Scope: Unit
// Spec: TASK-20 — [P3-S5] InviteModal
// What this suite validates:
//   - Successful invite generation copies URL to clipboard and shows notice
//   - Modal remains open after success
//   - AuthRequiredError shows "Sign in first." notice
//   - ApiRequestError shows "Could not create invite: …" notice
//   - Double-click guard prevents concurrent createInvite calls
//   - Default role is EDITOR and default expiry is 7d

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { App } from 'obsidian'
import { InviteModal } from '../src/modals'
import { AuthRequiredError, ApiRequestError } from '../src/api'
import { makeInviteResponse } from './factories'

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

// Mock SharedFolder
vi.mock('../src/sharedTypes', () => ({
  SharedFolder: class {
    settings: unknown
    constructor(settings: unknown) { this.settings = settings }
  },
}))

// Mock clipboard
const clipboardContents: string[] = []
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(async (text: string) => { clipboardContents.push(text) }),
  },
})

function makePlugin(overrides: Record<string, unknown> = {}) {
  return {
    settings: { sharedFolders: [], serverUrl: 'https://example.com', username: '' },
    sharedFolders: [],
    apiClient: {
      createInvite: vi.fn(),
    },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function buildInviteModal(
  sharedFolderSettings = { guid: 'room-abc', name: 'My Room', path: 'shared' },
  pluginOverrides: Record<string, unknown> = {},
) {
  const plugin = makePlugin(pluginOverrides)
  const app = new App()
  const sharedFolder = { settings: sharedFolderSettings } as any

  const modal = new InviteModal(app as any, plugin as any, sharedFolder)

  const btnEl = { disabled: false, textContent: 'Copy Invite Link' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(modal as any).copyBtn = btnEl
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(modal as any).close = vi.fn()

  return { modal, plugin, btnEl }
}

describe('InviteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notices.length = 0
    clipboardContents.length = 0
  })

  describe('defaults', () => {
    it('has EDITOR as default role and 7d as default expiry', () => {
      const { modal } = buildInviteModal()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((modal as any).selectedRole).toBe('EDITOR')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((modal as any).selectedExpiry).toBe('7d')
    })
  })

  describe('handleCopyInvite — success', () => {
    it('calls createInvite, copies URL to clipboard, and shows notice', async () => {
      const result = makeInviteResponse({ inviteUrl: 'https://example.com/join?token=xyz' })
      const createInvite = vi.fn().mockResolvedValue(result)
      const { modal } = buildInviteModal(undefined, {
        apiClient: { createInvite },
      })

      await modal.handleCopyInvite()

      expect(createInvite).toHaveBeenCalledWith('room-abc', 'EDITOR', '7d')
      expect(clipboardContents).toContain('https://example.com/join?token=xyz')
      expect(notices).toContain('Invite link copied.')
    })

    it('does not close the modal after success', async () => {
      const createInvite = vi.fn().mockResolvedValue(makeInviteResponse())
      const { modal } = buildInviteModal(undefined, {
        apiClient: { createInvite },
      })

      await modal.handleCopyInvite()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((modal as any).close).not.toHaveBeenCalled()
    })

    it('resets button state after success', async () => {
      const createInvite = vi.fn().mockResolvedValue(makeInviteResponse())
      const { modal, btnEl } = buildInviteModal(undefined, {
        apiClient: { createInvite },
      })

      await modal.handleCopyInvite()

      expect(btnEl.disabled).toBe(false)
      expect(btnEl.textContent).toBe('Copy Invite Link')
    })
  })

  describe('handleCopyInvite — with custom role and expiry', () => {
    it('passes selected role and expiry to createInvite', async () => {
      const createInvite = vi.fn().mockResolvedValue(makeInviteResponse())
      const { modal } = buildInviteModal(undefined, {
        apiClient: { createInvite },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modal as any).selectedRole = 'VIEWER'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modal as any).selectedExpiry = '30d'

      await modal.handleCopyInvite()

      expect(createInvite).toHaveBeenCalledWith('room-abc', 'VIEWER', '30d')
    })
  })

  describe('handleCopyInvite — AuthRequiredError', () => {
    it('shows "Sign in first." notice and resets button', async () => {
      const { modal, btnEl } = buildInviteModal(undefined, {
        apiClient: { createInvite: vi.fn().mockRejectedValue(new AuthRequiredError()) },
      })

      await modal.handleCopyInvite()

      expect(notices).toContain('Sign in first.')
      expect(btnEl.textContent).toBe('Copy Invite Link')
      expect(btnEl.disabled).toBe(false)
      expect(clipboardContents).toHaveLength(0)
    })
  })

  describe('handleCopyInvite — ApiRequestError', () => {
    it('shows error message notice and resets button', async () => {
      const apiError = new ApiRequestError({
        error: 'FORBIDDEN',
        message: 'Insufficient permissions',
        statusCode: 403,
      })
      const { modal, btnEl } = buildInviteModal(undefined, {
        apiClient: { createInvite: vi.fn().mockRejectedValue(apiError) },
      })

      await modal.handleCopyInvite()

      expect(notices).toContain('Could not create invite: Insufficient permissions')
      expect(btnEl.textContent).toBe('Copy Invite Link')
      expect(btnEl.disabled).toBe(false)
    })
  })

  describe('role gating (defence-in-depth)', () => {
    it('disables Copy Invite Link button when role is VIEWER', () => {
      const app = new App()
      const plugin = makePlugin()
      const sharedFolder = { settings: { guid: 'room-abc', name: 'My Room', path: 'shared' }, cachedRole: 'VIEWER' } as any
      const modal = new InviteModal(app as any, plugin as any, sharedFolder)

      // Trigger onOpen to build the DOM
      modal.onOpen()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const btn = (modal as any).copyBtn as HTMLButtonElement
      expect(btn.disabled).toBe(true)
      expect(btn.title).toBe('Viewers cannot create invites')
    })

    it('does not disable Copy Invite Link button when role is EDITOR', () => {
      const app = new App()
      const plugin = makePlugin()
      const sharedFolder = { settings: { guid: 'room-abc', name: 'My Room', path: 'shared' }, cachedRole: 'EDITOR' } as any
      const modal = new InviteModal(app as any, plugin as any, sharedFolder)

      modal.onOpen()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const btn = (modal as any).copyBtn as HTMLButtonElement
      expect(btn.disabled).toBeFalsy()
    })

    it('does not disable Copy Invite Link button when role is null', () => {
      const app = new App()
      const plugin = makePlugin()
      const sharedFolder = { settings: { guid: 'room-abc', name: 'My Room', path: 'shared' }, cachedRole: null } as any
      const modal = new InviteModal(app as any, plugin as any, sharedFolder)

      modal.onOpen()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const btn = (modal as any).copyBtn as HTMLButtonElement
      expect(btn.disabled).toBeFalsy()
    })
  })

  describe('double-click guard', () => {
    it('ignores second call while first is in flight', async () => {
      let resolveCreate!: (v: unknown) => void
      const createInvite = vi.fn().mockImplementation(() => new Promise(r => { resolveCreate = r }))

      const { modal } = buildInviteModal(undefined, {
        apiClient: { createInvite },
      })

      const p1 = modal.handleCopyInvite()
      const p2 = modal.handleCopyInvite()

      resolveCreate(makeInviteResponse())
      await p1
      await p2

      expect(createInvite).toHaveBeenCalledTimes(1)
    })
  })
})
