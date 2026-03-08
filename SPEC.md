# Obsidian Multiplayer — Technical Specification

**Status:** Draft
**Last updated:** 2026-03-07

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
   - 5.10 [SCIM 2.0 Provisioning API](#510-scim-20-provisioning-api)
   - 5.11 [Session Management](#511-session-management)
   - 5.12 [Audit Log](#512-audit-log)
6. [Permissions Model](#6-permissions-model)
7. [Invitation Flow](#7-invitation-flow)
8. [Deprovisioning](#8-deprovisioning)
9. [Implementation Phases](#9-implementation-phases)
10. [Open Questions](#10-open-questions)

---

## 1. Goals

Obsidian Multiplayer enables real-time collaborative editing of notes directly inside Obsidian. The objective is to be **the obvious self-hosted solution for enterprises with real IT requirements** — organisations that cannot use a SaaS collaborative tool due to data sovereignty, compliance, or security policy.

The primary customer is a corporate IT or security team that needs to deploy and operate a collaboration backend inside their own perimeter, integrate it with their existing identity infrastructure, and satisfy their security and audit requirements without depending on any external vendor's uptime, trust, or compliance posture.

### Design Principles

- **Self-hostable, air-gap friendly.** The entire stack runs on company infrastructure with `docker compose up`. The server makes zero outbound calls to any external service after initial deployment. No telemetry, no license checks, no cloud dependency.
- **Corporate identity is the only identity.** SSO via OIDC or SAML is the primary authentication path. Local accounts are an optional fallback for bootstrapping only; IT can disable them entirely once SSO is configured. There are no email-and-password sign-ups.
- **Provisioning and deprovisioning through standard tooling.** SCIM 2.0 support means user lifecycle is managed by the company's existing IdP (Okta, Azure AD, etc.) — not by manual admin actions. When a user's corporate account is deprovisioned, their access is terminated automatically.
- **IT-managed access control.** Room membership can be derived from corporate directory groups. IT can manage who has access to what without depending on end-users to send invite links.
- **Audit trail for everything.** All security-relevant events are logged with actor, timestamp, and IP — and can be exported to a company's SIEM. IT can prove who accessed what document and when.
- **Immediate revocation.** When a user is deprovisioned or a security incident occurs, their access is terminated within seconds — not after the next token refresh cycle.
- **Enforce permissions server-side.** The client cannot be trusted. All access control is enforced by the server at the WebSocket connection and REST API level.
- **Minimal plugin UI surface.** The Obsidian plugin is for writing, not administration. Room permissions, user management, and IdP configuration live in an admin web UI, not the plugin.
- **No custom cryptography.** The hand-rolled AES-256-GCM password system is replaced entirely by OAuth 2.0 and the Obsidian SecretStorage API.

### Non-Goals (v1)

- Mobile (iOS/Android) support — WebSocket works but OAuth protocol handler may not; defer.
- End-to-end encryption of document content — the server sees plaintext Yjs updates. Viable future addition once auth is solid.
- Fine-grained per-paragraph permissions.
- Obsidian Publish integration.
- Consumer or prosumer onboarding flows (email sign-up, credit card, self-serve billing).
- Local accounts as a primary authentication mode — supported only as a bootstrapping mechanism before SSO is configured.

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

> **Architecture decision: single server per vault.**  `serverUrl` is a vault-level
> setting, not per-folder. All shared folders and documents within a vault connect to
> the same server. This simplifies authentication (one token set per vault), the
> settings UI, and the WebSocket provider wiring (`${serverUrl}/room/${guid}`).
> Users who need rooms on different servers should use separate Obsidian vaults.

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
  id             String        @id @default(uuid())
  email          String        @unique
  name           String
  externalId     String?       @unique  // IdP subject claim (for SCIM correlation)
  deactivatedAt  DateTime?              // set on SCIM deprovision; blocks new sessions
  // Passwords for local accounts are managed by node-oidc-provider's
  // built-in adapter — not stored here.
  memberships    RoomMember[]
  orgRoles       OrgMember[]
  groupMemberships GroupMember[]
  sessions       Session[]
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
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

// SCIM bearer tokens, issued to the IdP for automated provisioning
model ScimToken {
  id          String    @id @default(uuid())
  description String                         // e.g. "Okta provisioning token"
  tokenHash   String    @unique              // bcrypt hash of the raw token
  createdAt   DateTime  @default(now())
  lastUsedAt  DateTime?
  revokedAt   DateTime?
}

// IdP group → org-level group mapping for group-based room access
model DirectoryGroup {
  id          String              @id @default(uuid())
  externalId  String              @unique  // Group ID from IdP (SCIM externalId)
  displayName String
  roomLinks   GroupRoomAccess[]
  members     GroupMember[]
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
}

model GroupMember {
  userId  String
  groupId String
  user    User           @relation(fields: [userId],  references: [id], onDelete: Cascade)
  group   DirectoryGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@id([userId, groupId])
}

model GroupRoomAccess {
  groupId String
  roomId  String
  role    RoomRole

  group   DirectoryGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  room    Room           @relation(fields: [roomId],  references: [id], onDelete: Cascade)

  @@id([groupId, roomId])
}

// Audit log — append-only, never updated or deleted
model AuditEvent {
  id         String    @id @default(uuid())
  occurredAt DateTime  @default(now())
  actorId    String?   // userId; null for system/SCIM events
  actorEmail String?   // denormalized for readability after user deletion
  actorIp    String?
  event      AuditEventType
  resourceType String  // "room" | "user" | "org" | "session" | "invite" | "scim"
  resourceId String?
  detail     Json?     // event-specific payload (old/new values, etc.)
}

enum AuditEventType {
  USER_CREATED
  USER_DEACTIVATED
  USER_REACTIVATED
  USER_ORG_ROLE_CHANGED
  SESSION_CREATED
  SESSION_TERMINATED          // admin-initiated forced sign-out
  ROOM_CREATED
  ROOM_DELETED
  ROOM_MEMBER_ADDED
  ROOM_MEMBER_REMOVED
  ROOM_MEMBER_ROLE_CHANGED
  INVITE_CREATED
  INVITE_CLAIMED
  INVITE_REVOKED
  SCIM_USER_PROVISIONED
  SCIM_USER_DEPROVISIONED
  SCIM_GROUP_SYNCED
  IDP_CONFIG_CHANGED
  SSO_ENFORCEMENT_CHANGED
}

// Active sessions — used for immediate revocation and session listing in admin UI
model Session {
  id           String    @id @default(uuid())
  userId       String
  refreshTokenHash String @unique            // bcrypt hash of the issued refresh token
  createdAt    DateTime  @default(now())
  lastSeenAt   DateTime  @default(now())
  ipAddress    String?
  userAgent    String?
  revokedAt    DateTime?                     // set on forced sign-out or SCIM deprovision

  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
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
  Returns: [{ id, email, name, orgRole, createdAt, lastSeen, deactivatedAt }]

POST   /admin/api/users
  Body:    { email: string, name: string, orgRole: "MEMBER" | "ADMIN" }
  Notes:   Creates a local-account user. Primary path for non-SCIM setups only.

PATCH  /admin/api/users/:id
  Body:    { orgRole?, deactivated? }
  Notes:   Change org role or deactivate. Deactivation revokes all active sessions.

GET    /admin/api/users/:id/sessions
  Returns: [{ id, createdAt, lastSeenAt, ipAddress, userAgent, revokedAt }]
  Notes:   All sessions for a user (active and revoked).

DELETE /admin/api/users/:id/sessions/:sessionId
  Notes:   Force-terminate a specific session. Issues revocation; blocks refresh.

DELETE /admin/api/users/:id/sessions
  Notes:   Force-terminate ALL sessions for a user. Used on security incidents.

GET    /admin/api/rooms
  Returns: All rooms in the org with member counts.

GET    /admin/api/groups
  Returns: [{ id, externalId, displayName, memberCount, roomLinks }]
  Notes:   Directory groups synced from IdP via SCIM.

POST   /admin/api/groups/:id/room-access
  Body:    { roomId: string, role: "EDITOR" | "VIEWER" }
  Notes:   Grant a directory group access to a room at the specified role.

DELETE /admin/api/groups/:id/room-access/:roomId
  Notes:   Remove a group's access to a room.

GET    /admin/api/audit
  Query:   ?page&limit&event&actorId&resourceId&from&to
  Returns: Paginated AuditEvent records, newest first.

GET    /admin/api/audit/export
  Query:   ?format=csv|jsonl&from&to&event
  Returns: Streamed export of audit events. Used for SIEM ingestion / compliance reports.

GET    /admin/api/config
  Returns: Current server config (OIDC upstreams, org settings, SSO enforcement).

PUT    /admin/api/config
  Body:    Partial config update (e.g. add/remove OIDC upstream, toggle SSO enforcement).
  Notes:   Triggers OIDC provider reload; no restart required.

GET    /admin/api/scim/tokens
  Returns: [{ id, description, createdAt, lastUsedAt, revokedAt }]
  Notes:   Lists SCIM bearer tokens (never returns raw token value).

POST   /admin/api/scim/tokens
  Body:    { description: string }
  Returns: { id, token }  — raw token shown once only; store it in the IdP.

DELETE /admin/api/scim/tokens/:id
  Notes:   Revoke a SCIM token.
```

#### SCIM 2.0 (see §5.10 for full spec)

```
GET    /scim/v2/ServiceProviderConfig
GET    /scim/v2/Schemas
GET    /scim/v2/ResourceTypes

GET    /scim/v2/Users
POST   /scim/v2/Users
GET    /scim/v2/Users/:id
PUT    /scim/v2/Users/:id
PATCH  /scim/v2/Users/:id
DELETE /scim/v2/Users/:id

GET    /scim/v2/Groups
POST   /scim/v2/Groups
GET    /scim/v2/Groups/:id
PUT    /scim/v2/Groups/:id
PATCH  /scim/v2/Groups/:id
DELETE /scim/v2/Groups/:id
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
| Local accounts | Email + password (bcrypt), bootstrap only — disabled by default once SSO is configured |

Multiple upstreams can be active simultaneously. The auth page shows a button for each configured upstream plus, if enabled, a local login form.

**SSO enforcement mode:**
When `auth.sso_required: true` is set in `config.yaml` (or toggled in the admin UI), local account login is disabled entirely. Any user without a valid SSO session cannot authenticate. This is the expected state for a production corporate deployment. SSO enforcement is logged as an audit event every time it changes.

**Group sync from upstream IdP:**
When a SCIM 2.0 provisioner is configured (see §5.10), group membership flows from the IdP into `DirectoryGroup` / `GroupMember` tables automatically. Room access can then be granted to a group, meaning IT only manages group membership in their IdP — not in this system.

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
| Users | List users with SSO status; deactivate; change org role; view and force-terminate active sessions |
| Rooms | List all rooms; view/change members; assign directory groups; delete room; revoke pending invites |
| Groups | View directory groups synced from IdP; assign groups to rooms at a given role |
| Identity Providers | Add/edit/remove OIDC and SAML upstream configs; test connection; enable/disable SSO enforcement |
| Provisioning (SCIM) | Generate and revoke SCIM bearer tokens; view last sync timestamp; view provisioning event history |
| Audit Log | Paginated, filterable log of all security events; export to CSV or JSONL for SIEM ingestion |
| Sessions | View all active sessions org-wide; filter by user; force-terminate individual sessions or all sessions for a user |
| Settings | Org name, `openToOrg` default, SSO enforcement toggle, TLS and network policy config |

The admin UI communicates with `/admin/api/*` routes. It is bundled as static files and served directly by Fastify — no separate web server needed.

> **No SMTP dependency.** Email invite delivery is not a core feature. Corporate users are onboarded via SCIM or by an admin distributing invite links through existing internal channels (Slack, email, Confluence, etc.). SMTP configuration is optional and only used if the admin explicitly enables email delivery for invite links.

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
The server listens on port 3000 (HTTP). TLS should be terminated by a reverse proxy in front (nginx, Caddy, Traefik). For internal corporate deployments using a private PKI (internal CA), nginx or Traefik are recommended — Caddy's Let's Encrypt automation is only useful if the server is internet-reachable. Deployment docs include examples for both public TLS (Caddy) and internal CA (nginx).

Minimum TLS version: 1.2. Configurable via `tls.min_version` in `config.yaml`. Recommended: TLS 1.3 only for high-security deployments.

**Network isolation:**
The server makes zero outbound connections after startup, with the following exceptions:
- Fetching JWKS from upstream OIDC providers (only if OIDC federation is configured). This can be disabled by providing the IdP's public key directly in `config.yaml`, enabling fully air-gapped operation.
- SAML metadata refresh (only if SAML upstream is configured). Can be disabled by providing static metadata.

All network behaviour is documented in `docs/deployment/network-policy.md` with example Kubernetes NetworkPolicy and firewall rule sets.

**Container image provenance:**
The Docker image is built and signed via GitHub Actions. The image digest and SBOM are published with each release so IT teams can verify integrity before deployment.

**First-run bootstrap:**
On first startup, if no users exist, the server creates an initial admin account and prints the credentials to stdout (one time only). The admin uses these to log into the admin UI and configure their IdP. Once SSO is configured, the local admin account can be deactivated.

### 5.10 SCIM 2.0 Provisioning API

SCIM 2.0 (RFC 7644) allows an enterprise IdP (Okta, Azure AD, etc.) to automatically provision and deprovision users and groups. This eliminates the need for manual user management at scale and ensures that when someone leaves the company, their access is revoked automatically and promptly.

**Authentication:**
SCIM endpoints use HTTP Bearer token authentication. Tokens are generated in the admin UI and stored as a bcrypt hash in `ScimToken`. The raw token is shown once at creation time — the admin copies it into their IdP's provisioning configuration.

```
Authorization: Bearer <scim-token>
```

**Supported operations:**

| Resource | Create | Read | Update | Deactivate | Delete |
|---|---|---|---|---|---|
| User | ✓ | ✓ | ✓ (name, email) | ✓ (`active: false`) | ✓ |
| Group | ✓ | ✓ | ✓ (name, members) | — | ✓ |

**User provisioning:**
When the IdP provisions a user (`POST /scim/v2/Users`), a `User` record is created with `externalId` set to the IdP's subject. If the user already exists by email, the records are linked (not duplicated).

**User deprovisioning:**
When the IdP deprovisions a user (`PATCH /scim/v2/Users/:id` with `active: false`, or `DELETE`):
1. `User.deactivatedAt` is set to `now()`.
2. All `Session` records for the user have `revokedAt` set — blocking any further refresh token use.
3. The OIDC provider's refresh token store is cleared for the user.
4. An `AuditEvent` of type `SCIM_USER_DEPROVISIONED` is written.

Result: the user is locked out within the access token lifetime (1 hour) with no manual intervention. The short (1h) access token lifetime combined with the session revocation means effective lockout happens when the access token expires naturally — or immediately if the token denylist is enabled (see §5.11).

**Group sync:**
Groups pushed by the IdP populate `DirectoryGroup` and `GroupMember`. Group membership in a room is configured in the admin UI (`GroupRoomAccess`). The membership resolution on each WebSocket connection includes group-derived access (after direct membership, before open-to-org).

**Membership resolution order (updated):**
1. Direct `RoomMember` record (highest priority)
2. Group-derived access: user is in a `DirectoryGroup` that has a `GroupRoomAccess` for this room
3. `Room.openToOrg = true`: all org members get EDITOR
4. No access → 4003

**IdP compatibility:**
Tested and documented configurations for: Okta, Azure AD / Entra ID, Google Workspace (via third-party SCIM bridge), OneLogin, Jumpcloud.

### 5.11 Session Management

Session records track all issued refresh tokens. This enables two critical capabilities: session listing (visibility) and forced termination (control).

**Token denylist:**
Every WebSocket connection and API call validates the access token's JWT claims locally. Additionally, if a session has `revokedAt` set, any refresh attempt is rejected immediately. For access tokens (which are stateless JWTs), a per-session denylist entry in the `Session` table means that after revocation, any API call or WS reconnect that triggers a token refresh will fail — locking the user out within one request cycle, not one token lifetime.

> **Implementation note:** At WebSocket connect time, in addition to JWT signature verification, the server checks that a non-revoked `Session` exists for the `jti` (JWT ID) claim. Access tokens include a `sessionId` claim that maps to `Session.id`. This eliminates the 1-hour window.

**Admin session termination:**
From the admin UI Sessions page, an admin can:
- View all active sessions for any user (IP address, user agent, last seen)
- Terminate a specific session (sets `Session.revokedAt`, triggers access token denylist)
- Terminate all sessions for a user (used for suspected account compromise)

Session termination is logged as `SESSION_TERMINATED` in the audit log.

### 5.12 Audit Log

The audit log is append-only and stores all security-relevant events. It is never modified or deleted after the fact. Retention is configurable (default: 2 years).

**Event schema (mirrors `AuditEvent` Prisma model):**

```typescript
interface AuditEvent {
  id:           string             // uuid
  occurredAt:   string             // ISO 8601
  actorId:      string | null      // userId; null for system/SCIM events
  actorEmail:   string | null      // denormalized — survives user deletion
  actorIp:      string | null
  event:        AuditEventType
  resourceType: string
  resourceId:   string | null
  detail:       Record<string, unknown> | null  // event-specific payload
}
```

**SIEM export:**
`GET /admin/api/audit/export?format=jsonl&from=2026-01-01&to=2026-03-07`
Returns newline-delimited JSON, one event per line. This format is directly ingestible by Splunk, Elastic, Datadog, and most other SIEM tools. Can be scheduled as a cron job or pulled by a log shipper.

**Retention:**
Configurable via `audit.retention_days` in `config.yaml`. Default: 730 days (2 years). A background job runs nightly and deletes records older than the retention window. Deletion is itself logged as a system event.

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
2. **Group-derived access** — user is a member of a `DirectoryGroup` that has a `GroupRoomAccess` record for this room. The role from `GroupRoomAccess.role` is used. If the user is in multiple groups with different roles, the highest-privilege role wins.
3. **Org-open room** — if `Room.openToOrg = true` and user is an org member, they get `EDITOR`.
4. **No access** — connection refused with 4003.

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

### SCIM-provisioned users (primary path)

When a user's account is deprovisioned in the IdP (Okta, Azure AD, etc.), the IdP's SCIM client calls `PATCH /scim/v2/Users/:id` (with `active: false`) or `DELETE /scim/v2/Users/:id`. The server:

1. Sets `User.deactivatedAt`.
2. Revokes all active `Session` records for the user (sets `revokedAt`).
3. Writes a `SCIM_USER_DEPROVISIONED` audit event.

Because the session denylist is checked on every WebSocket connect and refresh attempt, the user is effectively locked out immediately — they cannot reconnect after their current connection drops, and cannot refresh their access token.

The SSO session at the IdP level is simultaneously terminated by the IdP itself (standard SCIM deprovisioning behaviour). The user cannot complete a new OAuth flow.

### Manual deprovisioning (admin UI)

For urgent cases (suspected compromise, termination without advance IdP action), an admin can:

1. Navigate to Users → select user → "Deactivate and terminate all sessions"
2. This is equivalent to the SCIM path above: sets `deactivatedAt`, revokes all sessions, logs `USER_DEACTIVATED`.

### Local account users

Admin deactivates via the admin UI. The OIDC provider marks the account disabled and refuses new token issuance. Session revocation applies as above.

### Immediate revocation guarantee

All deprovisioning paths (SCIM, manual admin, session termination) revoke sessions synchronously. The `sessionId` claim in access tokens is checked against the `Session` table on every protected request. A revoked session means the next WebSocket reconnect or API call that requires a fresh token will fail — eliminating the 1-hour window that stateless JWTs would otherwise create.

This is a **requirement**, not an optional future enhancement.

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
- PostgreSQL + Prisma schema + initial migrations (includes `Session`, `AuditEvent`, `ScimToken`, `DirectoryGroup` tables)
- Implement `node-oidc-provider` with local account support (SSO bootstrap only)
- JWT validation middleware with `sessionId` claim check against `Session` table
- WebSocket handler with JWT check + room membership check (all four resolution steps)
- `y-leveldb` persistence
- Room CRUD REST API (`POST /api/rooms`, `GET /api/rooms`, `GET /api/rooms/:guid`)
- Docker Compose (server + PostgreSQL)
- Audit log: write `ROOM_CREATED`, `ROOM_MEMBER_ADDED` events from day 1
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
- Audit log: `SESSION_CREATED` on sign-in

### Phase 5 — SSO Federation + SSO Enforcement
_Goal: Businesses connect their existing IdP and disable local accounts._

- OIDC upstream federation in `node-oidc-provider` (Okta, Azure AD, Google Workspace)
- SAML 2.0 upstream support (Azure AD SAML, ADFS)
- `config.yaml` parsing for upstream IdP configuration
- Live config reload (no server restart required)
- SSO enforcement mode: `auth.sso_required: true` disables local account login
- Admin UI: IdP configuration page with connection test; SSO enforcement toggle
- Audit log: `IDP_CONFIG_CHANGED`, `SSO_ENFORCEMENT_CHANGED`

### Phase 6 — SCIM 2.0 Provisioning
_Goal: User and group lifecycle managed automatically by the IdP._

- `/scim/v2/Users` — full CRUD + `active: false` deprovisioning
- `/scim/v2/Groups` — full CRUD; syncs `DirectoryGroup` + `GroupMember` tables
- SCIM bearer token management (admin UI: generate, list, revoke)
- User deprovisioning: set `deactivatedAt`, revoke all sessions, write audit event
- Group-based room access: `GroupRoomAccess` table; membership resolution includes group step
- Admin UI: Provisioning page (token management, last sync time, event history)
- Audit log: `SCIM_USER_PROVISIONED`, `SCIM_USER_DEPROVISIONED`, `SCIM_GROUP_SYNCED`
- Tested configurations for Okta, Azure AD / Entra ID in `docs/deployment/scim/`

### Phase 7 — Session Management + Immediate Revocation
_Goal: IT can terminate any user's access within seconds, not hours._

- `Session` table tracks all issued refresh tokens (created at token issue time)
- Access tokens include `sessionId` claim; checked against `Session.revokedAt` on every request
- Admin UI: Sessions page — list active sessions, terminate individual, terminate all for a user
- Manual deprovision flow: "Deactivate and terminate all sessions" in Users admin page
- Audit log: `SESSION_TERMINATED`, `USER_DEACTIVATED`

### Phase 8 — Admin Web UI (full)
_Goal: IT admins can manage everything without a CLI._

- Scaffold React admin UI (Vite)
- Users: list, deactivate, change org role, view sessions, force-terminate sessions
- Rooms: list all, view/change members, assign directory groups, delete, manage invites
- Groups: view SCIM-synced groups, assign to rooms
- Identity Providers: add/edit/remove OIDC and SAML upstreams, test connection
- Provisioning: SCIM token management, sync status
- Audit Log: paginated, filterable; export to CSV/JSONL
- Sessions: org-wide session list, per-user session termination
- Build + bundle into server's static directory

### Phase 9 — Invitations and Room Management (plugin)
_Goal: End-users can share rooms without involving IT for basic workflows._

- `POST /api/rooms/join` endpoint (server)
- `POST /api/rooms/:guid/invites` endpoint (server)
- `InviteModal` in plugin (role + expiry picker)
- `MembersModal` in plugin (read-only list + link to admin)
- Rework `SharedFolderModal` into Create / Join tabs
- Browser-side invite claim page (simple HTML served by server)
- `obsidian://multiplayer/join` protocol handler (auto-add room to vault)
- "Available rooms" list in settings tab (`GET /api/rooms`)

### Phase 10 — Permissions Enforcement
_Goal: VIEWER role works correctly._

- `GET /api/rooms/:guid/me` endpoint (server)
- Plugin fetches role on connect; sets CodeMirror read-only for VIEWERs
- Viewer socket wrapper on server (drops incoming update messages)
- "Read only" indicator in editor for VIEWERs
- `Room.openToOrg` flag and membership resolution logic (all four steps)

### Phase 11 — Hardening and Operations
_Goal: Production-grade observability, security, and deployability._

- Fix `util.ts:74` backup restore
- `FileOverwriteWarningModal` for remote file conflicts
- Fix extension array management in `main.ts`
- Structured logging (Pino) with correlation IDs on server
- Rate limiting on auth, invite, and SCIM endpoints
- Health endpoint (`GET /health`) with database and LevelDB connectivity checks
- Metrics endpoint (`GET /metrics`) in Prometheus format — for corporate monitoring
- TypeScript strictness improvements
- First-run bootstrap (initial admin account)
- TLS minimum version configuration
- Network isolation documentation (`docs/deployment/network-policy.md`) with Kubernetes NetworkPolicy and firewall examples
- Container image signing and SBOM publication
- Deployment documentation: Caddy (public TLS), nginx (internal CA), Kubernetes helm chart skeleton

---

## 10. Open Questions

Resolved decisions are included for rationale. Genuinely open items are marked **Open**.

| Question | Decision | Rationale |
|---|---|---|
| Should refresh tokens be rotated on each use? | **Yes** | `node-oidc-provider` supports rotation natively. Rotating tokens limit the blast radius of a stolen refresh token to a single use. Required for enterprise security posture. |
| Invite link format | **`https://server/join?token=uuid`** | URL is directly clickable. Users can also paste it into the plugin's Join tab. |
| Should `openToOrg` rooms appear in "Available rooms" before the user connects? | **Yes** | More discoverable; implementation is straightforward. |
| Multi-instance server scaling | **Document as limitation in v1** | Requires Redis pub/sub for WS broadcast. Not needed for most enterprise deployments (single instance handles thousands of concurrent users). Document clearly; implement when a customer needs it. |
| Access token denylist for immediate revocation | **Required — implemented via `Session` table** | Enterprise deprovisioning cannot wait up to 1 hour. The `sessionId` claim in access tokens is checked against `Session.revokedAt` on every protected request. This is not optional. |
| Should the plugin support multiple server accounts? | **No (v1)** | Significant complexity. The target user has one corporate account. Defer indefinitely unless a clear enterprise use case emerges. |
| Mobile (iOS/Android) support | **Non-goal** | `obsidian://` protocol handler may not work on mobile. The WebSocket provider would work but the OAuth flow is uncertain. Defer. |
| E2E encryption of Yjs updates | **Non-goal (v1)** | Server sees plaintext — required for server-side persistence and audit. The security model is: the server is inside the corporate perimeter and trusted. E2E encryption would break audit and conflict resolution. Document this explicitly. |
| **Open:** Audit log retention enforcement | **Open** | Default 2 years. Should retention be configurable per-event-type (e.g., longer for `USER_DEACTIVATED`)? Probably not needed for v1. |
| **Open:** SIEM push vs pull | **Open** | Current design is pull (admin exports or schedules a cron). Should we add a webhook or syslog push mode? Many enterprises prefer push. Consider for v1 if early customers request it. |
| **Open:** Kubernetes-native deployment | **Open** | Docker Compose is sufficient for many enterprise deployments. A Helm chart would help larger orgs. Skeleton provided in Phase 11; full chart deferred. |
