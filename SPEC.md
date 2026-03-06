# Obsidian Multiplayer — Technical Specification

**Status:** Draft
**Last updated:** 2026-03-06

---

## Table of Contents

1. [Goals](#1-goals)
2. [Repositories](#2-repositories)
3. [Architecture Overview](#3-architecture-overview)
4. [Plugin](#4-plugin)
   - 4.1 [What Gets Removed](#41-what-gets-removed)
   - 4.2 [Settings Schema](#42-settings-schema)
   - 4.3 [Auth Flow — OAuth 2.0 PKCE](#43-auth-flow--oauth-20-pkce)
   - 4.4 [Secret Storage](#44-secret-storage)
   - 4.5 [WebSocket Provider](#45-websocket-provider)
   - 4.6 [UI Inventory](#46-ui-inventory)
   - 4.7 [Permissions Enforcement in the Editor](#47-permissions-enforcement-in-the-editor)
   - 4.8 [Connection Status](#48-connection-status)
   - 4.9 [Bug Fixes](#49-bug-fixes)
5. [Server](#5-server)
   - 5.1 [Tech Stack](#51-tech-stack)
   - 5.2 [Project Structure](#52-project-structure)
   - 5.3 [Database Schema](#53-database-schema)
   - 5.4 [REST API](#54-rest-api)
   - 5.5 [WebSocket Handler](#55-websocket-handler)
   - 5.6 [Yjs Persistence](#56-yjs-persistence)
   - 5.7 [OIDC Provider](#57-oidc-provider)
   - 5.8 [Admin Web UI](#58-admin-web-ui)
   - 5.9 [Deployment](#59-deployment)
6. [Permissions Model](#6-permissions-model)
7. [Invitation Flow](#7-invitation-flow)
8. [Deprovisioning](#8-deprovisioning)
9. [Implementation Phases](#9-implementation-phases)
10. [Open Questions](#10-open-questions)

---

## 1. Goals

Obsidian Multiplayer enables real-time collaborative editing of notes directly inside Obsidian. The objective is to make it production-ready for teams in a business context.

### Design Principles

- **Self-hostable first.** A business should be able to run the entire stack on their own infrastructure with a single `docker compose up`. No dependency on any Anthropic- or author-operated cloud service.
- **Integrate with existing identity.** Businesses already have Okta, Azure AD, Google Workspace, or similar. The plugin and server must work with those — not require a new set of credentials.
- **Minimal plugin UI surface.** The Obsidian plugin is for writing, not administration. Keep permissions management out of the plugin except for the core daily workflows (sharing a room, joining a room). Heavy administration belongs in a web UI.
- **No custom cryptography.** The existing hand-rolled AES-256-GCM password system is replaced entirely by OAuth 2.0 and the Obsidian SecretStorage API.
- **Enforce permissions server-side.** The client cannot be trusted. All access control is enforced by the server at the WebSocket connection level.

### Non-Goals (v1)

- Mobile (iOS/Android) support — WebSocket works but OAuth protocol handler may not; defer.
- End-to-end encryption of document content — the server sees plaintext Yjs updates. Viable future addition once auth is solid.
- Fine-grained per-paragraph permissions.
- Obsidian Publish integration.

---

## 2. Repositories

| Repo | Purpose |
|---|---|
| `obsidian-multiplayer` (this repo) | Obsidian plugin |
| `obsidian-multiplayer-server` (new) | WebSocket sync server, REST API, OIDC provider, admin UI |

The two repos are developed and versioned independently. The plugin declares a minimum required server API version; the server declares which plugin versions it supports. Compatibility is checked at connect time.

---

## 3. Architecture Overview

```
┌─────────────────────────────────┐
│         Obsidian Plugin         │
│                                 │
│  SharedFolder / SharedDoc       │
│    WebSocketProvider (y-ws)     │──── WSS /room/:guid?token=JWT ───┐
│                                 │                                   │
│  AuthManager                   │──── HTTPS /api/* ─────────────────┤
│    OAuth PKCE                   │                                   │
│    SecretStorage (tokens)       │──── obsidian://multiplayer/cb ───┐│
└─────────────────────────────────┘                                  ││
                                                                      ││
┌─────────────────────────────────────────────────────────────────┐  ││
│                    obsidian-multiplayer-server                   │  ││
│                                                                  │  ││
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────┐   │  ││
│  │ OIDC Provider│  │  REST API        │  │  WS Handler      │   │  ││
│  │(node-oidc-   │  │  (Fastify)       │  │  (y-websocket)   │   │  ││
│  │  provider)   │  │                  │  │  + JWT validation│   │  ││
│  │              │  │  /api/rooms      │  │  + role check    │   │  ││
│  │ Local accts  │  │  /api/rooms/join │  │  + viewer guard  │   │  ││
│  │ OIDC upstr.  │  │  /admin/*        │  │                  │   │  ││
│  │ SAML upstr.  │◄─┤                  │  │                  │   │  ││
│  └──────────────┘  └─────────────────┘  └──────────────────┘   │  ││
│         │                  │                      │              │  ││
│  ┌──────▼──────────────────▼──────────────────────▼──────────┐  │  ││
│  │                      PostgreSQL                            │  │  ││
│  │  users · organizations · rooms · members · invites        │  │  ││
│  └────────────────────────────────────────────────────────────┘  │  ││
│         │                                                         │  ││
│  ┌──────▼─────────────────────────────────────────────────────┐  │  ││
│  │                       LevelDB                              │  │  ││
│  │               Yjs document persistence                     │  │  ││
│  └────────────────────────────────────────────────────────────┘  │  ││
│                                                                   │  ││
│  ┌────────────────────────────────────────────────────────────┐  │  ││
│  │              Admin Web UI (React, served static)           │  │  ││
│  └────────────────────────────────────────────────────────────┘  │  ││
└───────────────────────────────────────────────────────────────────┘  ││
                                                                        ││
         Browser OAuth callback ◄──────────────────────────────────────┘│
         obsidian:// protocol handler ◄──────────────────────────────────┘
```

---

## 4. Plugin

### 4.1 What Gets Removed

The following are deleted outright. Nothing replaces them in the plugin.

| File / Symbol | Reason |
|---|---|
| `src/pwManager.ts` | Replaced by OAuth + SecretStorage |
| `PasswordModal` (modals.ts) | No master password prompt |
| `ResetPasswordModal` (modals.ts) | No master password |
| Startup `PasswordModal` call in `main.ts:50–58` | Plugin loads without a password prompt |
| `settings.salt` | No local crypto |
| `SharedTypeSettings.encPw` | Auth is server-side |
| `SharedTypeSettings.signalingServers` | No WebRTC |
| `y-webrtc` npm dependency | Replaced by `y-websocket` |
| `crypto` imports used for password management | No local crypto |
| "Backup Shared Folders" button in settings | Superseded by server-side persistence |
| "Reset Master Password" button in settings | No master password |
| "Copy GUID" context menu item | GUIDs are internal; invite links are the sharing primitive |
| "Copy Password" context menu item | No per-room passwords |

### 4.2 Settings Schema

Settings stored in Obsidian's `data.json` (non-sensitive; safe to sync via Obsidian Sync):

```typescript
interface MultiplayerSettings {
  serverUrl: string;           // e.g. "https://multiplayer.company.com"
  username: string;            // Display name shown over cursor
  sharedFolders: SharedTypeSettings[];
}

interface SharedTypeSettings {
  guid: string;    // Room ID, assigned by server at room creation time
  path: string;    // Local vault-relative path, e.g. "Engineering/Q4 Planning"
  name: string;    // Human-readable room name from server
}
```

Nothing sensitive is stored in settings. Tokens live exclusively in SecretStorage (see §4.4).

### 4.3 Auth Flow — OAuth 2.0 PKCE

The plugin uses the Authorization Code flow with PKCE. No client secret is required — this is the correct flow for a native/desktop app.

**Sign-in sequence:**

```
1. User enters server URL in settings and clicks "Sign in"
2. Plugin generates:
     code_verifier  = random 64-byte base64url string
     code_challenge = base64url(sha256(code_verifier))
     state          = random nonce (CSRF protection)
3. Plugin stores code_verifier and state temporarily (in-memory)
4. Plugin opens browser to:
     GET {serverUrl}/auth/authorize
       ?client_id=obsidian-multiplayer
       &redirect_uri=obsidian://multiplayer/callback
       &response_type=code
       &code_challenge={code_challenge}
       &code_challenge_method=S256
       &state={state}
5. User authenticates in the browser (SSO or local account)
6. Server redirects to:
     obsidian://multiplayer/callback?code={code}&state={state}
7. Plugin's protocol handler fires (registered via registerObsidianProtocolHandler)
8. Plugin validates state matches stored nonce
9. Plugin POSTs to {serverUrl}/auth/token:
     { grant_type: "authorization_code",
       code, code_verifier, client_id, redirect_uri }
10. Server returns { access_token, refresh_token, expires_in, user: { email, name } }
11. Plugin stores tokens in SecretStorage (see §4.4)
12. Plugin updates settings tab: "Signed in as alice@company.com"
```

**Token refresh:**
Before each WebSocket connection, `AuthManager.getAccessToken()` checks token expiry. If within 60 seconds of expiry, it refreshes silently:

```
POST {serverUrl}/auth/token
  { grant_type: "refresh_token", refresh_token, client_id }
→ { access_token, refresh_token, expires_in }
```

If the refresh fails (e.g. refresh token revoked — user deprovisioned), the plugin shows a "Session expired — sign in again" notice and clears stored tokens.

**Sign-out:**
Clears both tokens from SecretStorage. Optionally hits `GET {serverUrl}/auth/logout` to revoke the refresh token server-side.

### 4.4 Secret Storage

Tokens are stored via Obsidian's SecretStorage API. They are scoped to the plugin and vault, and do not appear in `data.json`.

```typescript
// Write
await this.app.vault.adapter.store.setItem('mp-access-token',  accessToken)
await this.app.vault.adapter.store.setItem('mp-refresh-token', refreshToken)
await this.app.vault.adapter.store.setItem('mp-token-expiry',  expiresAt.toISOString())
await this.app.vault.adapter.store.setItem('mp-user-email',    userEmail)
await this.app.vault.adapter.store.setItem('mp-user-name',     userName)

// Read
const token = await this.app.vault.adapter.store.getItem('mp-access-token')

// Clear (sign out)
for (const key of ['mp-access-token', 'mp-refresh-token', 'mp-token-expiry',
                    'mp-user-email', 'mp-user-name']) {
  await this.app.vault.adapter.store.removeItem(key)
}
```

> **Note:** As of Obsidian 1.11.4, SecretStorage persists to LocalStorage (not OS keychain). Encryption via Electron `safeStorage` is planned by the Obsidian team. Tokens should be treated accordingly — they are isolated from settings sync, but not hardware-encrypted yet. Access tokens are short-lived (1 hour); refresh tokens are the more sensitive item.

### 4.5 WebSocket Provider

`y-webrtc` is replaced by `y-websocket` throughout `sharedTypes.ts`. The change is local to `SharedFolder` and `SharedDoc`:

```typescript
import { WebsocketProvider } from 'y-websocket'

// SharedFolder (folder-level metadata doc):
this._provider = new WebsocketProvider(
  `${serverUrl}/room/${settings.guid}`,
  settings.guid,
  this.root,
  { params: { token: await plugin.auth.getAccessToken() } }
)

// SharedDoc (per-file content doc):
this._provider = new WebsocketProvider(
  `${serverUrl}/room/${this.guid}`,
  this.guid,
  this.ydoc,
  { params: { token: await parent.plugin.auth.getAccessToken() } }
)
```

`WebsocketProvider` handles reconnection with exponential backoff natively. No custom reconnection logic needed.

**WebSocket close codes used by server:**

| Code | Meaning | Plugin action |
|---|---|---|
| 4001 | Unauthorized (bad/expired token) | Clear tokens, show "Sign in again" notice |
| 4003 | Forbidden (not a member of this room) | Show notice, remove room from local list |
| 4004 | Room not found | Show notice, remove room from local list |

### 4.6 UI Inventory

#### Deleted

- `PasswordModal`
- `ResetPasswordModal`
- "Backup Shared Folders" settings button
- "Reset Master Password" settings button
- "Copy GUID" context menu item
- "Copy Password" context menu item

#### Kept (logic changes, UI structure unchanged)

- `UnshareFolderModal` — confirmation dialog; underlying cleanup logic updated for new types
- File explorer network icon — keep as-is
- Username setting — keep; display name for cursor awareness

#### Reworked

**`SharedFolderModal`**
Two tabs: Create and Join.

*Create tab:*
```
Room name: [____________________________]
           (the folder name is used as default)

[ Create Room ]
```
On submit: `POST /api/rooms` with `{ name, localPath }` → server returns `{ guid, name }` → creates `SharedFolder` locally.

*Join tab:*
```
Invite link or code: [____________________________]

[ Join Room ]
```
On submit: `POST /api/rooms/join` with `{ token }` → server returns `{ guid, name }` → prompts user to select a local folder path → creates `SharedFolder`.

**Settings tab (`MultiplayerSettingTab`)**

```
Server
  Server URL  [https://___________________]

  ● Signed in as alice@company.com  [Sign Out]
  — or —
  ○ Not signed in  [Sign In]

Collaboration
  Display name  [_______________________]
  (shown over your cursor to other collaborators)

Available rooms  (rooms you have access to but haven't added to this vault)
  ┌─────────────────────────────────────────────────┐
  │  Q4 Planning      Editor    [Add to vault]      │
  │  Engineering Hub  Editor    [Add to vault]      │
  │  Board Docs       Viewer    [Add to vault]      │
  └─────────────────────────────────────────────────┘
```

"Add to vault" opens a folder picker, then creates the `SharedFolder` locally using the existing guid from the server.

**Context menu (right-click on a shared folder)**

```
Delete Multiplayer Shared Folder
─────
Invite to [Room Name] →       (opens InviteModal)
Room members →                (opens MembersModal)
```

#### New

**`InviteModal`**
Opened from the context menu "Invite to [Room Name]" item. Only shown to OWNER and EDITOR roles (checked against locally cached role).

```
┌─ Invite to "Q4 Planning" ─────────────────┐
│                                            │
│  Role:    ● Editor   ○ Viewer             │
│                                            │
│  Expires: [7 days  ▾]                     │
│           (1 day / 7 days / 30 days)      │
│                                            │
│  [ Copy Invite Link ]                     │
└────────────────────────────────────────────┘
```

On "Copy Invite Link": `POST /api/rooms/:guid/invites` → copies returned invite URL to clipboard → shows "Link copied" notice. Invite is single-use by default (v1).

**`MembersModal`**
Opened from "Room members" context menu. Read-only list with a link to the admin panel for changes.

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

**`FileOverwriteWarningModal`**
Shown when a remote sync would create a file that already exists locally with content.

```
┌─ File conflict ─────────────────────────────┐
│                                             │
│  "Engineering/notes.md" already exists in  │
│  your vault with local content.             │
│                                             │
│  Accepting the remote version will          │
│  overwrite your local changes.              │
│                                             │
│  [ Keep local file ]  [ Accept remote ]    │
└─────────────────────────────────────────────┘
```

**`AuthManager` (new source file: `src/auth.ts`)**
Not a UI element, but drives the auth state that all UI surfaces reflect.

```typescript
class AuthManager {
  async signIn(): Promise<void>                        // Starts PKCE flow
  async signOut(): Promise<void>                       // Clears tokens
  async getAccessToken(): Promise<string | null>       // Returns valid token, refreshes if needed
  get isAuthenticated(): boolean
  get userInfo(): { email: string; name: string } | null
  on(event: 'auth-changed', handler: () => void): void // For status bar updates
}
```

### 4.7 Permissions Enforcement in the Editor

After a `SharedDoc` connects, it fetches the user's role for that room:

```typescript
const role = await plugin.api.getMyRole(this.guid)  // GET /api/rooms/:id/me
this._role = role
```

In the `binding` getter, read-only mode is applied for VIEWERs:

```typescript
get binding(): Extension {
  if (!this._binding) {
    const yText = this.ydoc.getText('contents')
    const undoManager = this._role !== 'VIEWER' ? new Y.UndoManager(yText) : undefined
    this._provider.awareness.setLocalStateField('user', { ... })
    this._binding = yCollab(yText, this._provider.awareness, {
      undoManager,
      // y-codemirror.next respects undoManager absence for read-only intent,
      // but CodeMirror's EditorState.readOnly facet must also be set
    })
  }
  return this._binding
}
```

Additionally, for VIEWERs, the CodeMirror `EditorState.readOnly` facet is set to `true` and a "Read only" notice is shown in the editor gutter or via a `Notice`.

### 4.8 Connection Status

A status bar item is added in `main.ts`:

```typescript
const statusBar = this.addStatusBarItem()
```

States:

| State | Display |
|---|---|
| Not signed in | `Multiplayer: not signed in` |
| Connected, all docs synced | `● Multiplayer` |
| Syncing | `⟳ Multiplayer` |
| Disconnected / reconnecting | `○ Multiplayer` |
| Auth error (4001) | `⚠ Multiplayer: sign in again` |

Clicking the status bar item when in "sign in again" state opens the settings tab.

### 4.9 Bug Fixes

These are fixed alongside the pivot work.

**`util.ts:74` — backup restore broken**
`let guid = path[-2]` is invalid JavaScript (always `undefined`). Fix:
```typescript
const parts = path.split('/')
const guid = parts[parts.length - 2]
```

**Extension array leak — `main.ts`**
`extensions.push(sharedDoc.binding)` appends on every file open; `extensions.length = 0` is used on close. This is fragile. Extensions should be tracked per-document and spliced correctly on close.

**File overwrite — `sharedTypes.ts:56–61`**
Before calling `open(fullPath, "w", ...)`, check if the file exists and has content. If so, surface `FileOverwriteWarningModal` and only proceed if the user confirms.

---

## 5. Server

### 5.1 Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | Node.js 20 LTS + TypeScript | Consistent with plugin; y-websocket is Node-native |
| HTTP/WS framework | Fastify | Performance; native WebSocket support via `@fastify/websocket` |
| Yjs sync | `y-websocket` | Drop-in Yjs WebSocket provider |
| Yjs persistence | `y-leveldb` | Already in plugin's package.json; proven for this use case |
| OIDC provider | `node-oidc-provider` | Standards-compliant; supports upstream federation |
| Database | PostgreSQL 16 | Reliable; Prisma ORM for type safety |
| ORM | Prisma | Type-safe schema + migrations |
| Admin UI | React (Vite, bundled as static) | Served directly from server at `/admin` |
| Email | Nodemailer (SMTP) | Invite emails; optional |
| Containerisation | Docker + Docker Compose | Single-command self-hosted deployment |

### 5.2 Project Structure

```
obsidian-multiplayer-server/
├── src/
│   ├── index.ts                 # App bootstrap, plugin registration
│   ├── config.ts                # Config loading (env + config.yaml)
│   ├── auth/
│   │   ├── oidc.ts              # node-oidc-provider setup + upstream federation
│   │   ├── middleware.ts        # JWT validation middleware (Fastify decorator)
│   │   └── upstream.ts          # OIDC + SAML upstream adapter
│   ├── api/
│   │   ├── rooms.ts             # /api/rooms (CRUD + join + members + invites)
│   │   ├── users.ts             # /api/users (self-service: profile, list for invite UI)
│   │   └── admin.ts             # /admin/api/* (requires org ADMIN role)
│   ├── ws/
│   │   ├── handler.ts           # WebSocket route + auth/authz guard
│   │   └── readonly.ts          # Viewer socket wrapper (drops incoming updates)
│   ├── persistence/
│   │   └── yjs.ts               # y-leveldb setup + setPersistence()
│   └── db/
│       ├── schema.prisma
│       └── client.ts
├── admin-ui/                    # React admin frontend (separate Vite project)
│   ├── src/
│   └── dist/                    # Built output, served by server at /admin
├── Dockerfile
├── docker-compose.yml
├── config.example.yaml
├── package.json
└── tsconfig.json
```

### 5.3 Database Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id          String       @id @default(uuid())
  email       String       @unique
  name        String
  // Passwords for local accounts are managed by node-oidc-provider's
  // built-in adapter — not stored here.
  memberships RoomMember[]
  orgRoles    OrgMember[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model Organization {
  id        String      @id @default(uuid())
  name      String
  slug      String      @unique  // Used in URLs
  rooms     Room[]
  members   OrgMember[]
  createdAt DateTime    @default(now())
}

model OrgMember {
  userId String
  orgId  String
  role   OrgRole

  user   User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  org    Organization @relation(fields: [orgId],  references: [id], onDelete: Cascade)

  @@id([userId, orgId])
}

enum OrgRole {
  OWNER
  ADMIN
  MEMBER
}

model Room {
  id        String       @id @default(uuid())  // This is the Yjs room name / GUID
  name      String
  orgId     String
  openToOrg Boolean      @default(false)        // All org members get EDITOR access

  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  members   RoomMember[]
  invites   RoomInvite[]
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
}

model RoomMember {
  userId String
  roomId String
  role   RoomRole

  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  room   Room @relation(fields: [roomId], references: [id], onDelete: Cascade)

  @@id([userId, roomId])
}

enum RoomRole {
  OWNER
  EDITOR
  VIEWER
}

model RoomInvite {
  token     String    @id @default(uuid())
  roomId    String
  role      RoomRole
  expiresAt DateTime
  claimedBy String?   // userId of claimer; null = unclaimed
  createdBy String    // userId of creator
  createdAt DateTime  @default(now())

  room      Room      @relation(fields: [roomId], references: [id], onDelete: Cascade)
}
```

### 5.4 REST API

All `/api/*` routes require a valid JWT (`Authorization: Bearer <token>`). All `/admin/api/*` routes additionally require `OrgRole.ADMIN` or `OrgRole.OWNER`.

#### Auth (served by node-oidc-provider — standard OAuth 2.0 endpoints)

```
GET  /auth/authorize         Authorization endpoint (PKCE)
POST /auth/token             Token exchange and refresh
GET  /auth/userinfo          Current user info (OIDC standard)
GET  /auth/logout            Session logout + optional token revocation
GET  /auth/.well-known/openid-configuration   OIDC discovery
```

#### Rooms

```
POST   /api/rooms
  Body:    { name: string }
  Returns: { guid, name, orgId }
  Notes:   Creator becomes OWNER. Room GUID is the Yjs doc name.

GET    /api/rooms
  Returns: [{ guid, name, role, orgId }]
  Notes:   All rooms the authenticated user is a member of, across all orgs.

GET    /api/rooms/:guid
  Returns: { guid, name, orgId, openToOrg, members: [{ userId, email, name, role }] }

GET    /api/rooms/:guid/me
  Returns: { role: "OWNER" | "EDITOR" | "VIEWER" }
  Notes:   Used by plugin to determine read-only mode.

POST   /api/rooms/join
  Body:    { token: string }
  Returns: { guid, name }
  Notes:   Redeems a RoomInvite token. Marks it claimed. Adds user as member.

POST   /api/rooms/:guid/invites
  Body:    { role: "EDITOR" | "VIEWER", expiresIn: "1d" | "7d" | "30d" }
  Returns: { inviteUrl: string }  // e.g. https://server/join?token=<uuid>
  Auth:    OWNER or EDITOR of the room

DELETE /api/rooms/:guid/invites/:token
  Notes:   Revoke a pending (unclaimed) invite. Admin UI only.

PUT    /api/rooms/:guid/members/:userId
  Body:    { role: "EDITOR" | "VIEWER" }
  Auth:    OWNER of the room. Cannot change own role.

DELETE /api/rooms/:guid/members/:userId
  Auth:    OWNER of the room, or user removing themselves.

DELETE /api/rooms/:guid
  Auth:    OWNER of the room. Deletes room and all Yjs document data.
```

#### Admin

```
GET    /admin/api/users
  Returns: [{ id, email, name, orgRole, createdAt, lastSeen }]

POST   /admin/api/users/invite
  Body:    { email: string, orgRole: "MEMBER" | "ADMIN" }
  Notes:   Sends invite email. Creates a pending User record.

DELETE /admin/api/users/:id
  Notes:   Deactivates user. Does not delete; preserves audit history.

GET    /admin/api/rooms
  Returns: All rooms in the org with member counts.

GET    /admin/api/audit
  Returns: Paginated log of room connections, invite claims, role changes.

GET    /admin/api/config
  Returns: Current server config (OIDC upstreams, org settings).

PUT    /admin/api/config
  Body:    Partial config update (e.g. add/remove OIDC upstream).
  Notes:   Triggers OIDC provider reload; no restart required.
```

### 5.5 WebSocket Handler

```
WS wss://{server}/room/:guid?token={accessToken}
```

Connection lifecycle:

```typescript
fastify.get('/room/:guid', { websocket: true }, async (connection, req) => {
  const { guid } = req.params

  // 1. Validate JWT
  const claims = await verifyJwt(req.query.token)
  if (!claims) {
    connection.socket.close(4001, 'Unauthorized')
    return
  }

  // 2. Resolve effective membership
  //    Direct membership takes precedence over openToOrg.
  const room = await db.room.findUnique({
    where: { id: guid },
    include: { org: true }
  })
  if (!room) {
    connection.socket.close(4004, 'Room not found')
    return
  }

  let role: RoomRole | null = null
  const directMembership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId: claims.sub, roomId: guid } }
  })
  if (directMembership) {
    role = directMembership.role
  } else if (room.openToOrg) {
    const orgMembership = await db.orgMember.findUnique({
      where: { userId_orgId: { userId: claims.sub, orgId: room.orgId } }
    })
    if (orgMembership) role = RoomRole.EDITOR
  }

  if (!role) {
    connection.socket.close(4003, 'Forbidden')
    return
  }

  // 3. Apply viewer guard if needed
  const socket = role === RoomRole.VIEWER
    ? wrapReadonly(connection.socket)
    : connection.socket

  // 4. Hand off to y-websocket
  setupWSConnection(socket, req, { docName: guid, gc: true })
})
```

**Viewer socket wrapper (`ws/readonly.ts`):**
Wraps the raw WebSocket and intercepts incoming messages from the client. Yjs message type `0` (sync) and type `1` (awareness update carrying doc updates) from the client are dropped. Outgoing messages (server → client) are passed through unchanged, so the viewer still receives the full document state.

**JWT validation:**
JWTs are verified using the OIDC provider's public key (fetched once from `/.well-known/jwks.json` at startup and cached). Verification is a local crypto operation — no database call per connection.

### 5.6 Yjs Persistence

`y-leveldb` is configured once at startup. LevelDB stores are keyed by room GUID.

```typescript
import { LeveldbPersistence } from 'y-leveldb'
import { setPersistence, setContentInitializor } from 'y-websocket/bin/utils'
import * as Y from 'yjs'

const persistence = new LeveldbPersistence(process.env.DATA_DIR ?? './data/yjs')

setPersistence({
  bindState: async (docName: string, ydoc: Y.Doc) => {
    const persistedDoc = await persistence.getYDoc(docName)
    const persistedState = Y.encodeStateAsUpdate(persistedDoc)
    Y.applyUpdate(ydoc, persistedState)
    ydoc.on('update', (update: Uint8Array) => {
      persistence.storeUpdate(docName, update)
    })
  },
  writeState: (_docName: string, _ydoc: Y.Doc) => Promise.resolve()
})
```

`DATA_DIR` is mounted as a Docker volume (see §5.9). Documents survive server restarts. Plugin `IndexedDB` persistence is kept as a local cache; the server is the source of truth for peers without local history.

### 5.7 OIDC Provider

`node-oidc-provider` is configured as a standards-compliant OIDC authorization server. It issues JWTs to the plugin and can federate authentication to upstream identity providers.

**Supported upstream identity providers (configured via `config.yaml`):**

| Type | Examples |
|---|---|
| OIDC upstream | Google Workspace, Okta, Azure AD (v2), Keycloak, Authentik |
| SAML 2.0 | Azure AD (SAML), ADFS, any enterprise SAML IdP |
| Local accounts | Email + password (bcrypt), for teams without an enterprise IdP |

Multiple upstreams can be active simultaneously. The auth page shows a button for each configured upstream plus a local login form if local accounts are enabled.

**Token lifetimes:**

| Token | Lifetime |
|---|---|
| Access token | 1 hour |
| Refresh token | 30 days (sliding) |
| Refresh token (inactive) | Expires if unused for 7 days |

**PKCE:**
Required for all plugin clients. The registered client `obsidian-multiplayer` has:
- `token_endpoint_auth_method: 'none'` (public client, no secret)
- `grant_types: ['authorization_code', 'refresh_token']`
- `redirect_uris: ['obsidian://multiplayer/callback']`

**OIDC discovery:**
`GET /.well-known/openid-configuration` is available so that the plugin (and any other OIDC client) can auto-discover all endpoints from just the server base URL.

### 5.8 Admin Web UI

A React single-page app served at `/admin`. Requires authentication (OIDC login via server) and `OrgRole.ADMIN` or `OrgRole.OWNER`.

**Pages:**

| Page | Capabilities |
|---|---|
| Users | List users, invite by email, deactivate, change org role |
| Rooms | List all rooms, view/change members, delete room, view pending invites, revoke invite |
| Identity Providers | Add/edit/remove OIDC and SAML upstream configs; test connection |
| Audit Log | Paginated log: room connections, invite claims, role changes, deactivations |
| Settings | Org name, `openToOrg` default, SMTP config |

The admin UI communicates with `/admin/api/*` routes. It is bundled as static files and served directly by Fastify — no separate web server needed.

### 5.9 Deployment

**Minimum deployment: `docker-compose.yml`**

```yaml
version: "3.9"

services:
  server:
    image: ghcr.io/obsidian-multiplayer/server:latest
    restart: unless-stopped
    environment:
      DATABASE_URL:  postgres://postgres:${POSTGRES_PASSWORD}@db:5432/multiplayer
      DATA_DIR:      /data/yjs
      BASE_URL:      ${BASE_URL}         # https://multiplayer.company.com
      JWT_SECRET:    ${JWT_SECRET}       # random 64-char secret
      SMTP_URL:      ${SMTP_URL}         # optional: smtp://user:pass@host:587
    volumes:
      - yjs-data:/data/yjs
      - ./config.yaml:/app/config.yaml:ro
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB:       multiplayer
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 5

volumes:
  pg-data:
  yjs-data:
```

**`config.yaml` (the only file an admin edits):**

```yaml
org_name: "Acme Corp"

auth:
  local_accounts: true          # Disable once SSO is configured, if desired

  upstream:
    - type: oidc
      id: google
      label: "Sign in with Google"
      issuer: https://accounts.google.com
      client_id: "xxxx.apps.googleusercontent.com"
      client_secret: "xxxx"
      hosted_domain: acme.com   # Restrict to company domain

    - type: oidc
      id: okta
      label: "Sign in with Okta"
      issuer: https://acme.okta.com
      client_id: "xxxx"
      client_secret: "xxxx"

    - type: saml
      id: azure
      label: "Sign in with Microsoft"
      entry_point: https://login.microsoftonline.com/{tenant}/saml2
      cert: |
        -----BEGIN CERTIFICATE-----
        ...
        -----END CERTIFICATE-----
```

**TLS:**
The server listens on port 3000 (HTTP). TLS should be terminated by a reverse proxy in front (nginx, Caddy, Traefik). A Caddy example is included in the repo's `docs/deployment/` directory. Caddy is recommended for its automatic Let's Encrypt certificate management.

**First-run bootstrap:**
On first startup, if no users exist, the server creates an initial admin account and prints the credentials to stdout (one time only). The admin uses these to log into the admin UI and configure their IdP.

---

## 6. Permissions Model

### Roles

Two role scopes exist independently.

**Organisation roles** (`OrgRole`):

| Role | Capabilities |
|---|---|
| `OWNER` | All ADMIN capabilities + transfer/delete org |
| `ADMIN` | Manage users, rooms, IdP config, view audit log |
| `MEMBER` | No administrative capabilities |

**Room roles** (`RoomRole`):

| Role | Read | Write | Invite others | Manage members | Delete room |
|---|---|---|---|---|---|
| `OWNER` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `EDITOR` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `VIEWER` | ✓ | ✗ | ✗ | ✗ | ✗ |

Org `ADMIN`/`OWNER` can manage room memberships for any room in the org via the admin UI, regardless of their room role.

### Membership Resolution

On each WebSocket connection, the server resolves effective membership in this order:

1. **Direct room membership** — explicit `RoomMember` record. Always takes precedence.
2. **Org-open room** — if `Room.openToOrg = true` and user is an org member, they get `EDITOR`.
3. **No access** — connection refused with 4003.

### Default Behaviour

- Joining an org grants no room access by default (`openToOrg = false`).
- Rooms with `openToOrg = true` are suitable for all-hands notes or shared references. This flag is set in the admin UI only.
- Room creators automatically become `OWNER`.

---

## 7. Invitation Flow

**Creating an invite (plugin):**

1. Right-click shared folder → "Invite to [Room Name]"
2. `InviteModal` opens: choose role (Editor / Viewer) and expiry (1/7/30 days)
3. "Copy Invite Link" → `POST /api/rooms/:guid/invites` → server creates `RoomInvite` record and returns `{ inviteUrl }`
4. Invite URL format: `https://server/join?token={uuid}`
5. URL copied to clipboard

**Claiming an invite (new team member):**

1. Recipient receives invite URL (Slack, email, etc.)
2. Opens URL in browser → server presents login page
3. Authenticates via SSO or local account
4. Server validates invite token (not expired, not already claimed)
5. Server creates `RoomMember` record (claimedBy = user.id)
6. Browser shows: "You've been added to [Room Name]. Open in Obsidian?"
7. If user clicks "Open in Obsidian": redirects to `obsidian://multiplayer/join?guid={guid}&name={name}&server={serverUrl}`
8. Plugin receives the protocol handler call, prompts user to select a local folder, creates `SharedFolder`

**Alternatively — plugin "Join" flow:**

The invite URL can also be pasted directly into the "Join" tab of `SharedFolderModal`. The plugin strips the token from the URL and hits `POST /api/rooms/join`.

**Invite constraints (v1):**

- Single-use only (token is marked claimed after first redemption)
- Expiry enforced server-side
- Cannot invite to a role higher than your own (EDITOR cannot create OWNER invites)
- Pending invites can be revoked from the admin UI before they are claimed

---

## 8. Deprovisioning

### SSO-federated users

When a user's account is deactivated in the upstream IdP (Okta, Azure AD, etc.):

1. Their SSO session is terminated by the IdP.
2. They cannot complete a new OAuth flow → cannot get a fresh access token.
3. Existing access tokens expire within 1 hour (the access token lifetime).
4. Refresh tokens fail to refresh (the OIDC provider's upstream check fails).
5. The plugin shows "Session expired — sign in again" and goes offline.

No action required on the server beyond deactivating the upstream account.

### Local account users

Admin deactivates the user in the admin UI (`DELETE /admin/api/users/:id`). The OIDC provider marks the account disabled and refuses new token issuance. Same expiry behaviour as SSO above.

### Immediate revocation

If access must be cut off faster than the 1-hour token lifetime:

- The OIDC provider maintains a token revocation list (standard `node-oidc-provider` behaviour via `oidc.revoke()`).
- Admin deactivation via the admin UI triggers revocation of all outstanding refresh tokens for that user.
- Access tokens remain valid for the remainder of their lifetime (up to 1 hour) — this is inherent to stateless JWTs. If immediate revocation of access tokens is required in future, a short-lived token denylist (Redis or PostgreSQL) can be added.

---

## 9. Implementation Phases

### Phase 1 — Provider Swap (plugin only)
_Goal: Get sync working over WebSocket without auth. Validate the foundation._

- Add `y-websocket` to plugin; remove `y-webrtc`
- Update `SharedTypeSettings` schema (remove `signalingServers`, `encPw`; add `serverUrl`, `name`)
- Replace `WebrtcProvider` with `WebsocketProvider` in `SharedFolder` and `SharedDoc`
- Spin up stock `y-websocket` server locally for testing (no auth)
- Update `SharedFolderModal` to accept a server URL instead of signaling servers
- Verify multi-client sync end-to-end

### Phase 2 — Delete Password Infrastructure (plugin)
_Goal: Remove all custom crypto. Plugin loads without a password prompt._

- Delete `src/pwManager.ts`
- Delete `PasswordModal`, `ResetPasswordModal` from `modals.ts`
- Remove startup `PasswordModal` call from `main.ts`
- Remove `salt`, `encPw` from settings
- Remove "Backup" and "Reset Password" from settings tab
- Remove `crypto` password-related imports

### Phase 3 — Server Foundation
_Goal: Running server with auth-gated WebSocket sync._

- Scaffold `obsidian-multiplayer-server` repo (Fastify + TypeScript)
- PostgreSQL + Prisma schema + initial migrations
- Implement `node-oidc-provider` with local account support only (SSO federation comes later)
- JWT validation middleware
- WebSocket handler with JWT check + room membership check
- `y-leveldb` persistence
- Room CRUD REST API (`POST /api/rooms`, `GET /api/rooms`, `GET /api/rooms/:guid`)
- Docker Compose (server + PostgreSQL)
- Verify plugin can connect with a hardcoded token

### Phase 4 — Plugin OAuth Flow
_Goal: Full sign-in flow. No hardcoded tokens._

- Implement `src/auth.ts` (`AuthManager`)
- Register `obsidian://multiplayer/callback` protocol handler in `main.ts`
- Settings tab: server URL field, "Sign in" / "Sign out" / auth status display
- Token storage in SecretStorage
- Token refresh before WS connect
- Handle WS close codes 4001/4003/4004 with appropriate notices
- Connection status bar item

### Phase 5 — Invitations and Room Management
_Goal: Complete sharing workflow._

- `POST /api/rooms/join` endpoint (server)
- `POST /api/rooms/:guid/invites` endpoint (server)
- `InviteModal` in plugin (role + expiry picker)
- `MembersModal` in plugin (read-only list + link to admin)
- Rework `SharedFolderModal` into Create / Join tabs
- Browser-side invite claim page (simple HTML served by server)
- `obsidian://multiplayer/join` protocol handler (auto-add room to vault)
- "Available rooms" list in settings tab (`GET /api/rooms`)

### Phase 6 — Permissions Enforcement
_Goal: VIEWER role works correctly._

- `GET /api/rooms/:guid/me` endpoint (server)
- Plugin fetches role on connect; sets CodeMirror read-only for VIEWERs
- Viewer socket wrapper on server (drops incoming update messages)
- "Read only" indicator in editor for VIEWERs
- `Room.openToOrg` flag and membership resolution logic

### Phase 7 — SSO Federation
_Goal: Businesses can use their existing IdP._

- OIDC upstream federation in `node-oidc-provider` (Google, Okta, Azure AD)
- SAML 2.0 upstream support
- `config.yaml` parsing for upstream IdP configuration
- Live config reload (no server restart required)
- Admin UI: IdP configuration page with connection test

### Phase 8 — Admin Web UI
_Goal: IT admins can manage users, rooms, and configuration without a CLI._

- Scaffold React admin UI (Vite)
- User management (list, invite, deactivate, org role)
- Room management (list all, members, delete, pending invites)
- Audit log (paginated)
- IdP configuration UI
- Build + bundle into server's static directory

### Phase 9 — Bug Fixes and Polish
_Goal: Production-ready._

- Fix `util.ts:74` backup restore
- `FileOverwriteWarningModal` for remote file conflicts
- Fix extension array management in `main.ts`
- Structured logging (Pino) on server
- Rate limiting on auth and invite endpoints
- Health endpoint (`GET /health`)
- TypeScript strictness improvements (reduce `@ts-expect-error` usage)
- First-run bootstrap (initial admin account)
- Deployment documentation + Caddy example config

---

## 10. Open Questions

These are unresolved decisions to revisit before or during implementation.

| Question | Options | Notes |
|---|---|---|
| Should refresh tokens be rotated on each use? | Yes (more secure) / No (simpler) | `node-oidc-provider` supports rotation; recommended for security |
| Invite link format — server URL or opaque token? | `https://server/join?token=uuid` vs short code | URL is more user-friendly; short code works for non-browser paste into plugin |
| Should `openToOrg` rooms be visible in plugin's "Available rooms" list before the user has ever connected? | Yes / No | Yes is more discoverable; implementation is straightforward |
| Multi-instance server scaling | Redis pub/sub for WS broadcast | Not needed for v1; document as a known limitation |
| Access token denylist for immediate revocation | PostgreSQL denylist / Skip | Skip for v1; document the 1-hour window |
| Should the plugin support multiple server accounts? | Yes / No | Useful for consultants working across client orgs; significant complexity. Defer. |
| Mobile (iOS/Android) support | `obsidian://` protocol handler availability on mobile | Needs investigation. The WebSocket provider works; OAuth callback may not. |
| E2E encryption of Yjs updates | Encrypt before sending to server | Server would not see plaintext. Complex; breaks server-side persistence and audit. Significant future work. |
