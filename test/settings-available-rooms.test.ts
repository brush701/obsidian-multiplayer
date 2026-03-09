// Suite: Available rooms in settings tab
// Scope: Unit
// Spec: TASK-23 — [P3-S8] Available rooms list in settings tab
// What this suite validates:
//   - Calls listRooms() when displayed and authenticated
//   - Excludes rooms already in settings.sharedFolders
//   - Shows "Sign in" message when not authenticated
//   - Shows "Loading rooms…" while loading
//   - Shows "Could not load rooms." on error
//   - Shows "No additional rooms available." when list is empty

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { App } from 'obsidian'
import { MultiplayerSettingTab } from '../src/main'
import { makeRoomListItem, makeSharedTypeSettings } from './factories'

// Mock SharedFolder constructor to avoid WebSocket startup
vi.mock('../src/sharedTypes', () => ({
  SharedFolder: class {
    settings: unknown
    constructor(settings: unknown) { this.settings = settings }
  },
}))

// ── Minimal mock DOM ──────────────────────────────────────────────────────────

interface MockEl {
  _tag: string
  _text: string
  _children: MockEl[]
  _removed: boolean
  empty(): void
  setText(text: string): void
  remove(): void
  createEl(tag: string, opts?: { text?: string; cls?: string }): MockEl
  createDiv(opts?: { cls?: string }): MockEl
}

function makeMockEl(tag = 'div'): MockEl {
  const children: MockEl[] = []
  const el: MockEl = {
    _tag: tag,
    _text: '',
    _children: children,
    _removed: false,
    empty() { children.length = 0; el._text = '' },
    setText(text: string) { el._text = text },
    remove() { el._removed = true },
    createEl(_tag: string, opts?: { text?: string; cls?: string }) {
      const child = makeMockEl(_tag)
      if (opts?.text) child._text = opts.text
      children.push(child)
      return child
    },
    createDiv(opts?: { cls?: string }) {
      return el.createEl('div', opts)
    },
  }
  return el
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlugin(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      serverUrl: 'https://example.com',
      username: '',
      sharedFolders: [] as { guid: string; name: string; path: string }[],
    },
    sharedFolders: [] as { settings: { guid: string; path: string } }[],
    apiClient: {
      listRooms: vi.fn().mockResolvedValue([]),
    },
    authManager: {
      isAuthenticated: true,
      userInfo: { email: 'test@example.com', name: 'Test' },
      hasAuthError: false,
      on: vi.fn(),
      off: vi.fn(),
    },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    addSharedFolder: vi.fn(),
    ...overrides,
  }
}

function buildTab(pluginOverrides: Record<string, unknown> = {}) {
  const plugin = makePlugin(pluginOverrides)
  const app = new App()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tab = new MultiplayerSettingTab(app as any, plugin as any)

  // Wire mock DOM — containerEl supports the Obsidian Setting tab DOM API
  const containerEl = makeMockEl()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(tab as any).containerEl = containerEl

  return { tab, plugin, containerEl }
}

/** The available rooms div is the second `div` child of containerEl. */
function getAvailableRoomsEl(containerEl: MockEl): MockEl {
  const divs = containerEl._children.filter(c => c._tag === 'div')
  return divs[1]
}

/** Recursively find all text values in the mock DOM tree. */
function allTexts(el: MockEl): string[] {
  const texts: string[] = []
  if (el._text) texts.push(el._text)
  for (const child of el._children) {
    texts.push(...allTexts(child))
  }
  return texts
}

describe('Available rooms in settings tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('unauthenticated state', () => {
    it('shows sign-in message when not authenticated', () => {
      const { tab, containerEl } = buildTab({
        authManager: {
          isAuthenticated: false,
          userInfo: null,
          hasAuthError: false,
          on: vi.fn(),
          off: vi.fn(),
        },
      })

      tab.display()

      const roomsEl = getAvailableRoomsEl(containerEl)
      const texts = allTexts(roomsEl)
      expect(texts).toContain('Available rooms')
      expect(texts).toContain('Sign in to see your available rooms.')
    })
  })

  describe('loading state', () => {
    it('shows "Loading rooms…" while listRooms is in flight', () => {
      const listRooms = vi.fn().mockReturnValue(new Promise(() => {}))
      const { tab, containerEl } = buildTab({
        apiClient: { listRooms },
      })

      tab.display()

      const roomsEl = getAvailableRoomsEl(containerEl)
      const texts = allTexts(roomsEl)
      expect(texts).toContain('Loading rooms…')
    })

    it('calls listRooms() when displayed and authenticated', () => {
      const listRooms = vi.fn().mockReturnValue(new Promise(() => {}))
      const { tab } = buildTab({ apiClient: { listRooms } })

      tab.display()

      expect(listRooms).toHaveBeenCalled()
    })

    it('does NOT call listRooms() when not authenticated', () => {
      const listRooms = vi.fn()
      const { tab } = buildTab({
        apiClient: { listRooms },
        authManager: {
          isAuthenticated: false,
          userInfo: null,
          hasAuthError: false,
          on: vi.fn(),
          off: vi.fn(),
        },
      })

      tab.display()

      expect(listRooms).not.toHaveBeenCalled()
    })
  })

  describe('error state', () => {
    it('shows error message on API failure', async () => {
      const listRooms = vi.fn().mockRejectedValue(new Error('network'))
      const { tab, containerEl } = buildTab({ apiClient: { listRooms } })

      tab.display()

      await vi.waitFor(() => {
        const roomsEl = getAvailableRoomsEl(containerEl)
        const texts = allTexts(roomsEl)
        expect(texts).toContain('Could not load rooms.')
      })
    })
  })

  describe('empty state', () => {
    it('shows empty message when no rooms available', async () => {
      const listRooms = vi.fn().mockResolvedValue([])
      const { tab, containerEl } = buildTab({ apiClient: { listRooms } })

      tab.display()

      await vi.waitFor(() => {
        const roomsEl = getAvailableRoomsEl(containerEl)
        const texts = allTexts(roomsEl)
        expect(texts).toContain('No additional rooms available.')
      })
    })
  })

  describe('filtering', () => {
    it('excludes rooms already in settings.sharedFolders', async () => {
      const rooms = [
        makeRoomListItem({ guid: 'room-1', name: 'Room One' }),
        makeRoomListItem({ guid: 'room-2', name: 'Room Two' }),
        makeRoomListItem({ guid: 'room-3', name: 'Room Three' }),
      ]
      const listRooms = vi.fn().mockResolvedValue(rooms)
      const { tab, containerEl } = buildTab({
        apiClient: { listRooms },
        settings: {
          serverUrl: 'https://example.com',
          username: '',
          sharedFolders: [makeSharedTypeSettings({ guid: 'room-2' })],
        },
      })

      tab.display()

      await vi.waitFor(() => {
        const roomsEl = getAvailableRoomsEl(containerEl)
        const loadingP = roomsEl._children.find(c => c._text === 'Loading rooms…')
        expect(loadingP?._removed ?? false).toBe(true)
      })

      const roomsEl = getAvailableRoomsEl(containerEl)
      const texts = allTexts(roomsEl)
      expect(texts).not.toContain('No additional rooms available.')
    })

    it('shows empty message when all rooms are already added', async () => {
      const rooms = [makeRoomListItem({ guid: 'room-1' })]
      const listRooms = vi.fn().mockResolvedValue(rooms)
      const { tab, containerEl } = buildTab({
        apiClient: { listRooms },
        settings: {
          serverUrl: 'https://example.com',
          username: '',
          sharedFolders: [makeSharedTypeSettings({ guid: 'room-1' })],
        },
      })

      tab.display()

      await vi.waitFor(() => {
        const roomsEl = getAvailableRoomsEl(containerEl)
        const texts = allTexts(roomsEl)
        expect(texts).toContain('No additional rooms available.')
      })
    })
  })

  describe('auth listener', () => {
    it('registers auth-changed listener on display()', () => {
      const onFn = vi.fn()
      const { tab } = buildTab({
        authManager: {
          isAuthenticated: true,
          userInfo: { email: 'test@example.com', name: 'Test' },
          hasAuthError: false,
          on: onFn,
          off: vi.fn(),
        },
      })

      tab.display()

      expect(onFn).toHaveBeenCalledWith('auth-changed', expect.any(Function))
    })

    it('unregisters auth-changed listener on hide()', () => {
      const offFn = vi.fn()
      const { tab } = buildTab({
        authManager: {
          isAuthenticated: true,
          userInfo: { email: 'test@example.com', name: 'Test' },
          hasAuthError: false,
          on: vi.fn(),
          off: offFn,
        },
      })

      tab.display()
      tab.hide()

      expect(offFn).toHaveBeenCalledWith('auth-changed', expect.any(Function))
    })
  })
})
