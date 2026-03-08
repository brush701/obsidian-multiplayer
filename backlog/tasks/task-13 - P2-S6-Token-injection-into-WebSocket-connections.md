---
id: TASK-13
title: '[P2-S6] Token injection into WebSocket connections'
status: Done
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-08 22:30'
labels:
  - enhancement
  - 'epic: P2 - Authentication'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/46'
  - >-
    https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
  - 'https://github.com/brush701/obsidian-multiplayer/pull/90'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** developer, **I want** the access token passed as a query parameter on WebSocket connections, **so that** the server can authenticate the connection.

Replace the `// TODO(P2): attach token` placeholders in `src/sharedTypes.ts` with actual token injection. Before connecting a `WebsocketProvider`, await `AuthManager.getAccessToken()`. If null, skip connection and show a notice. If valid, pass as `?token=` query param. Handle WebSocket close codes 4001 (Unauthorized), 4003 (Forbidden), and 4004 (Room not found) with appropriate user notices and cleanup.

**Dependencies:** P1-S4, P2-S1, P2-S4
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 WebsocketProvider is constructed with `?token=<accessToken>` in the URL (via `params` option)
- [ ] #2 If `getAccessToken()` returns `null`, `provider.connect()` is not called
- [ ] #3 If `getAccessToken()` returns `null`, a "Not signed in" notice is shown
- [ ] #4 A WS close with code 4001 triggers `signOut()` and shows a "Session expired" notice
- [ ] #5 A WS close with code 4003 removes the room from settings and shows an "Access denied" notice
- [ ] #6 A WS close with code 4004 removes the room from settings and shows a "no longer exists" notice
- [ ] #7 Token is refreshed before each new WebSocket connection (getAccessToken handles this internally)
- [ ] #8 On 4001/4003/4004 close codes, provider auto-reconnect is stopped (provider.disconnect())
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview

Two locations in `src/sharedTypes.ts` have `// TODO(P2): attach token` — the `SharedFolder` constructor (line 51) and the `SharedDoc` constructor (line 200). Both follow the same pattern: create provider with `{ connect: false }`, then manually connect. We need to make connection async and token-aware, and add close-code handling.

### Key Design Decisions

1. **Token via `params` option**: `y-websocket`'s `WebsocketProvider` accepts a `params` option (`Object<string,string>`) which gets encoded as query params on the URL (see `get url()` in y-websocket). We set `params: { token }` before calling `connect()`. This matches the API.md contract.

2. **Async connection**: Since `getAccessToken()` is async, we can't connect in the constructor. We'll add a private `_connectWithAuth()` async method to both classes that handles token acquisition and connection.

3. **Close code handling via `connection-close` event**: `WebsocketProvider` emits `'connection-close'` with `(CloseEvent, provider)`. We listen for this and check `event.code` for 4001/4003/4004. For these terminal codes, we call `provider.disconnect()` to prevent auto-reconnect (y-websocket has built-in exponential backoff reconnect).

4. **Room removal**: For 4003/4004, we need access to the plugin to remove from `settings.sharedFolders`, save settings, destroy the SharedFolder, and refresh icon styles. SharedFolder already has `this.plugin` reference. SharedDoc has `this._parent` (SharedFolder).

### Step-by-step

#### Step 1: Add async `_connectWithAuth()` to `SharedFolder`

In the `SharedFolder` constructor, replace:
```typescript
// TODO(P2): attach token
if (plugin.settings.serverUrl) {
  this._provider.connect()
}
```

With a call to `this._connectWithAuth()` and implement:
```typescript
private async _connectWithAuth(): Promise<void> {
  const token = await this.plugin.authManager.getAccessToken()
  if (!token) {
    new Notice('Not signed in — cannot connect to room.')
    return
  }
  this._provider.params = { token }
  this._provider.connect()
}
```

#### Step 2: Add async `_connectWithAuth()` to `SharedDoc`

Same pattern for SharedDoc. Since SharedDoc accesses plugin through `this._parent.plugin`, use that path.

#### Step 3: Add `connection-close` handler to `SharedFolder`

After creating the provider, register:
```typescript
this._provider.on('connection-close', (event: CloseEvent) => {
  this._handleCloseCode(event)
})
```

Implement `_handleCloseCode`:
- **4001**: Call `plugin.authManager.signOut()` (this already emits `auth-changed` which triggers main.ts to destroy all folders). Show `new Notice('Session expired — please sign in again.')`.
- **4003**: Show `new Notice('Access denied to [room name].')`. Call `this._removeFromSettings()`.
- **4004**: Show `new Notice("Room '[name]' no longer exists.")`. Call `this._removeFromSettings()`.

For all three: call `this._provider.disconnect()` to prevent reconnect.

#### Step 4: Add `_removeFromSettings()` helper to `SharedFolder`

```typescript
private _removeFromSettings(): void {
  this._provider.disconnect()
  const idx = this.plugin.settings.sharedFolders.indexOf(this.settings)
  if (idx !== -1) {
    this.plugin.settings.sharedFolders.splice(idx, 1)
  }
  this.plugin.sharedFolders = this.plugin.sharedFolders.filter(f => f !== this)
  this.destroy()
  this.plugin.saveSettings()
  this.plugin.refreshIconStyles()
}
```

#### Step 5: Add `connection-close` handler to `SharedDoc`

SharedDoc providers also need close handling. For 4001, delegate to parent. For 4003/4004, delegate to parent's `_removeFromSettings()` since the room-level action applies.

Actually, since SharedFolder already has a provider for the root doc AND creates SharedDocs for individual files, the close codes will fire on both. The simplest approach: handle close codes only on `SharedFolder._provider` (the room-level connection). SharedDoc providers will also get disconnected when `SharedFolder.destroy()` is called. However, to be safe, SharedDoc should also stop reconnecting on terminal close codes.

#### Step 6: Import `Notice` in sharedTypes.ts

Add `Notice` to imports from `obsidian` (currently not imported in sharedTypes.ts). Since sharedTypes.ts doesn't import from obsidian directly, we'll import `Notice` from it.

### Files Modified

- `src/sharedTypes.ts` — Primary changes (token injection, close handlers, room removal)
- No changes needed to `src/main.ts` or `src/auth.ts` — existing infrastructure is sufficient

### Risk Considerations

- **Race condition**: If token expires between `getAccessToken()` and WS handshake, server returns 4001 and we handle it gracefully.
- **Multiple 4001s**: If both SharedFolder and SharedDoc providers get 4001, `signOut()` is idempotent (second call is a no-op since `_isAuthenticated` is already false).
- **Reconnect suppression**: Must call `provider.disconnect()` (sets `shouldConnect = false`) before the exponential backoff timer fires `setupWS` again.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## API.md Reference

API.md §5 — WebSocket connection:

```typescript
new WebsocketProvider(
  `${serverUrl}/room/${guid}`,
  guid,
  ydoc,
  { params: { token: await auth.getAccessToken() } }
)
```

Close codes to handle:
- `4001` Unauthorized → clear tokens, show "Session expired" notice
- `4003` Forbidden → show "no access" notice, remove room from shared folders
- `4004` Room not found → show notice, remove room from shared folders

## y-websocket Provider API

- `params` property: `Object<string,string>` — gets encoded as query params in the URL via `get url()` getter
- Events: `'connection-close'` fires with `(CloseEvent, provider)` — the CloseEvent has `.code` property
- `provider.disconnect()` sets `shouldConnect = false`, preventing auto-reconnect
- Auto-reconnect: uses exponential backoff (100ms × 2^n, max 2500ms) — must be explicitly stopped for terminal errors

## Key Code Locations

- `src/sharedTypes.ts:49-54` — SharedFolder provider creation + TODO
- `src/sharedTypes.ts:197-203` — SharedDoc provider creation + TODO  
- `src/auth.ts:70-94` — `getAccessToken()` with refresh logic
- `src/auth.ts:186-199` — `signOut()` clears state + emits event
- `src/main.ts:52-59` — auth-changed listener destroys all folders on sign-out
- `src/main.ts:94-98` — SharedFolder creation from settings
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria pass manual verification
- [ ] #2 No TypeScript compilation errors (`npm run build`)
- [ ] #3 Existing tests pass (`npm run test`)
- [ ] #4 Code reviewed for security (token not logged, not persisted in URLs beyond connection)
<!-- DOD:END -->
