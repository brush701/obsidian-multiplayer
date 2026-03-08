---
id: TASK-6
title: '[P1-S4] Integrate y-websocket provider'
status: Done
assignee: []
created_date: '2026-03-08 16:26'
updated_date: '2026-03-08 17:43'
labels:
  - enhancement
  - 'epic: P1 - Transport Migration'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/39'
  - SPEC.md §4.2 (single-server-per-vault decision)
  - SPEC.md §4.5 (WebSocket Provider)
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** developer, **I want** `SharedFolder` and `SharedDoc` to use `WebsocketProvider` from `y-websocket`, **so that** document synchronisation works over WebSocket rather than WebRTC.

### Context
The codebase is in a transitional state: WebRTC was removed (P1-S2), settings were updated to a server-centric model with `serverUrl` (P1-S3). `SharedFolder` and `SharedDoc` in `src/sharedTypes.ts` currently have no network provider — only `IndexeddbPersistence` for local storage. Awareness/cursor presence is disabled (passed as `null` to `yCollab`).

### Requirements
- Add `y-websocket` to `package.json` dependencies.
- Replace the removed `WebrtcProvider` with `WebsocketProvider` in both `SharedFolder` and `SharedDoc`.
- WebSocket URL: `${settings.serverUrl}/room/${guid}`.
- `docName` parameter = room `guid`.
- Create provider with `{ connect: false }`; call `provider.connect()` unconditionally with a `// TODO(P2): attach token` comment.
- Provider cleanup (`provider.destroy()`) in the same lifecycle location as the former WebRTC cleanup.
- Wire awareness back into `yCollab` for cursor/user presence.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `y-websocket` appears in `package.json` `dependencies`.
- [ ] #2 No `WebrtcProvider` instantiation exists in the source tree.
- [ ] #3 `SharedFolder` constructs a `WebsocketProvider` with URL `${plugin.settings.serverUrl}/room/${guid}`.
- [ ] #4 `SharedDoc` constructs a `WebsocketProvider` with URL `${plugin.settings.serverUrl}/room/${guid}`.
- [ ] #5 Both providers use the folder/doc `guid` as the `docName`.
- [ ] #6 `provider.destroy()` is called when the folder/doc is unloaded.
- [ ] #7 Given a running stock `y-websocket` server at the configured `serverUrl`, two plugin instances open to the same room converge on the same document state within 2 seconds of an edit.
- [ ] #8 A `// TODO(P2): attach token` comment marks the location where bearer token injection will be added.
- [ ] #9 TypeScript compilation produces no errors.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Step 1: Add `y-websocket` dependency
- `npm install y-websocket`
- Verify it appears in `package.json` `dependencies` (not devDependencies).

### Step 2: Wire `WebsocketProvider` into `SharedFolder` (`src/sharedTypes.ts`)
- Import `WebsocketProvider` from `y-websocket`.
- Add a `private _provider: WebsocketProvider` field.
- In the constructor (or initialization path), construct the provider:
  ```ts
  const wsUrl = `${plugin.settings.serverUrl}/room/${this.guid}`;
  this._provider = new WebsocketProvider(wsUrl, this.guid, this._ydoc, { connect: false });
  // TODO(P2): attach token
  this._provider.connect();
  ```
- **Key detail**: The `SharedFolder` constructor receives the `plugin` object (type `MultiplayerPlugin`), which has `plugin.settings.serverUrl`. Thread the URL from there.

### Step 3: Wire `WebsocketProvider` into `SharedDoc` (`src/sharedTypes.ts`)
- Add a `private _provider: WebsocketProvider` field.
- Same pattern as SharedFolder — construct with `{ connect: false }`, add TODO comment, call `connect()`.
- **Key detail**: `SharedDoc` is created by `SharedFolder.createDoc()`. Need to pass `serverUrl` (or the plugin ref) through so `SharedDoc` can construct its own provider URL.

### Step 4: Restore awareness in `SharedDoc`
- In the `binding` getter, replace `null` with `this._provider.awareness`:
  ```ts
  this._binding = yCollab(yText, this._provider.awareness, { undoManager });
  ```
- Restore the awareness local state setup (username, color) that was removed with WebRTC. This requires access to user settings — thread through from plugin.

### Step 5: Provider cleanup
- **`SharedDoc.close()`**: Add `this._provider.destroy()` alongside the existing `this._persistence.destroy()`.
- **`SharedDoc.destroy()`**: Same — destroy provider if it exists.
- **`SharedFolder.destroy()`**: Add `this._provider.destroy()` to clean up the folder-level provider.
- Match the lifecycle pattern that existed before WebRTC removal.

### Step 6: Verify and clean up
- Run `npm run build` — fix any TypeScript errors.
- Run `npm test` — fix any test failures.
- Grep the source tree to confirm zero `WebrtcProvider` references remain.
- Review imports: remove any stale `y-webrtc` imports if lingering.

### Risks / Open Questions
- **`serverUrl` threading**: Need to check how `SharedDoc` currently gets created and ensure it has access to `serverUrl`. May need to add a parameter to `SharedFolder.createDoc()` or store it on the SharedDoc.
- **Awareness user info**: The username/color were previously set from plugin settings. Need to verify those values are still accessible in the current settings shape.
- **URL format**: The spec says `/room/${guid}` — confirm the `y-websocket` server expects this path structure (stock `y-websocket` server uses the path as the room name, so this should work).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Architecture context**: `serverUrl` is vault-level, not per-folder (see SPEC.md §4.2). All providers derive their WebSocket URL from the single `settings.serverUrl`.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria pass.
- [ ] #2 TypeScript compiles with no errors (`npm run build`).
- [ ] #3 Existing tests pass (`npm test`).
- [ ] #4 Manual smoke test: two Obsidian instances sync edits via a local `y-websocket` server.
<!-- DOD:END -->
