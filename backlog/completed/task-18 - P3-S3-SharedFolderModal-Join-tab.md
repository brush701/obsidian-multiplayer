---
id: TASK-18
title: '[P3-S3] SharedFolderModal: Join tab'
status: Done
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-09 00:21'
labels:
  - enhancement
  - 'epic: P3 - Room Management'
dependencies:
  - TASK-16
  - TASK-17
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/51'
  - 'https://github.com/brush701/obsidian-multiplayer/pull/94'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** user, **I want** to join a room by pasting an invite link or token in the SharedFolderModal's Join tab, **so that** I can collaborate without needing the plugin to handle a deep link automatically.

**Join tab layout:**
```
Invite link or code: [____________________________]

                     [ Join Room ]
```

**Behaviour:**
1. User pastes an invite link (e.g. `https://server/join?token=<uuid>`) or a raw token UUID.
2. The plugin extracts the token: if the input is a URL, it parses the `token` query parameter; otherwise it uses the raw input string.
3. Clicking "Join Room" calls `ApiClient.joinRoom(token)`.
4. While in flight, button is disabled and shows "Joining…".
5. On success: creates a `SharedFolder` using the returned `guid`/`name` and `this.folder.path`. Saves settings. Modal closes.
6. On `AuthRequiredError`: notice "Sign in first." Modal remains open.
7. On `ApiError` with status 404 or 410: notice "Invite link is invalid or has expired."
8. On other `ApiError`: notice "Could not join room: {message}."

**Dependencies:** P3-S1 (ApiClient), P3-S2 (tab bar)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Join tab shows an invite link input and a "Join Room" button.
- [x] #2 Given input `https://server/join?token=abc-123`, the token extracted and sent is `abc-123`.
- [x] #3 Given input `abc-123` (no URL), the token sent is `abc-123`.
- [x] #4 "Join Room" is disabled when the input is empty.
- [x] #5 Clicking "Join Room" calls `ApiClient.joinRoom(token)`.
- [x] #6 While the request is in flight, the button is disabled and shows "Joining…".
- [x] #7 On success, a `SharedTypeSettings` entry is created with the returned `guid`, `name`, and `this.folder.path`.
- [x] #8 On success, the modal closes.
- [x] #9 On `AuthRequiredError`, a notice "Sign in first." is shown and the modal remains open.
- [x] #10 On a 404 or 410 `ApiRequestError`, the "Invite link is invalid or has expired." notice is shown and the modal remains open.
- [x] #11 On another `ApiRequestError`, a generic "Could not join room: {message}" notice is shown and the modal remains open.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview
Replace the Join tab placeholder in `src/modals.ts` with a functional join-by-invite-token form. The pattern closely mirrors the existing Create tab, with the addition of token extraction logic.

### Step 1: Add private fields for Join tab state
**File:** `src/modals.ts`
- Add fields: `inviteInput: HTMLInputElement`, `joinBtn: HTMLButtonElement`, `_joining: boolean`
- These mirror the Create tab's `roomNameInput`, `createBtn`, `_creating`

### Step 2: Implement `extractToken(input: string): string` helper
**File:** `src/modals.ts` (private method on `SharedFolderModal`)
- If input looks like a URL (contains `://`), parse it with `new URL(input)` and return `searchParams.get('token')` (or empty string if missing)
- Otherwise, return `input.trim()`
- Keep it simple — no external dependencies

### Step 3: Implement `renderJoinTab()`
**File:** `src/modals.ts` — replace the placeholder in the existing method
- Layout:
  1. Label: "Invite link or code"
  2. `<input type="text" placeholder="Paste an invite link or code">`
  3. Button container with "Join Room" button (`mod-cta` class)
- Wire `input` event listener → `updateJoinBtnState()`
- Wire click handler → `handleJoin()`

### Step 4: Implement `updateJoinBtnState()`
**File:** `src/modals.ts`
- Disable button when `extractToken(this.inviteInput.value)` is empty

### Step 5: Implement `handleJoin()`
**File:** `src/modals.ts`
- Guard: return early if token is empty or `_joining` is true
- Set `_joining = true`, disable button, set text to "Joining…"
- Call `this.plugin.apiClient.joinRoom(token)`
- **On success:**
  - Build `SharedTypeSettings` with `{ guid: result.guid, name: result.name, path: this.folder.path }`
  - Push to `plugin.settings.sharedFolders`, call `saveSettings()`
  - Create `SharedFolder` instance, call `plugin.addSharedFolder()`
  - `this.close()`
- **On error:**
  - `AuthRequiredError` → `new Notice('Sign in first.')`
  - `ApiRequestError` with `statusCode` 404 or 410 → `new Notice('Invite link is invalid or has expired.')`
  - Other `ApiRequestError` → `new Notice('Could not join room: ${e.message}')`
  - Other → `new Notice('Could not join room: unexpected error.')`
  - Reset `_joining`, button text, button disabled state

### Step 6: Update `switchTab()` to focus invite input
**File:** `src/modals.ts`
- In the `join` branch of `switchTab()`, call `this.inviteInput.focus()`

### Step 7: Unit tests
**File:** `test/modals.test.ts`
- Add a new `describe('SharedFolderModal — Join tab')` block
- Extend `buildModal()` to also wire join tab fields (`inviteInput`, `joinBtn`)
- Extend `makePlugin()` to include `joinRoom` mock on `apiClient`
- Tests:
  1. **Token extraction — URL input:** sets input to `https://server/join?token=abc-123`, calls `handleJoin`, asserts `joinRoom` called with `abc-123`
  2. **Token extraction — raw input:** sets input to `abc-123`, calls `handleJoin`, asserts `joinRoom` called with `abc-123`
  3. **Success path:** asserts settings saved, `addSharedFolder` called, modal closed
  4. **AuthRequiredError:** asserts notice "Sign in first.", modal NOT closed
  5. **404 ApiRequestError:** asserts notice "Invite link is invalid or has expired."
  6. **410 ApiRequestError:** same notice as 404
  7. **Other ApiRequestError:** asserts notice "Could not join room: {message}"
  8. **Double-click guard:** two concurrent calls → only one `joinRoom` invocation
  9. **Empty input guard:** empty input → `joinRoom` not called

### Files Changed
| File | Change |
|---|---|
| `src/modals.ts` | Add join tab fields, `extractToken()`, `renderJoinTab()`, `updateJoinBtnState()`, `handleJoin()`, update `switchTab()` |
| `test/modals.test.ts` | Add Join tab test suite |

### Design Decisions
- **No folder picker:** The modal already receives `this.folder` from the right-click context. The Join tab will use this folder path directly, matching the Create tab pattern. The GH issue mentions a folder picker, but since the modal is always opened with a folder context, adding a picker would be unnecessary complexity. If a folder picker is needed later (e.g., for a standalone join flow), it can be added as a follow-up.
- **Token extraction is a private method** (not a standalone util) since it's only used here. Can be extracted later if reused by the protocol handler (TASK-19).
- **Error handling mirrors Create tab** for consistency, with the addition of 404/410 special-casing per the spec.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Join tab in SharedFolderModal with invite link/token parsing. Merged via PR #94.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Implementation matches all acceptance criteria
- [x] #2 Unit tests cover: success path, token extraction (URL and raw), AuthRequiredError, 404/410 ApiRequestError, other ApiRequestError, double-click guard, empty input guard
- [x] #3 All existing tests pass (`npm test`)
- [x] #4 Build succeeds (`npm run build`)
- [ ] #5 Code reviewed via PR
<!-- DOD:END -->
