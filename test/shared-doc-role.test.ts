import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock system-boundary dependencies before importing
vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    once(_event: string, cb: () => void) { setTimeout(cb, 0) }
    destroy() {}
  },
}))

vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    awareness = {
      setLocalStateField: vi.fn(),
    }
    params: Record<string, string> = {}
    on = vi.fn()
    connect = vi.fn()
    disconnect = vi.fn()
    destroy = vi.fn()
    wsconnected = false
    synced = false
  },
}))

vi.mock('obsidian', () => ({
  Notice: class { constructor(_msg: string) {} },
}))

import { SharedDoc } from '../src/sharedTypes'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

// Helper to create a SharedDoc with a mock parent
function makeSharedDoc(role: import('../src/types').RoomRole | null = null) {
  const mockPlugin = {
    settings: { serverUrl: 'https://example.com', username: 'test-user' },
    authManager: { getAccessToken: vi.fn().mockResolvedValue('token-123') },
    apiClient: { getMyRole: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
  }
  const mockParent = {
    plugin: mockPlugin,
    settings: { guid: 'room-guid', path: 'shared/', name: 'Test Room' },
    docs: new Map(),
    cachedRole: role,
  }

  const doc = new SharedDoc('shared/test.md', 'doc-guid', mockParent as any)
  if (role !== null) doc.setRole(role)
  return { doc, mockParent }
}

// Mock EditorView that tracks dispatch calls
function makeMockEditorView(): EditorView & { dispatched: any[] } {
  const dispatched: any[] = []
  return {
    dispatch: vi.fn((...args: any[]) => dispatched.push(...args)),
    dispatched,
    state: { readOnly: false },
  } as any
}

describe('SharedDoc role-based read-only', () => {
  describe('role property', () => {
    it('defaults to null', () => {
      const { doc } = makeSharedDoc()
      expect(doc.role).toBeNull()
    })

    it('can be set to VIEWER', () => {
      const { doc } = makeSharedDoc()
      doc.setRole('VIEWER')
      expect(doc.role).toBe('VIEWER')
    })

    it('can be set to EDITOR', () => {
      const { doc } = makeSharedDoc()
      doc.setRole('EDITOR')
      expect(doc.role).toBe('EDITOR')
    })

    it('can be set to OWNER', () => {
      const { doc } = makeSharedDoc()
      doc.setRole('OWNER')
      expect(doc.role).toBe('OWNER')
    })
  })

  describe('binding with VIEWER role', () => {
    it('produces an extension array', () => {
      const { doc } = makeSharedDoc('VIEWER')
      const binding = doc.binding
      expect(Array.isArray(binding)).toBe(true)
    })

    it('includes readOnly facet set to true', () => {
      const { doc } = makeSharedDoc('VIEWER')
      const binding = doc.binding as any[]
      const state = EditorState.create({ extensions: binding })
      expect(state.readOnly).toBe(true)
    })

    it('includes three extensions: yCollab, readOnly compartment, panel compartment', () => {
      const { doc } = makeSharedDoc('VIEWER')
      const binding = doc.binding as any[]
      expect(binding.length).toBe(3)
    })
  })

  describe('binding with EDITOR role', () => {
    it('is not read-only', () => {
      const { doc } = makeSharedDoc('EDITOR')
      const binding = doc.binding as any[]
      const state = EditorState.create({ extensions: binding })
      expect(state.readOnly).toBe(false)
    })
  })

  describe('binding with OWNER role', () => {
    it('is not read-only', () => {
      const { doc } = makeSharedDoc('OWNER')
      const binding = doc.binding as any[]
      const state = EditorState.create({ extensions: binding })
      expect(state.readOnly).toBe(false)
    })
  })

  describe('binding with null role (unknown)', () => {
    it('defaults to read-write', () => {
      const { doc } = makeSharedDoc(null)
      const binding = doc.binding as any[]
      const state = EditorState.create({ extensions: binding })
      expect(state.readOnly).toBe(false)
    })
  })

  describe('dynamic role transition via setRole', () => {
    it('dispatches reconfigure effects when role changes with an EditorView', () => {
      const { doc } = makeSharedDoc(null)
      doc.binding // initialize binding

      const mockView = makeMockEditorView()
      doc.setEditorView(mockView as any)

      doc.setRole('VIEWER')

      expect(mockView.dispatch).toHaveBeenCalledOnce()
      const call = (mockView.dispatch as any).mock.calls[0][0]
      expect(call.effects).toBeDefined()
      expect(call.effects.length).toBe(2) // readOnly + panel reconfigure
      expect(doc.role).toBe('VIEWER')
    })

    it('dispatches when transitioning from VIEWER to EDITOR', () => {
      const { doc } = makeSharedDoc('VIEWER')
      doc.binding

      const mockView = makeMockEditorView()
      doc.setEditorView(mockView as any)

      doc.setRole('EDITOR')

      expect(mockView.dispatch).toHaveBeenCalledOnce()
      expect(doc.role).toBe('EDITOR')
    })

    it('does not dispatch when role is unchanged', () => {
      const { doc } = makeSharedDoc('EDITOR')
      doc.binding

      const mockView = makeMockEditorView()
      doc.setEditorView(mockView as any)

      doc.setRole('EDITOR') // same role
      expect(mockView.dispatch).not.toHaveBeenCalled()
    })

    it('does not dispatch without an EditorView', () => {
      const { doc } = makeSharedDoc(null)
      doc.binding

      // No setEditorView call — should not throw
      expect(() => doc.setRole('VIEWER')).not.toThrow()
      expect(doc.role).toBe('VIEWER')
    })

    it('does not dispatch when binding has not been created', () => {
      const { doc } = makeSharedDoc(null)
      // Don't access doc.binding

      const mockView = makeMockEditorView()
      doc.setEditorView(mockView as any)

      doc.setRole('VIEWER')
      expect(mockView.dispatch).not.toHaveBeenCalled()
      expect(doc.role).toBe('VIEWER')
    })
  })
})
