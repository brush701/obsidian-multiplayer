// Suite: Protocol handler — obsidian://multiplayer/join
// Scope: Unit
// Spec: TASK-19 — [P3-S4] Protocol handler: auto-join from browser
// What this suite validates:
//   - Missing guid/name shows invalid invite notice
//   - Not authenticated shows "Sign in first." notice
//   - Missing serverUrl shows configure notice
//   - Server mismatch shows notice
//   - Duplicate room guid shows "already in this room" notice
//   - Folder overlap (both directions) shows notice
//   - Success path: creates settings, saves, adds SharedFolder, shows notice
//   - Error in callback is caught gracefully

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { App, TFolder } from 'obsidian'

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

// Mock FolderSelectModal to capture onSelect callback
let capturedOnSelect: ((folder: TFolder) => void) | null = null
vi.mock('../src/modals', () => ({
  SharedFolderModal: class {},
  UnshareFolderModal: class {},
  InviteModal: class {},
  FolderSelectModal: class {
    constructor(_app: unknown, onSelect: (folder: TFolder) => void) {
      capturedOnSelect = onSelect
    }
    open() {}
  },
}))

// Build a minimal plugin-like object with _handleJoinProtocol
async function loadHandler() {
  const mod = await import('../src/main')
  const PluginClass = mod.default
  const app = new App()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugin = new PluginClass(app as any, { id: 'multiplayer', name: 'Multiplayer', version: '0.1.0' })
  plugin.settings = { sharedFolders: [], serverUrl: 'https://example.com', username: '' }
  plugin.sharedFolders = []
  plugin.authManager = {
    isAuthenticated: true,
    hasAuthError: false,
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  }
  plugin.apiClient = {}
  plugin.addSharedFolder = vi.fn()
  plugin.saveSettings = vi.fn().mockResolvedValue(undefined)
  plugin.refreshIconStyles = vi.fn()
  return plugin
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (plugin: any, params: Record<string, string>) =>
  plugin._handleJoinProtocol(params)

describe('Protocol handler — obsidian://multiplayer/join', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notices.length = 0
    capturedOnSelect = null
  })

  it('shows invalid invite notice when guid is missing', async () => {
    const plugin = await loadHandler()
    call(plugin, { action: 'multiplayer/join', name: 'Room' })

    expect(notices).toContain('Invalid invite link: missing room information.')
  })

  it('shows invalid invite notice when name is missing', async () => {
    const plugin = await loadHandler()
    call(plugin, { action: 'multiplayer/join', guid: 'abc-123' })

    expect(notices).toContain('Invalid invite link: missing room information.')
  })

  it('shows "Sign in first." when not authenticated', async () => {
    const plugin = await loadHandler()
    plugin.authManager.isAuthenticated = false

    call(plugin, { action: 'multiplayer/join', guid: 'abc', name: 'Room' })

    expect(notices).toContain('Sign in first.')
  })

  it('shows configure notice when serverUrl is empty', async () => {
    const plugin = await loadHandler()
    plugin.settings.serverUrl = ''

    call(plugin, { action: 'multiplayer/join', guid: 'abc', name: 'Room' })

    expect(notices).toContain('Configure a server URL in settings first.')
  })

  it('shows server mismatch notice when server param differs', async () => {
    const plugin = await loadHandler()

    call(plugin, { action: 'multiplayer/join', guid: 'abc', name: 'Room', server: 'https://other-server.com' })

    expect(notices).toContain('This invite is for a different server.')
  })

  it('allows matching server with trailing slash differences', async () => {
    const plugin = await loadHandler()
    plugin.settings.serverUrl = 'https://example.com/'

    call(plugin, { action: 'multiplayer/join', guid: 'room-1', name: 'Room', server: 'https://example.com' })

    expect(notices).not.toContain('This invite is for a different server.')
    expect(capturedOnSelect).toBeTruthy()
  })

  it('proceeds without server param (optional)', async () => {
    const plugin = await loadHandler()

    call(plugin, { action: 'multiplayer/join', guid: 'room-1', name: 'Room' })

    expect(capturedOnSelect).toBeTruthy()
  })

  it('shows "already in this room" when guid is duplicate', async () => {
    const plugin = await loadHandler()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugin.sharedFolders = [{ settings: { guid: 'abc', name: 'Room', path: 'folder' } }] as any[]

    call(plugin, { action: 'multiplayer/join', guid: 'abc', name: 'Room' })

    expect(notices).toContain('You are already in this room.')
  })

  it('shows notice when selected folder is inside an existing shared folder', async () => {
    const plugin = await loadHandler()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugin.sharedFolders = [{ settings: { guid: 'other', name: 'Other', path: 'parent' } }] as any[]

    call(plugin, { action: 'multiplayer/join', guid: 'room-1', name: 'My Room' })

    const folder = new TFolder('parent/child')
    await capturedOnSelect!(folder)

    expect(notices).toContain('This folder is already a shared folder.')
    expect(plugin.saveSettings).not.toHaveBeenCalled()
  })

  it('shows notice when existing shared folder is inside selected folder', async () => {
    const plugin = await loadHandler()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugin.sharedFolders = [{ settings: { guid: 'other', name: 'Other', path: 'parent/child' } }] as any[]

    call(plugin, { action: 'multiplayer/join', guid: 'room-1', name: 'My Room' })

    const folder = new TFolder('parent')
    await capturedOnSelect!(folder)

    expect(notices).toContain('This folder is already a shared folder.')
    expect(plugin.saveSettings).not.toHaveBeenCalled()
  })

  it('creates SharedFolder on successful folder selection', async () => {
    const plugin = await loadHandler()

    call(plugin, { action: 'multiplayer/join', guid: 'room-1', name: 'My Room' })

    const folder = new TFolder('new-folder')
    await capturedOnSelect!(folder)

    expect(plugin.settings.sharedFolders).toHaveLength(1)
    expect(plugin.settings.sharedFolders[0]).toMatchObject({
      guid: 'room-1',
      name: 'My Room',
      path: 'new-folder',
    })
    expect(plugin.saveSettings).toHaveBeenCalled()
    expect(plugin.addSharedFolder).toHaveBeenCalled()
    expect(notices).toContain('Joined room "My Room".')
  })

  it('catches errors in the callback gracefully', async () => {
    const plugin = await loadHandler()
    plugin.saveSettings = vi.fn().mockRejectedValue(new Error('disk full'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    call(plugin, { action: 'multiplayer/join', guid: 'room-1', name: 'My Room' })

    const folder = new TFolder('new-folder')
    await capturedOnSelect!(folder)

    expect(notices).toContain('Could not join room: unexpected error.')
    consoleSpy.mockRestore()
  })
})
