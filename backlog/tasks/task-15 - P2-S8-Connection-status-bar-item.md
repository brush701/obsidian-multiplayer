---
id: TASK-15
title: '[P2-S8] Connection status bar item'
status: In Progress
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-08 22:38'
labels:
  - enhancement
  - 'epic: P2 - Authentication'
dependencies:
  - TASK-13
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/48'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** user, **I want** a status bar item showing the current sync state, **so that** I can see at a glance whether the plugin is connected and healthy.

A status bar item is added in `main.ts` via `this.addStatusBarItem()`.

| Condition | Display text |
|---|---|
| Not signed in | `Multiplayer: not signed in` |
| Signed in, all providers connected and synced | `● Multiplayer` |
| Any provider syncing (initial state transfer in progress) | `⟳ Multiplayer` |
| Any provider disconnected / reconnecting (but not auth error) | `○ Multiplayer` |
| Auth error (after 4001 or refresh failure) | `⚠ Multiplayer: sign in again` |

- Clicking the status bar item in the "sign in again" state opens the settings tab.
- The status bar item is removed on plugin unload.

**Dependencies:** P2-S1, P2-S6

**Spec Reference:** `docs/epics/P2-authentication.md` — P2-S8
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A status bar item is present after plugin load.
- [ ] #2 Status bar displays "Multiplayer: not signed in" when `isAuthenticated` is `false`.
- [ ] #3 Status bar displays "● Multiplayer" when signed in and all providers report `connected = true` and `synced = true`.
- [ ] #4 Status bar displays "⟳ Multiplayer" when any provider has `synced = false` (initial sync in progress).
- [ ] #5 Status bar displays "○ Multiplayer" when any provider has `connected = false` (reconnecting) but there is no auth error.
- [ ] #6 Status bar displays "⚠ Multiplayer: sign in again" after a 4001 close or refresh failure.
- [ ] #7 Clicking the status bar item in the "sign in again" state opens the settings tab.
- [ ] #8 Status bar item is removed on plugin unload.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview

Add a reactive status bar item that aggregates auth state, WebSocket connection state, and sync state across all SharedFolder providers. The status bar uses existing event patterns (`auth-changed`, y-websocket `status`/`sync` events) — no polling needed.

### Step 1: Define connection state enum and aggregation logic

**File:** `src/types.ts`

Add a `ConnectionStatus` enum:
```
NotSignedIn | Connected | Syncing | Disconnected | AuthError
```

Add a helper function `aggregateConnectionStatus(isAuthenticated, hasAuthError, providers[])` that returns the correct status based on priority:
1. `!isAuthenticated && !hasAuthError` → `NotSignedIn`
2. `hasAuthError` → `AuthError`
3. Any provider `connected = false` → `Disconnected`
4. Any provider `synced = false` → `Syncing`
5. Otherwise → `Connected`

### Step 2: Add auth error tracking to AuthManager

**File:** `src/auth.ts`

Currently, on a 4001 or refresh failure, `signOut()` is called which sets `isAuthenticated = false`. We need to distinguish "not signed in" from "auth error (sign in again)".

- Add a `_hasAuthError: boolean` flag to `AuthManager`, exposed via `get hasAuthError()`.
- Set `_hasAuthError = true` before calling `signOut()` in the 4001/refresh-failure paths.
- Clear `_hasAuthError = false` on successful sign-in or explicit sign-out (user-initiated).
- The `'auth-changed'` event already fires — no new event type needed.

### Step 3: Expose provider status from SharedFolder

**File:** `src/sharedTypes.ts`

SharedFolder already has a y-websocket `WebsocketProvider`. We need to observe its state:

- Add `get wsConnected(): boolean` → delegates to `this._provider.wsconnected`
- Add `get synced(): boolean` → delegates to `this._provider.synced` (or `_synced`)
- Add `onStatusChange(callback)` / `offStatusChange(callback)` that wraps the provider's `'status'` and `'sync'` events into a single callback. This way the status bar doesn't need to know about y-websocket internals.

### Step 4: Create the status bar item

**File:** `src/main.ts`

In `setup()` (after auth and shared folders are initialized):

1. Create the status bar element: `this._statusBarEl = this.addStatusBarItem()`
2. Store a reference to the setting tab: `this._settingTab = settingTab` (already created on line 91)
3. Add click handler: on click, if state is `AuthError`, call `(this.app as any).setting.open()` then `(this.app as any).setting.openTabById(this.manifest.id)` to open the plugin's settings tab.
4. Call `this._updateStatusBar()` to set initial state.

### Step 5: Wire up reactive updates

**File:** `src/main.ts`

Create `_updateStatusBar()` method:
1. Compute `aggregateConnectionStatus(authManager.isAuthenticated, authManager.hasAuthError, sharedFolders)`
2. Map status to display text per the table in the description
3. Set `this._statusBarEl.setText(displayText)`

Wire event listeners:
- `authManager.on('auth-changed', () => this._updateStatusBar())` — already have a handler here, extend it
- When SharedFolders are created (in `setup()` and file event handlers), attach `onStatusChange` listeners that call `_updateStatusBar()`
- When SharedFolders are destroyed, detach listeners

### Step 6: Cleanup on unload

**File:** `src/main.ts`

In `onunload()`:
- The status bar item is automatically removed by Obsidian's `addStatusBarItem()` lifecycle (it's tied to the plugin), but verify this.
- Detach any remaining event listeners from providers.

### Key Design Decisions

- **No new file** — status bar logic lives in `main.ts` since it's a thin UI layer aggregating existing state. If it grows complex, extract to a `StatusBar` class later.
- **No polling** — purely event-driven via `auth-changed` and y-websocket `status`/`sync` events.
- **Priority-based aggregation** — AuthError > Disconnected > Syncing > Connected ensures the most important state is always shown.
- **Open settings via Obsidian internal API** — `(app as any).setting.open()` + `openTabById()` is the standard pattern used by community plugins since this API isn't in the public type defs.
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria pass manual testing
- [ ] #2 No lint errors introduced (`npm run lint`)
- [ ] #3 Code follows existing patterns in the codebase
- [ ] #4 Status bar updates reactively — no polling
<!-- DOD:END -->
