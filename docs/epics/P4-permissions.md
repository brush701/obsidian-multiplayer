# P4 — Permissions Enforcement

Fetch and cache the user's role for each room, and enforce read-only behaviour in the editor for VIEWERs. The server is the authoritative source; this epic covers the plugin-side surface.

**Dependencies:** P2 (AuthManager, ApiClient), P3 (rooms exist and are connected)
**Blocks:** Nothing in the plugin — this epic can ship incrementally.

---

## Stories

### P4-S1 — Fetch and cache room role

**As a** developer,
**I want** each `SharedFolder` and `SharedDoc` to know the user's role,
**so that** downstream code can make role-based decisions without additional API calls.

#### Requirements

- `SharedFolder` gains a property `role: RoomRole | null` (initially `null`).
- After `provider.connect()` is called and the WebSocket connection is established (`provider.on('status', ...)` fires with `{ status: 'connected' }`), `ApiClient.getMyRole(guid)` is called.
- The returned role is stored on `SharedFolder.role` and also propagated to all `SharedDoc` instances belonging to that folder.
- `SharedDoc` gains a property `role: RoomRole | null` (initially `null`), set from the parent `SharedFolder`.
- If `getMyRole()` fails (network error or non-2xx), `role` remains `null`; the failure is logged but does not surface to the user.
- `role` is re-fetched after a reconnect (every time `status` transitions to `'connected'`).

#### Acceptance Criteria

- [ ] `SharedFolder` has a `role` property of type `RoomRole | null`, initially `null`.
- [ ] `SharedDoc` has a `role` property of type `RoomRole | null`, initially `null`.
- [ ] `getMyRole()` is called once per `SharedFolder` each time a WebSocket connection is established.
- [ ] After a successful `getMyRole()` call, `SharedFolder.role` reflects the returned value.
- [ ] `SharedDoc.role` reflects the parent folder's role.
- [ ] If `getMyRole()` throws, `role` remains `null` and no error notice is shown to the user.
- [ ] On reconnect, `getMyRole()` is called again and `role` is updated.

---

### P4-S2 — Read-only editor for VIEWERs

**As a** user with the VIEWER role,
**I want** the document to open in read-only mode,
**so that** I cannot accidentally modify content and my changes are not rejected by the server.

#### Requirements

- In `SharedDoc`, the `binding` getter (or wherever the CodeMirror extension is composed) checks `this.role`.
- If `this.role === 'VIEWER'`:
  - `yCollab()` is called **without** an `UndoManager` argument (so Ctrl+Z does not apply).
  - The CodeMirror `EditorState.readOnly` facet is set to `true` via a `StateField` or compartment that is re-configured when the role is known.
  - A `ViewPlugin` or equivalent shows a "Read only" annotation in the editor gutter or as a top-of-file banner.
- If `this.role` is `null` (not yet known), the editor opens in read-write mode as a default; it is re-configured once `role` is set. This avoids a flash of read-only before the first successful role fetch.
- If `this.role` changes from `null` to `VIEWER` after the editor is open, the editor transitions to read-only without requiring the file to be closed and reopened.

#### Acceptance Criteria

- [ ] When `role` is `VIEWER`, `yCollab()` is called without an `UndoManager`.
- [ ] When `role` is `VIEWER`, the `EditorState.readOnly` facet is `true` and keystrokes do not modify document content.
- [ ] When `role` is `VIEWER`, a visual indicator ("Read only") is visible in the editor.
- [ ] When `role` is `null`, the editor opens in read-write mode.
- [ ] When `role` transitions from `null` to `VIEWER` on an already-open file, the editor becomes read-only without a file close/reopen.
- [ ] When `role` is `OWNER` or `EDITOR`, the editor is fully editable and no "Read only" indicator is shown.
- [ ] Pressing Ctrl+Z (undo) in VIEWER mode does not modify the document.

---

### P4-S3 — Server-side viewer enforcement (integration concern)

**As a** developer,
**I want** the plugin to behave correctly when the server refuses updates from VIEWERs,
**so that** a user cannot bypass plugin-side read-only mode via the developer console or a modified client.

> **Note:** Server-side enforcement is implemented server-side (not in this repo). This story covers the plugin-side handling of the case where the server silently drops VIEWER update messages — which is the expected behaviour — so the plugin does not need to do anything special. This story documents the expected observable behaviour for test purposes.

#### Requirements

- The plugin does not implement any special logic to handle silently dropped updates; it relies on the CodeMirror read-only facet to prevent updates from being generated in the first place.
- If the server drops an update (the Yjs doc state diverges from what the plugin sent), the server will push its authoritative state on the next sync, and the Yjs CRDT will reconcile. No data loss occurs.
- The plugin does not show an error when update messages are silently dropped.

#### Acceptance Criteria

- [ ] No plugin code attempts to detect whether the server has dropped a Yjs update message.
- [ ] No error notice is shown to a VIEWER user as a result of the server discarding their (non-existent, due to read-only) updates.
- [ ] Given a VIEWER opens a file, edits are prevented client-side; the document content matches the server state within 2 seconds of connecting.

---

### P4-S4 — Role-gated UI elements

**As a** developer,
**I want** all role-dependent UI elements to consistently gate on the cached role,
**so that** VIEWERs do not see controls they cannot use.

#### Requirements

The following UI elements must check `SharedFolder.role` before rendering:

| Element | Condition to show |
|---|---|
| "Invite to [Room Name]" context menu item | `role === 'OWNER' \|\| role === 'EDITOR'` |
| "Copy Invite Link" button in `InviteModal` | `role === 'OWNER' \|\| role === 'EDITOR'` (modal should not be openable by VIEWERs, but button gating is a defence-in-depth) |
| "Invite someone new" in `MembersModal` | `role === 'OWNER' \|\| role === 'EDITOR'` |

When `role` is `null` (not yet fetched), treat as `EDITOR` (show the item). The server will enforce the actual permission.

#### Acceptance Criteria

- [ ] "Invite to [Room Name]" is hidden when `SharedFolder.role === 'VIEWER'`.
- [ ] "Invite to [Room Name]" is visible when `SharedFolder.role === 'OWNER'`.
- [ ] "Invite to [Room Name]" is visible when `SharedFolder.role === 'EDITOR'`.
- [ ] "Invite to [Room Name]" is visible when `SharedFolder.role === null`.
- [ ] "Invite someone new" in `MembersModal` is hidden when the room role is `VIEWER`.
- [ ] "Invite someone new" in `MembersModal` is visible for `OWNER` and `EDITOR`.
- [ ] The `InviteModal` "Copy Invite Link" button is disabled (or hidden) when the role is `VIEWER`.
