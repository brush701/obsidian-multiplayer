---
id: TASK-7
title: '[P1-S5] Remove context menu legacy items'
status: Done
assignee: []
created_date: '2026-03-08 16:26'
updated_date: '2026-03-08 18:33'
labels:
  - enhancement
  - 'epic: P1 - Transport Migration'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/40'
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** user, **I want** the "Copy GUID" and "Copy Password" context menu items removed, **so that** the menu only contains actions that are meaningful in the new single-server-per-vault model.

## Requirements

- "Copy GUID" is removed from the shared folder right-click context menu.
- "Copy Password" is removed from the shared folder right-click context menu (if present).
- No other context menu items are removed or reordered by this story (changes to "Invite" and "Members" items are P3).

## Spec Reference

`docs/epics/P1-transport-migration.md` — P1-S5
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Right-clicking a shared folder in the file explorer does not show "Copy GUID".
- [x] #2 Right-clicking a shared folder in the file explorer does not show "Copy Password".
- [x] #3 All other existing context menu items remain present and functional.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Analysis

The context menu is registered in `src/main.ts:45-80` inside a `file-menu` workspace event handler. Currently for shared folders it adds:
1. **"Delete Multiplayer Shared Folder"** (lines 51-56) — KEEP
2. **"Copy GUID"** (lines 58-64) — REMOVE

"Copy Password" does not exist in the current codebase, so that acceptance criterion is already satisfied.

### Steps

1. **Remove the "Copy GUID" `menu.addItem` block** in `src/main.ts` (lines 58-64)
   - Delete the entire `menu.addItem` call that sets title "Copy GUID"
   - This is a self-contained block with no side effects on surrounding code

2. **Verify no other references to Copy GUID/Password exist**
   - Search for any related strings, constants, or helper functions that can be cleaned up

3. **Build and verify**
   - Run `npm run build` to confirm no compile errors
   - Manually verify the remaining menu items are unaffected

### Risk Assessment

- **Low risk**: This is a pure deletion of a self-contained UI element with no dependencies
- **No migration needed**: The GUID is still stored in settings for internal use; we're only removing the user-facing copy action
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 "Copy GUID" menu item removed from `src/main.ts` file-menu handler
- [x] #2 "Copy Password" menu item removed if present in codebase
- [x] #3 Existing context menu items ("Delete Multiplayer Shared Folder", "New Multiplayer Shared Folder") unchanged
- [x] #4 Plugin builds without errors
- [x] #5 Manual smoke test: right-click shared folder confirms legacy items are gone
<!-- DOD:END -->
