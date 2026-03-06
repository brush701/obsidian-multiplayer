# P1 — Transport Migration

Replace the WebRTC + master-password sync mechanism with a WebSocket provider backed by a dedicated server. This epic also removes all legacy infrastructure that has no place in the new architecture.

**Dependencies:** None — this is the starting point.
**Blocks:** P2 (Authentication), P3 (Room Management), P4 (Permissions)

---

## Stories

### P1-S1 — Remove master password infrastructure

**As a** developer,
**I want** the password management system deleted from the codebase,
**so that** there is no dead code to maintain and no misleading UI for users.

#### Requirements

- `src/pwManager.ts` is deleted entirely.
- `PasswordModal` is removed from `src/modals.ts`.
- `ResetPasswordModal` is removed from `src/modals.ts`.
- The `PasswordModal` invocation at plugin load time (currently `main.ts:50–58`) is removed.
- The `salt` field is removed from the settings interface.
- The `encPw` field is removed from `SharedTypeSettings`.
- The "Reset Master Password" button is removed from `MultiplayerSettingTab`.
- The "Backup Shared Folders" button is removed from `MultiplayerSettingTab`.
- All `import` statements referencing removed modules or Node's `crypto` module (used solely for password operations) are removed.
- The plugin loads successfully without prompting for a password.

#### Acceptance Criteria

- [ ] `src/pwManager.ts` does not exist.
- [ ] No reference to `PasswordModal` or `ResetPasswordModal` exists anywhere in the source tree.
- [ ] `MultiplayerSettings` interface contains no `salt` field.
- [ ] `SharedTypeSettings` interface contains no `encPw` field.
- [ ] Settings tab renders without "Reset Master Password" or "Backup Shared Folders" controls.
- [ ] Plugin `onload()` completes without displaying any modal or blocking on user input.
- [ ] TypeScript compilation produces no errors related to removed symbols.
- [ ] No `import ... from 'crypto'` remains in the codebase (outside of any future intentional use unrelated to passwords).

---

### P1-S2 — Remove WebRTC provider

**As a** developer,
**I want** the WebRTC signaling infrastructure removed,
**so that** the dependency on third-party signaling servers and the `y-webrtc` package is eliminated.

#### Requirements

- `y-webrtc` is removed from `package.json` and `package-lock.json`.
- `WebrtcProvider` is no longer instantiated anywhere in the source tree.
- `signalingServers` is removed from `SharedTypeSettings`.
- The signaling server URL setting is removed from `MultiplayerSettingTab`.
- Existing `SharedTypeSettings` entries that contain `signalingServers` are migrated on plugin load: the field is stripped and the entry is saved back without it (non-destructive; the room remains with its `guid` and `path` intact).

#### Acceptance Criteria

- [ ] `y-webrtc` does not appear in `package.json` `dependencies` or `devDependencies`.
- [ ] `yarn install` / `npm install` completes without installing `y-webrtc`.
- [ ] No `import` or `require` of `y-webrtc` exists in the source tree.
- [ ] `SharedTypeSettings` interface contains no `signalingServers` field.
- [ ] Settings tab renders without any signaling server URL input.
- [ ] On plugin load, any stored settings entry with a `signalingServers` key is rewritten without that key; all other fields (`guid`, `path`, `name`) are preserved.
- [ ] TypeScript compilation produces no errors related to removed symbols.

---

### P1-S3 — Update settings schema

**As a** developer,
**I want** the settings interfaces updated to reflect the new server-centric model,
**so that** all code works against a consistent, minimal data shape.

#### Requirements

The final `MultiplayerSettings` interface is:

```typescript
interface MultiplayerSettings {
  serverUrl: string;
  username: string;
  sharedFolders: SharedTypeSettings[];
}

interface SharedTypeSettings {
  guid: string;
  path: string;
  name: string;
}
```

- `DEFAULT_SETTINGS` is updated to match (empty `sharedFolders`, empty `serverUrl`, empty `username`).
- Schema migration runs on plugin load before any other initialisation that reads settings. Migration is idempotent (running it twice produces the same result).
- Fields present in stored settings that are not in the new schema (`salt`, `encPw`, `signalingServers`) are dropped during migration.
- Fields present in the new schema that are missing from stored settings are initialised to their defaults.

#### Acceptance Criteria

- [ ] `MultiplayerSettings` matches the interface above exactly (no extra fields).
- [ ] `SharedTypeSettings` matches the interface above exactly (no extra fields).
- [ ] `DEFAULT_SETTINGS` satisfies `MultiplayerSettings` with no TypeScript errors.
- [ ] Given stored settings `{ salt: "x", sharedFolders: [{ guid: "g", path: "p", encPw: "e", signalingServers: ["wss://..."] }] }`, after migration the stored value is `{ serverUrl: "", username: "", sharedFolders: [{ guid: "g", path: "p", name: "" }] }`.
- [ ] Running migration a second time on already-migrated settings produces identical output.
- [ ] TypeScript compilation produces no errors related to settings types.

---

### P1-S4 — Integrate y-websocket provider

**As a** developer,
**I want** `SharedFolder` and `SharedDoc` to use `WebsocketProvider` from `y-websocket`,
**so that** document synchronisation works over WebSocket rather than WebRTC.

#### Requirements

- `y-websocket` is added to `package.json` as a dependency.
- `WebsocketProvider` from `y-websocket` replaces `WebrtcProvider` in both `SharedFolder` and `SharedDoc`.
- The WebSocket URL is constructed as `${settings.serverUrl}/room/${guid}` where `serverUrl` comes from plugin settings.
- The `docName` parameter passed to `WebsocketProvider` is the room `guid`.
- The provider is created with `{ connect: false }` initially; `provider.connect()` is called explicitly after the access token is attached (see P2 — this story should leave a clearly marked `// TODO(P2): attach token` comment in place of the connect call, and call `provider.connect()` unconditionally for now so the story is independently testable against an unauthenticated local server).
- Provider cleanup (`provider.destroy()`) is called in the same lifecycle location as the former `WebrtcProvider` cleanup.
- `awareness` on the new provider is used for cursor/user presence in the same way as before.

#### Acceptance Criteria

- [ ] `y-websocket` appears in `package.json` `dependencies`.
- [ ] No `WebrtcProvider` instantiation exists in the source tree.
- [ ] `SharedFolder` constructs a `WebsocketProvider` with URL `${plugin.settings.serverUrl}/room/${guid}`.
- [ ] `SharedDoc` constructs a `WebsocketProvider` with URL `${plugin.settings.serverUrl}/room/${guid}`.
- [ ] Both providers use the folder/doc `guid` as the `docName`.
- [ ] `provider.destroy()` is called when the folder/doc is unloaded.
- [ ] Given a running stock `y-websocket` server at the configured `serverUrl`, two plugin instances open to the same room converge on the same document state within 2 seconds of an edit.
- [ ] A `// TODO(P2): attach token` comment marks the location where bearer token injection will be added.
- [ ] TypeScript compilation produces no errors.

---

### P1-S5 — Remove context menu legacy items

**As a** user,
**I want** the "Copy GUID" and "Copy Password" context menu items removed,
**so that** the menu only contains actions that are meaningful in the new model.

#### Requirements

- "Copy GUID" is removed from the shared folder right-click context menu.
- "Copy Password" is removed from the shared folder right-click context menu.
- No other context menu items are removed or reordered by this story (changes to "Invite" and "Members" items are P3).

#### Acceptance Criteria

- [ ] Right-clicking a shared folder in the file explorer does not show "Copy GUID".
- [ ] Right-clicking a shared folder in the file explorer does not show "Copy Password".
- [ ] All other existing context menu items remain present and functional.
