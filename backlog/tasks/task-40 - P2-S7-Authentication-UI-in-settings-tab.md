---
id: TASK-40
title: '[P2-S7] Authentication UI in settings tab'
status: Done
assignee: []
created_date: '2026-03-08 21:23'
updated_date: '2026-03-09 04:49'
labels:
  - enhancement
  - 'epic: P2 - Authentication'
dependencies:
  - TASK-8
  - TASK-9
  - TASK-12
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/47'
  - 'https://github.com/brush701/obsidian-multiplayer/pull/89'
priority: medium
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** user, **I want** the settings tab to show my sign-in status and provide sign-in/out controls, **so that** I can manage my session without leaving Obsidian.\n\n## Requirements\n\n**Server section:**\n```\nServer URL   [______________________________]\n             (e.g. https://multiplayer.company.com)\n```\n\n**Auth section (shown below server URL):**\n\nWhen `isAuthenticated` is `true`:\n```\n● Signed in as alice@company.com     [Sign Out]\n```\n\nWhen `isAuthenticated` is `false`:\n```\n○ Not signed in                      [Sign In]\n```\n\n- The section re-renders whenever `'auth-changed'` fires.\n- \"Sign In\" is disabled if `settings.serverUrl` is empty.\n- While sign-in is in progress, the button shows \"Signing in…\" and is disabled.\n\n## Notes\n- TASK-12 already added a conditional Sign Out button — this task replaces that with the full two-state auth UI\n- Requires a running server to test the full sign-in flow (OAuth PKCE)\n\n**Dependencies:** P2-S1 (TASK-8), P2-S2 (TASK-9), P2-S5 (TASK-12)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Settings tab renders a "Server URL" text input whose value reflects `settings.serverUrl`.
- [x] #2 Changing the server URL input updates `settings.serverUrl` and saves settings.
- [x] #3 When `isAuthenticated` is `false`, the settings tab shows "Not signed in" and a "Sign In" button.
- [x] #4 When `isAuthenticated` is `true`, the settings tab shows "Signed in as {email}" and a "Sign Out" button.
- [x] #5 "Sign In" button is disabled when `settings.serverUrl` is empty.
- [x] #6 Clicking "Sign In" with a non-empty `serverUrl` calls `AuthManager.signIn()`.
- [x] #7 Clicking "Sign Out" calls `AuthManager.signOut()`.
- [x] #8 The auth section updates without requiring a settings tab close/reopen after sign-in or sign-out.
- [x] #9 While `signIn()` is pending, the button label is "Signing in…" and the button is disabled.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Step 1: Refactor settings tab to support reactive auth UI

**File:** `src/main.ts` — `MultiplayerSettingTab` class

1. Add instance properties to track UI state:
   - `private _authSectionEl: HTMLElement | null` — container for the auth section so it can be re-rendered independently
   - `private _authChangedHandler: (() => void) | null` — stored reference for cleanup
   - `private _signingIn: boolean = false` — tracks in-flight sign-in state

2. Override `hide()` (called when settings tab is closed) to unregister the `auth-changed` listener via `authManager.off()`.

3. In `display()`:
   - Keep the existing `containerEl.empty()` and heading.
   - **Move Server URL above Username** — add a `Setting` with a text input bound to `settings.serverUrl`. On change: update `settings.serverUrl`, save settings, and re-render the auth section (since button disabled state depends on serverUrl).
   - Keep the existing Username setting as-is.
   - Create a container div (`_authSectionEl`) for the auth section.
   - Call a new `renderAuthSection()` method to populate it.
   - Register an `auth-changed` listener that calls `renderAuthSection()` (store the handler for cleanup in `hide()`).

### Step 2: Implement `renderAuthSection()` 

**File:** `src/main.ts` — `MultiplayerSettingTab` class

This method clears `_authSectionEl` and renders one of two states:

**When `authManager.isAuthenticated === true`:**
- `Setting` with name `● Signed in as {email}` and a "Sign Out" button (`.setWarning()`)
- onClick: call `authManager.signOut()` (no need to manually re-render; the `auth-changed` listener handles it)

**When `authManager.isAuthenticated === false`:**
- `Setting` with name `○ Not signed in` and a "Sign In" button
- Button is **disabled** when `settings.serverUrl` is empty OR `_signingIn` is true
- Button text is `"Signing in…"` when `_signingIn` is true, otherwise `"Sign In"`
- onClick:
  1. Set `_signingIn = true`, re-render auth section
  2. `await authManager.signIn()` (wrapped in try/finally)
  3. In `finally`: set `_signingIn = false`, re-render auth section

### Step 3: Remove TASK-12's conditional sign-out block

**File:** `src/main.ts`

Delete the existing `if (this.plugin.authManager.isAuthenticated) { ... }` block (lines 245-258) since the new `renderAuthSection()` replaces it entirely.

### Step 4: Verify and test

- `npm run lint` — no lint errors in changed files
- `npm run build` — build succeeds
- Manual testing against running server:
  - Verify Server URL input persists
  - Verify "Not signed in" / "Sign In" shown when unauthenticated
  - Verify "Sign In" disabled when server URL empty
  - Verify "Signing in…" state during sign-in
  - Verify "Signed in as {email}" / "Sign Out" shown after sign-in
  - Verify sign-out returns to unauthenticated state
  - Verify auth section updates reactively without closing/reopening settings

### Key design decisions

- **Partial re-render via `_authSectionEl`**: Only the auth section re-renders on state changes, avoiding flicker and preserving focus in the Server URL / Username inputs.
- **`auth-changed` listener lifecycle**: Registered in `display()`, cleaned up in `hide()`, preventing memory leaks and stale references.
- **No new files**: All changes are contained within the existing `MultiplayerSettingTab` class in `src/main.ts`.
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria verified manually against a running server
- [x] #2 No lint errors in changed files
- [x] #3 Build succeeds (`npm run build`)
<!-- DOD:END -->
