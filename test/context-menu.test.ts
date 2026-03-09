import { describe, it, expect, vi } from 'vitest'
import type { RoomRole } from '../src/types'

/**
 * The file-menu handler in main.ts builds context menu items for shared folders.
 * We extract the menu-building logic here so we can test role-gating without
 * needing to instantiate the full Obsidian plugin.
 *
 * This mirrors the structure in main.ts lines ~82-127.
 */

interface MenuItem {
  title: string
  icon: string
  onClick: () => void
}

interface MenuStub {
  items: MenuItem[]
  separators: number[]
  addItem(cb: (item: MenuItemBuilder) => void): void
  addSeparator(): void
}

interface MenuItemBuilder {
  setTitle(t: string): MenuItemBuilder
  setIcon(i: string): MenuItemBuilder
  onClick(cb: () => void): MenuItemBuilder
}

function createMenuStub(): MenuStub {
  const items: MenuItem[] = []
  const separators: number[] = []
  return {
    items,
    separators,
    addItem(cb) {
      const entry: MenuItem = { title: '', icon: '', onClick: () => {} }
      const builder: MenuItemBuilder = {
        setTitle(t) { entry.title = t; return builder },
        setIcon(i) { entry.icon = i; return builder },
        onClick(fn) { entry.onClick = fn; return builder },
      }
      cb(builder)
      items.push(entry)
    },
    addSeparator() {
      separators.push(items.length)
    },
  }
}

/**
 * Reproduces the menu-building logic from main.ts for a shared folder.
 */
function buildSharedFolderMenu(
  menu: MenuStub,
  folderName: string,
  cachedRole: RoomRole | null,
) {
  // "Delete Multiplayer Shared Folder"
  menu.addItem((item) => {
    item.setTitle('Delete Multiplayer Shared Folder')
      .setIcon('dot-network')
      .onClick(() => {})
  })

  menu.addSeparator()

  // "Invite to [Room Name]" — hidden for VIEWER
  if (cachedRole !== 'VIEWER') {
    menu.addItem((item) => {
      item.setTitle(`Invite to ${folderName || 'Room'}`)
        .setIcon('user-plus')
        .onClick(() => {})
    })
  }

  // "Room members"
  menu.addItem((item) => {
    item.setTitle('Room members')
      .setIcon('users')
      .onClick(() => {})
  })
}

describe('shared folder context menu', () => {
  it('shows all items when role is OWNER', () => {
    const menu = createMenuStub()
    buildSharedFolderMenu(menu, 'My Room', 'OWNER')

    const titles = menu.items.map((i) => i.title)
    expect(titles).toEqual([
      'Delete Multiplayer Shared Folder',
      'Invite to My Room',
      'Room members',
    ])
  })

  it('shows all items when role is EDITOR', () => {
    const menu = createMenuStub()
    buildSharedFolderMenu(menu, 'My Room', 'EDITOR')

    const titles = menu.items.map((i) => i.title)
    expect(titles).toEqual([
      'Delete Multiplayer Shared Folder',
      'Invite to My Room',
      'Room members',
    ])
  })

  it('hides Invite when role is VIEWER', () => {
    const menu = createMenuStub()
    buildSharedFolderMenu(menu, 'My Room', 'VIEWER')

    const titles = menu.items.map((i) => i.title)
    expect(titles).toEqual([
      'Delete Multiplayer Shared Folder',
      'Room members',
    ])
    expect(titles).not.toContain('Invite to My Room')
  })

  it('shows all items when role is null (not yet fetched)', () => {
    const menu = createMenuStub()
    buildSharedFolderMenu(menu, 'My Room', null)

    const titles = menu.items.map((i) => i.title)
    expect(titles).toEqual([
      'Delete Multiplayer Shared Folder',
      'Invite to My Room',
      'Room members',
    ])
  })

  it('uses "Room" as fallback when folder name is empty', () => {
    const menu = createMenuStub()
    buildSharedFolderMenu(menu, '', 'OWNER')

    const titles = menu.items.map((i) => i.title)
    expect(titles).toContain('Invite to Room')
  })

  it('adds a separator after Delete', () => {
    const menu = createMenuStub()
    buildSharedFolderMenu(menu, 'My Room', 'OWNER')

    // Separator should be at index 1 (after the first item)
    expect(menu.separators).toEqual([1])
  })

  it('does not include Copy GUID or Copy Password', () => {
    const menu = createMenuStub()
    buildSharedFolderMenu(menu, 'My Room', 'OWNER')

    const titles = menu.items.map((i) => i.title)
    expect(titles).not.toContain('Copy GUID')
    expect(titles).not.toContain('Copy Password')
  })
})
