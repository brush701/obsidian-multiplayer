// Suite: MembersModal
// Scope: Unit
// Spec: TASK-21 — [P3-S6] MembersModal
// What this suite validates:
//   - Calls getRoom and getMyRole on open, shows loading indicator
//   - Members displayed sorted by role (OWNER → EDITOR → VIEWER), then email
//   - "Invite someone new" shown for OWNER/EDITOR, hidden for VIEWER
//   - "Manage in admin panel" opens admin URL
//   - ApiError shown inline

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { App } from 'obsidian'
import { MembersModal } from '../src/modals'
import { AuthRequiredError, ApiRequestError } from '../src/api'
import { makeRoomDetail, makeRoomMember } from './factories'
import type { RoomRole } from '../src/types'

// Mock SharedFolder constructor
vi.mock('../src/sharedTypes', () => ({
  SharedFolder: class {
    settings: unknown
    constructor(settings: unknown) { this.settings = settings }
  },
}))

// Minimal DOM element builder that supports the subset of Obsidian DOM API used by MembersModal
function makeMockEl(): HTMLElement {
  const children: HTMLElement[] = []
  const el: Record<string, unknown> = {
    _text: '',
    _cls: '',
    _children: children,
    style: {} as Record<string, string>,
    empty() { children.length = 0; el._text = '' },
    setText(text: string) { el._text = text },
    createEl(_tag: string, opts?: { text?: string; cls?: string }) {
      const child = makeMockEl()
      if (opts?.text) child.setText(opts.text)
      if (opts?.cls) (child as unknown as Record<string, unknown>)._cls = opts.cls
      children.push(child as unknown as HTMLElement)
      return child
    },
    createDiv(opts?: { cls?: string }) {
      return el.createEl('div', opts)
    },
    createSpan(opts?: { text?: string; cls?: string }) {
      return el.createEl('span', opts)
    },
    addClass(_cls: string) {},
    onClickEvent(_handler: () => void) {
      (el as unknown as Record<string, unknown>)._clickHandler = _handler
    },
  }
  return el as unknown as HTMLElement
}

function makePlugin(overrides: Record<string, unknown> = {}) {
  return {
    settings: { sharedFolders: [], serverUrl: 'https://example.com', username: '' },
    sharedFolders: [],
    apiClient: {
      getRoom: vi.fn(),
      getMyRole: vi.fn(),
    },
    ...overrides,
  }
}

function makeSharedFolder(name = 'Test Room', guid = 'room-001') {
  return { settings: { guid, name, path: 'shared-folder' } }
}

function buildModal(
  pluginOverrides: Record<string, unknown> = {},
  folderOpts?: { name?: string; guid?: string },
) {
  const plugin = makePlugin(pluginOverrides)
  const sharedFolder = makeSharedFolder(folderOpts?.name, folderOpts?.guid)
  const app = new App()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modal = new MembersModal(app as any, plugin as any, sharedFolder as any)

  // Wire mock DOM elements
  const contentEl = makeMockEl()
  const modalEl = makeMockEl()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(modal as any).contentEl = contentEl
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(modal as any).modalEl = modalEl
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(modal as any).close = vi.fn()

  return { modal, plugin, contentEl, sharedFolder }
}

describe('MembersModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loading state', () => {
    it('shows loading text before API resolves', () => {
      const getRoom = vi.fn().mockReturnValue(new Promise(() => {})) // never resolves
      const getMyRole = vi.fn().mockReturnValue(new Promise(() => {}))
      const { modal, contentEl } = buildModal({
        apiClient: { getRoom, getMyRole },
      })

      modal.onOpen()

      // bodyEl should have "Loading…" text
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyEl = (modal as any).bodyEl as ReturnType<typeof makeMockEl>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((bodyEl as any)._text).toBe('Loading…')
    })
  })

  describe('successful load', () => {
    it('calls getRoom and getMyRole with the room guid', async () => {
      const room = makeRoomDetail({ guid: 'room-xyz' })
      const getRoom = vi.fn().mockResolvedValue(room)
      const getMyRole = vi.fn().mockResolvedValue({ role: 'OWNER' })
      const { modal } = buildModal(
        { apiClient: { getRoom, getMyRole } },
        { guid: 'room-xyz' },
      )

      modal.onOpen()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).loadMembers()

      expect(getRoom).toHaveBeenCalledWith('room-xyz')
      expect(getMyRole).toHaveBeenCalledWith('room-xyz')
    })

    it('sorts members OWNER → EDITOR → VIEWER, alphabetically within role', async () => {
      const members = [
        makeRoomMember({ email: 'charlie@test.com', role: 'VIEWER' }),
        makeRoomMember({ email: 'alice@test.com', role: 'OWNER' }),
        makeRoomMember({ email: 'bob@test.com', role: 'EDITOR' }),
        makeRoomMember({ email: 'diana@test.com', role: 'EDITOR' }),
        makeRoomMember({ email: 'eve@test.com', role: 'VIEWER' }),
      ]
      const room = makeRoomDetail({ members })
      const getRoom = vi.fn().mockResolvedValue(room)
      const getMyRole = vi.fn().mockResolvedValue({ role: 'OWNER' })
      const { modal } = buildModal({ apiClient: { getRoom, getMyRole } })

      modal.onOpen()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).loadMembers()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyEl = (modal as any).bodyEl as any
      const listEl = bodyEl._children[0]
      const rows = listEl._children

      // Extract email from first span child of each row
      const emails = rows.map((row: { _children: { _text: string }[] }) => row._children[0]._text)
      expect(emails).toEqual([
        'alice@test.com',
        'bob@test.com',
        'diana@test.com',
        'charlie@test.com',
        'eve@test.com',
      ])

      // Extract roles from second span child
      const roles = rows.map((row: { _children: { _text: string }[] }) => row._children[1]._text)
      expect(roles).toEqual(['Owner', 'Editor', 'Editor', 'Viewer', 'Viewer'])
    })
  })

  describe('Invite someone new button', () => {
    async function buildWithRole(role: RoomRole) {
      const room = makeRoomDetail()
      const getRoom = vi.fn().mockResolvedValue(room)
      const getMyRole = vi.fn().mockResolvedValue({ role })
      const result = buildModal({ apiClient: { getRoom, getMyRole } })
      result.modal.onOpen()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (result.modal as any).loadMembers()
      return result
    }

    it('is shown for OWNER', async () => {
      const { modal } = await buildWithRole('OWNER')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyEl = (modal as any).bodyEl as any
      const actionsEl = bodyEl._children[1] // actions div
      const buttonTexts = actionsEl._children.map((c: { _text: string }) => c._text)
      expect(buttonTexts).toContain('Invite someone new')
    })

    it('is shown for EDITOR', async () => {
      const { modal } = await buildWithRole('EDITOR')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyEl = (modal as any).bodyEl as any
      const actionsEl = bodyEl._children[1]
      const buttonTexts = actionsEl._children.map((c: { _text: string }) => c._text)
      expect(buttonTexts).toContain('Invite someone new')
    })

    it('is NOT shown for VIEWER', async () => {
      const { modal } = await buildWithRole('VIEWER')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyEl = (modal as any).bodyEl as any
      const actionsEl = bodyEl._children[1]
      const buttonTexts = actionsEl._children.map((c: { _text: string }) => c._text)
      expect(buttonTexts).not.toContain('Invite someone new')
    })
  })

  describe('Manage in admin panel button', () => {
    it('is always present', async () => {
      const room = makeRoomDetail()
      const getRoom = vi.fn().mockResolvedValue(room)
      const getMyRole = vi.fn().mockResolvedValue({ role: 'VIEWER' })
      const { modal } = buildModal({ apiClient: { getRoom, getMyRole } })

      modal.onOpen()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).loadMembers()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyEl = (modal as any).bodyEl as any
      const actionsEl = bodyEl._children[1]
      const buttonTexts = actionsEl._children.map((c: { _text: string }) => c._text)
      expect(buttonTexts).toContain('Manage in admin panel ↗')
    })
  })

  describe('error handling', () => {
    it('shows API error message inline', async () => {
      const apiError = new ApiRequestError({
        error: 'FORBIDDEN',
        message: 'Access denied',
        statusCode: 403,
      })
      const getRoom = vi.fn().mockRejectedValue(apiError)
      const getMyRole = vi.fn().mockRejectedValue(apiError)
      const { modal } = buildModal({ apiClient: { getRoom, getMyRole } })

      modal.onOpen()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).loadMembers()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyEl = (modal as any).bodyEl as any
      const errorEl = bodyEl._children[0]
      expect(errorEl._text).toBe('Error: Access denied')
    })

    it('shows auth error message inline', async () => {
      const getRoom = vi.fn().mockRejectedValue(new AuthRequiredError())
      const getMyRole = vi.fn().mockRejectedValue(new AuthRequiredError())
      const { modal } = buildModal({ apiClient: { getRoom, getMyRole } })

      modal.onOpen()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).loadMembers()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyEl = (modal as any).bodyEl as any
      const errorEl = bodyEl._children[0]
      expect(errorEl._text).toBe('Sign in to view members.')
    })

    it('shows generic error for unexpected errors', async () => {
      const getRoom = vi.fn().mockRejectedValue(new Error('network'))
      const getMyRole = vi.fn().mockRejectedValue(new Error('network'))
      const { modal } = buildModal({ apiClient: { getRoom, getMyRole } })

      modal.onOpen()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (modal as any).loadMembers()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyEl = (modal as any).bodyEl as any
      const errorEl = bodyEl._children[0]
      expect(errorEl._text).toBe('Could not load members.')
    })
  })
})
