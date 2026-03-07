# P3 — Room Management

All user-facing workflows for creating, joining, sharing, and viewing rooms. This epic replaces the current `SharedFolderModal` and adds the invite and membership UI surfaces described in the spec.

**Enterprise context:** In a fully managed corporate deployment, most users will never create or join rooms via the plugin. IT provisions room access via directory groups (SCIM → admin UI). The plugin-side flows in this epic serve two audiences: (1) power users who create rooms for ad-hoc collaboration and share invite links via Slack, and (2) end-users who receive an invite link and need to add a room to their vault. Admin-level room management (group assignments, member role changes, room deletion) lives in the admin web UI, not the plugin.

**Dependencies:** P1 (settings schema), P2 (AuthManager — for API calls and gating UI on auth state)
**Blocks:** P4 (Permissions — needs rooms to exist)

---

## Stories

### P3-S1 — API client

**As a** developer,
**I want** a typed API client that wraps all HTTP calls to the server,
**so that** individual UI components are not responsible for fetch boilerplate or error handling.

#### Requirements

`src/api.ts` exports a class `ApiClient` with the following public interface:

```typescript
class ApiClient {
  constructor(settings: MultiplayerSettings, auth: AuthManager)

  /** List rooms the authenticated user is a member of. */
  listRooms(): Promise<RoomSummary[]>

  /** Create a new room. Returns the created room. */
  createRoom(name: string): Promise<RoomDetail>

  /** Claim an invite token and return the joined room. */
  joinRoom(token: string): Promise<RoomDetail>

  /** Get members and metadata for a specific room. */
  getRoom(guid: string): Promise<RoomDetail>

  /** Get the authenticated user's role in a specific room. */
  getMyRole(guid: string): Promise<RoomRole>

  /** Create an invite link for a room. */
  createInvite(guid: string, role: RoomRole, expiresIn: InviteExpiry): Promise<string>
}

type RoomRole = 'OWNER' | 'EDITOR' | 'VIEWER'
type InviteExpiry = '1d' | '7d' | '30d'

interface RoomSummary {
  guid: string
  name: string
  role: RoomRole
}

interface RoomDetail {
  guid: string
  name: string
  role: RoomRole
  members: RoomMember[]
}

interface RoomMember {
  userId: string
  email: string
  name: string
  role: RoomRole
}
```

- All methods prepend `settings.serverUrl` to the path.
- All methods call `auth.getAccessToken()` and include the result as `Authorization: Bearer <token>`.
- If `getAccessToken()` returns `null`, the method throws an `AuthRequiredError`.
- Non-2xx responses throw an `ApiError` with the HTTP status and a message parsed from the response body if possible.
- `ApiClient` is instantiated once in `main.ts` alongside `AuthManager`.

#### Acceptance Criteria

- [ ] `src/api.ts` exists and exports `ApiClient`, `RoomRole`, `InviteExpiry`, `RoomSummary`, `RoomDetail`, `RoomMember`.
- [ ] `ApiClient` satisfies the interface above with no TypeScript errors.
- [ ] Every method includes an `Authorization: Bearer <token>` header on the HTTP request.
- [ ] If `auth.getAccessToken()` returns `null`, the method throws `AuthRequiredError` without making a network call.
- [ ] A non-2xx response causes the method to throw `ApiError`.
- [ ] TypeScript compilation produces no errors.

---

### P3-S2 — Rework SharedFolderModal: Create tab

**As a** user,
**I want** to create a new shared room from a dialog in Obsidian,
**so that** I can start collaborating on a folder without leaving the app.

#### Requirements

`SharedFolderModal` is redesigned with two tabs: **Create** and **Join** (see P3-S3 for Join).

**Create tab layout:**

```
Room name: [____________________________]
           (defaults to the folder's name if opened from a folder context menu)

           [ Create Room ]
```

Behaviour:

1. User enters a room name (required; non-empty).
2. Clicking "Create Room" calls `ApiClient.createRoom(name)`.
3. While the request is in flight, the button is disabled and shows "Creating…".
4. On success: the returned `{ guid, name }` is used to create a new `SharedFolder` locally with the active folder path (or a folder picked via Obsidian's `FuzzySuggestModal` if not opened from a folder context). Settings are saved.
5. The modal closes.
6. On `AuthRequiredError`: show notice "Sign in first." Modal remains open.
7. On `ApiError`: show notice "Could not create room: {message}." Modal remains open.
8. Room name input has focus when the modal opens.

#### Acceptance Criteria

- [ ] `SharedFolderModal` renders a tab bar with "Create" and "Join" tabs.
- [ ] Create tab shows a room name input and a "Create Room" button.
- [ ] Room name input is pre-filled with the folder name when opened from a folder's context menu.
- [ ] "Create Room" is disabled when the room name input is empty.
- [ ] Clicking "Create Room" calls `ApiClient.createRoom(name)`.
- [ ] While the request is in flight, the button is disabled and shows "Creating…".
- [ ] On success, a new `SharedTypeSettings` entry is created with the returned `guid` and `name`, and the configured folder path.
- [ ] On success, `plugin.settings.sharedFolders` contains the new entry and settings are saved.
- [ ] On success, the modal closes.
- [ ] On `AuthRequiredError`, a notice is shown and the modal remains open.
- [ ] On `ApiError`, a notice is shown with the error message and the modal remains open.
- [ ] The room name input has focus when the modal opens on the Create tab.

---

### P3-S3 — Rework SharedFolderModal: Join tab

**As a** user,
**I want** to join a room by pasting an invite link or token,
**so that** I can collaborate without needing the plugin to handle a deep link automatically.

#### Requirements

**Join tab layout:**

```
Invite link or code: [____________________________]

                     [ Join Room ]
```

Behaviour:

1. User pastes an invite link (e.g. `https://server/join?token=<uuid>`) or a raw token UUID.
2. The plugin extracts the token: if the input is a URL, it parses the `token` query parameter; otherwise it uses the raw input string.
3. Clicking "Join Room" calls `ApiClient.joinRoom(token)`.
4. While in flight, button is disabled and shows "Joining…".
5. On success: a folder picker (Obsidian's `FuzzySuggestModal` listing vault folders) is shown. User selects a local folder. A `SharedFolder` is created at that path with the returned `{ guid, name }`. Settings are saved.
6. The modal closes after folder selection.
7. On `AuthRequiredError`: show notice "Sign in first." Modal remains open.
8. On `ApiError` with status 404 or 410: show notice "Invite link is invalid or has expired." Modal remains open.
9. On other `ApiError`: show notice "Could not join room: {message}." Modal remains open.

#### Acceptance Criteria

- [ ] Join tab shows an invite link input and a "Join Room" button.
- [ ] Given input `https://server/join?token=abc-123`, the token extracted and sent is `abc-123`.
- [ ] Given input `abc-123` (no URL), the token sent is `abc-123`.
- [ ] "Join Room" is disabled when the input is empty.
- [ ] Clicking "Join Room" calls `ApiClient.joinRoom(token)`.
- [ ] While the request is in flight, the button is disabled and shows "Joining…".
- [ ] On success, a folder picker is displayed.
- [ ] After folder selection, a `SharedTypeSettings` entry is created with the returned `guid` and `name`.
- [ ] On success, the modal closes.
- [ ] On `AuthRequiredError`, a notice is shown and the modal remains open.
- [ ] On a 404 or 410 `ApiError`, the "invalid or expired" notice is shown and the modal remains open.
- [ ] On another `ApiError`, a generic notice is shown and the modal remains open.

---

### P3-S4 — Protocol handler: auto-join from browser

**As a** user,
**I want** clicking "Open in Obsidian" in the browser invite claim page to automatically prompt me to add the room to my vault,
**so that** I don't have to copy-paste anything.

#### Requirements

A protocol handler for `obsidian://multiplayer/join` is registered in `main.ts`:

```
obsidian://multiplayer/join?guid={guid}&name={name}&server={serverUrl}
```

On receipt:

1. If `server` does not match `settings.serverUrl`, show notice "This invite is for a different server ({server}). Update your server URL in settings." Take no further action.
2. If the `guid` is already in `settings.sharedFolders`, show notice "You already have '[name]' in your vault." Take no further action.
3. If not authenticated, show notice "Sign in to Multiplayer before opening a room link." Take no further action.
4. Otherwise, open a folder picker. After selection, create a `SharedFolder` with the given `guid` and `name`. Save settings.
5. Show notice "Room '[name]' added to your vault."

#### Acceptance Criteria

- [ ] `obsidian://multiplayer/join` is registered as a protocol handler on plugin load.
- [ ] Given a `server` parameter that does not match `settings.serverUrl`, a mismatch notice is shown and no folder picker opens.
- [ ] Given a `guid` that is already in `settings.sharedFolders`, a "already have" notice is shown and no folder picker opens.
- [ ] Given `isAuthenticated = false`, a "sign in first" notice is shown and no folder picker opens.
- [ ] Given valid parameters and authentication, a folder picker is displayed.
- [ ] After folder selection, `settings.sharedFolders` contains a new entry with the given `guid` and `name`.
- [ ] After folder selection, a "Room added" notice is shown.
- [ ] The handler is unregistered on plugin unload.

---

### P3-S5 — InviteModal

**As a** user,
**I want** to generate and copy an invite link from Obsidian,
**so that** I can share a room with a colleague without opening a browser.

#### Requirements

`InviteModal` is a new modal opened from the "Invite to [Room Name]" context menu item (added in this story; see also P3-S7 for context menu changes).

**Layout:**

```
┌─ Invite to "Q4 Planning" ─────────────────┐
│                                            │
│  Role:    ● Editor   ○ Viewer             │
│                                            │
│  Expires: [7 days  ▾]                     │
│           1 day / 7 days / 30 days        │
│                                            │
│  [ Copy Invite Link ]                     │
└────────────────────────────────────────────┘
```

Behaviour:

1. Default role: Editor. Default expiry: 7 days.
2. Clicking "Copy Invite Link" calls `ApiClient.createInvite(guid, role, expiresIn)`.
3. While in flight, button is disabled and shows "Generating…".
4. On success, the returned invite URL is written to the clipboard via `navigator.clipboard.writeText()`. A notice is shown: "Invite link copied."
5. The modal remains open (user may generate additional invites with different settings).
6. On `ApiError`, show notice "Could not create invite: {message}."
7. `InviteModal` is only accessible to users with role `OWNER` or `EDITOR` for the room. If role is `VIEWER`, the "Invite to…" context menu item is not shown.

#### Acceptance Criteria

- [ ] `InviteModal` renders with role radio buttons (Editor / Viewer) and expiry dropdown (1 day / 7 days / 30 days).
- [ ] Default role is Editor; default expiry is 7 days.
- [ ] Clicking "Copy Invite Link" calls `ApiClient.createInvite` with the selected role and expiry.
- [ ] While in flight, the button is disabled and shows "Generating…".
- [ ] On success, the invite URL is written to the clipboard.
- [ ] On success, a "Invite link copied" notice is shown.
- [ ] The modal remains open after a successful link generation.
- [ ] On `ApiError`, a notice is shown with the error message.
- [ ] The "Invite to [Room Name]" context menu item is not shown to users whose local cached role for the room is `VIEWER`.

---

### P3-S6 — MembersModal

**As a** user,
**I want** to see who is in a room from Obsidian,
**so that** I can understand current membership without opening the admin panel.

#### Requirements

`MembersModal` is a new read-only modal opened from the "Room members" context menu item.

**Layout:**

```
┌─ Q4 Planning — Members ─────────────────────┐
│                                              │
│  alice@company.com    Owner                 │
│  bob@company.com      Editor                │
│  carol@company.com    Viewer                │
│                                             │
│  [ Invite someone new ]                     │
│  [ Manage in admin panel ↗ ]               │
└─────────────────────────────────────────────┘
```

Behaviour:

1. On open, calls `ApiClient.getRoom(guid)` to fetch current members.
2. While loading, shows a spinner/loading text.
3. Members are listed as `{email}  {role}` rows, sorted: OWNER first, then EDITOR, then VIEWER; alphabetically within each role.
4. "Invite someone new" opens `InviteModal` for the same room (replacing the members modal).
5. "Manage in admin panel ↗" opens the system browser to `{serverUrl}/admin` (opens `{serverUrl}/admin/rooms/{guid}` if possible; fallback to `/admin`).
6. "Invite someone new" is not shown to VIEWERs (same rule as InviteModal).
7. On `ApiError`, shows error message inline; modal remains open.

#### Acceptance Criteria

- [ ] `MembersModal` opens and calls `ApiClient.getRoom(guid)` immediately.
- [ ] While loading, a loading indicator is shown.
- [ ] Members are displayed with email and role.
- [ ] Members are sorted OWNER → EDITOR → VIEWER, alphabetically within each group.
- [ ] "Invite someone new" button is present for OWNER and EDITOR roles.
- [ ] "Invite someone new" button is absent for VIEWER role.
- [ ] Clicking "Invite someone new" opens `InviteModal`.
- [ ] "Manage in admin panel ↗" opens the system browser to the admin URL.
- [ ] On `ApiError`, an error message is shown inline in the modal.

---

### P3-S7 — Context menu updates

**As a** user,
**I want** the right-click context menu on shared folders to reflect the new sharing model,
**so that** the available actions are relevant and consistent with my role.

#### Requirements

Right-click context menu on a shared folder entry in the file explorer:

```
Delete Multiplayer Shared Folder
─────────────────────────────────
Invite to [Room Name]       (hidden for VIEWER role)
Room members
```

- "Copy GUID" and "Copy Password" are removed (completed in P1-S5).
- "Invite to [Room Name]" opens `InviteModal`.
- "Room members" opens `MembersModal`.
- The locally cached role (from the most recent `ApiClient.getMyRole()` call, stored on `SharedFolder`) determines which items are shown. If no role is cached yet (e.g. before first connect), all items are shown and the server will enforce the real permission.

#### Acceptance Criteria

- [ ] Right-click on a shared folder shows "Delete Multiplayer Shared Folder", "Invite to [Room Name]", and "Room members".
- [ ] "Invite to [Room Name]" is not shown when the cached role is `VIEWER`.
- [ ] Clicking "Invite to [Room Name]" opens `InviteModal` scoped to that room.
- [ ] Clicking "Room members" opens `MembersModal` scoped to that room.
- [ ] "Copy GUID" does not appear.
- [ ] "Copy Password" does not appear.

---

### P3-S8 — Available rooms list in settings tab

**As a** user,
**I want** to see rooms I have access to but haven't added to my vault,
**so that** I can easily add them without needing an invite link.

#### Requirements

The settings tab includes an "Available rooms" section below the Collaboration section:

```
Available rooms

┌──────────────────────────────────────────────────────┐
│  Q4 Planning      Editor    [ Add to vault ]         │
│  Engineering Hub  Editor    [ Add to vault ]         │
│  Board Docs       Viewer    [ Add to vault ]         │
└──────────────────────────────────────────────────────┘
```

Behaviour:

1. The list is populated by `ApiClient.listRooms()`, called when the settings tab is opened (if authenticated).
2. Rooms already present in `settings.sharedFolders` (matched by `guid`) are excluded from the list.
3. If `isAuthenticated` is `false`, the section shows "Sign in to see your available rooms."
4. While loading, shows "Loading rooms…".
5. On `ApiError`, shows "Could not load rooms."
6. "Add to vault" opens a folder picker. After selection, creates a `SharedFolder` with the room's `guid` and `name`. Saves settings. Removes the entry from the available list.
7. If there are no available rooms (all are already in vault, or user has none), the section shows "No additional rooms available."

#### Acceptance Criteria

- [ ] Settings tab calls `ApiClient.listRooms()` when opened and `isAuthenticated` is `true`.
- [ ] Rooms already in `settings.sharedFolders` are not shown in the available list.
- [ ] Each listed room shows name, role, and "Add to vault" button.
- [ ] Clicking "Add to vault" opens a folder picker.
- [ ] After folder selection, the room is added to `settings.sharedFolders` and the entry disappears from the list.
- [ ] When `isAuthenticated` is `false`, a "Sign in" message is shown instead of the list.
- [ ] While `listRooms()` is in flight, a loading message is shown.
- [ ] When `listRooms()` fails, an error message is shown.
- [ ] When the list is empty, "No additional rooms available" is shown.

---

### P3-S9 — Group-derived membership in MembersModal

**As a** user,
**I want** to see when a colleague's room access comes from a directory group rather than a direct invite,
**so that** I understand that removing them from the room in the admin panel would be ineffective (their group membership would re-grant access on next sync).

#### Requirements

`MembersModal` is updated to display group-derived memberships separately from direct memberships.

**Updated layout:**

```
┌─ Q4 Planning — Members ─────────────────────────┐
│                                                  │
│  Direct members                                  │
│  alice@company.com    Owner                     │
│  bob@company.com      Editor                    │
│                                                  │
│  Via "Engineering" group                         │
│  carol@company.com    Editor                    │
│  dave@company.com     Editor                    │
│                                                  │
│  [ Invite someone new ]                          │
│  [ Manage in admin panel ↗ ]                    │
└──────────────────────────────────────────────────┘
```

The server returns group-derived membership in `GET /api/rooms/:guid` alongside direct members. The plugin renders them in a separate section labelled with the group's `displayName`. Users who appear in both direct and group sections are shown only under "Direct members" (direct membership takes precedence and is what the admin panel would modify).

If the room has no group-derived members, the section is omitted.

#### Acceptance Criteria

- [ ] `RoomDetail` type in `src/api.ts` is extended to include `groupMembers: { groupName: string, members: RoomMember[] }[]`.
- [ ] `MembersModal` renders a "Direct members" section and, if present, one or more "Via [group name]" sections.
- [ ] Users who are both direct members and group members appear only under "Direct members".
- [ ] If `groupMembers` is empty or absent, no group section is rendered.
- [ ] The "Manage in admin panel ↗" link is shown when group-derived members are present, regardless of the viewer's role.
