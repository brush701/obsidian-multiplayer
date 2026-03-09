---
id: TASK-17
title: '[P3-S2] SharedFolderModal: Create tab'
status: Done
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-09 00:21'
labels:
  - enhancement
  - 'epic: P3 - Room Management'
dependencies:
  - TASK-16
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/50'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** user, **I want** to create a new shared room from a dialog in Obsidian, **so that** I can start collaborating on a folder without leaving the app.

`SharedFolderModal` is redesigned with two tabs: **Create** and **Join**. This task implements the Create tab.

**Create tab layout:**
```
Room name: [____________________________]
           (defaults to the folder's name if opened from a folder context menu)

           [ Create Room ]
```

**Behaviour:**
1. User enters a room name (required; non-empty).
2. Clicking "Create Room" calls `ApiClient.createRoom(name)`.
3. While in flight, the button is disabled and shows "Creating…".
4. On success: creates a new `SharedFolder` locally with the active folder path (or folder picker if not opened from context). Saves settings. Modal closes.
5. On `AuthRequiredError`: notice "Sign in first." Modal remains open.
6. On `ApiError`: notice "Could not create room: {message}." Modal remains open.
7. Room name input has focus when the modal opens.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SharedFolderModal renders a tab bar with "Create" and "Join" tabs.
- [ ] #2 Create tab shows a room name input and a "Create Room" button.
- [ ] #3 Room name input is pre-filled with the folder name when opened from a folder's context menu.
- [ ] #4 "Create Room" is disabled when the room name input is empty.
- [ ] #5 Clicking "Create Room" calls `ApiClient.createRoom(name)`.
- [ ] #6 While the request is in flight, the button is disabled and shows "Creating…".
- [ ] #7 On success, a new `SharedTypeSettings` entry is created with the returned `guid` and `name`, and the configured folder path.
- [ ] #8 On success, `plugin.settings.sharedFolders` contains the new entry and settings are saved.
- [ ] #9 On success, the modal closes.
- [ ] #10 On `AuthRequiredError`, a notice is shown and the modal remains open.
- [ ] #11 On `ApiError`, a notice is shown with the error message and the modal remains open.
- [ ] #12 The room name input has focus when the modal opens on the Create tab.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Step 1: Refactor `SharedFolderModal` to tab-based layout

**File:** `src/modals.ts`

- Replace the current single-form modal with a tab-based structure
- Add a tab bar at the top with two tabs: "Create" and "Join"
- Use Obsidian's `Setting` component for consistent UI styling
- The "Join" tab will be a placeholder (content stubbed for TASK-18)
- Track active tab state; default to "Create"
- Wire tab switching to show/hide the appropriate content container

### Step 2: Implement Create tab UI

**File:** `src/modals.ts`

- Add a room name text input using `Setting` component
- Pre-fill with `this.folderPath` basename if the modal was opened from a folder context menu
- Add "Create Room" button below the input
- Disable the button when room name is empty (use `onChange` listener)
- Store references to the button and input for state management

### Step 3: Implement Create tab logic

**File:** `src/modals.ts`

- On "Create Room" click:
  1. Set button text to "Creating…" and disable it
  2. Get `ApiClient` from plugin (via `this.plugin.apiClient`)
  3. Call `await apiClient.createRoom(roomName)`
  4. On success:
     - Build `SharedTypeSettings { guid: result.guid, name: result.name, path: folderPath }`
     - Push to `plugin.settings.sharedFolders`
     - Call `plugin.saveSettings()`
     - Instantiate `SharedFolder` for the new entry
     - Close the modal
  5. On `AuthRequiredError`:
     - `new Notice("Sign in first.")`
     - Re-enable button, restore text to "Create Room"
  6. On `ApiRequestError`:
     - `new Notice("Could not create room: " + error.message)`
     - Re-enable button, restore text to "Create Room"

### Step 4: Wire focus behavior

**File:** `src/modals.ts`

- In `onOpen()`, after rendering the Create tab, call `.focus()` on the room name input element
- Ensure focus is set on the correct input when switching to the Create tab

### Step 5: Update callers if needed

**File:** `src/main.ts`

- Review how `SharedFolderModal` is instantiated (context menu handler)
- Ensure `folderPath` is passed correctly for pre-filling the room name
- Verify `ApiClient` is accessible from the modal (via plugin reference)

### Key Files
- `src/modals.ts` — Main implementation (SharedFolderModal rewrite)
- `src/main.ts` — Caller updates if constructor signature changes
- `src/api.ts` — `TektiteApiClient.createRoom()` (already implemented)
- `src/sharedTypes.ts` — `SharedTypeSettings` interface (no changes expected)
- `src/types.ts` — API types (no changes expected)
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented SharedFolderModal with tab bar (Create/Join) and Create tab functionality. Merged via PR #93.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria pass manually
- [ ] #2 Code compiles with no TypeScript errors
- [ ] #3 No regressions in existing shared folder functionality
- [ ] #4 Error states (auth, API) handled gracefully with user-visible notices
<!-- DOD:END -->
