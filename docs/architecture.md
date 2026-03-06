# Obsidian Multiplayer: Architecture & Design

**Status:** Working draft — reconciled from two design threads (2026-03-06)
**Source branches:** `claude/design-p2p-auth-7iQxL`, `claude/evaluate-websocket-pivot-c8rGG`

---

## Goals

- Real-time collaborative editing across Obsidian vaults
- Production-ready for teams in a business context
- **Self-hostable first**: a single `docker compose up` deploys the full stack with no dependency on any cloud service
- Enterprise SSO (Google, Okta, Azure AD, SAML) out of the box
- Free/open source server; commercially licensable for managed hosting

---

## Transport Layer

### Decision: WebSocket only (y-webrtc removed)

`y-webrtc` is replaced by `y-websocket` throughout the plugin. The hybrid transport approach (WebRTC + WebSocket simultaneously) was considered but rejected for this phase:

- WebRTC requires signaling infrastructure that duplicates the server's role
- The WebSocket relay already handles reconnection and state persistence
- Hybrid mode adds complexity without a compelling latency benefit in practice (local-network peers are uncommon for this use case)
- `WebsocketProvider` handles reconnection with exponential backoff natively

`y-indexeddb` is retained as a local cache. It is not the source of truth; the server is.

### Why not pure WebRTC?

Pure P2P cannot bootstrap a document when no peers are online. The server solves this by persisting Yjs update history (`y-leveldb`) and delivering it on connect.

---

## Server Architecture

### Stack

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | Node.js 20 LTS + TypeScript | Consistent with plugin; y-websocket is Node-native |
| HTTP/WS framework | Fastify | Performance; native WebSocket via `@fastify/websocket` |
| Yjs sync | `y-websocket` | Drop-in Yjs WebSocket provider |
| Yjs persistence | `y-leveldb` | Proven for this use case; no external dependency |
| Auth | `node-oidc-provider` | Standards-compliant; supports upstream federation |
| Database | PostgreSQL 16 + Prisma | Type-safe schema + migrations |
| Admin UI | React (Vite, served as static at `/admin`) | |
| Containerisation | Docker + Docker Compose | Single-command self-hosted deployment |

### Self-Hosting vs. Managed Hosting

The default deployment target is **self-hosted**. A `docker-compose.yml` ships with the server repo and is the primary deployment path.

A managed hosted instance is a future commercial offering built on top of the same open source server. This is the reverse of the Cloudflare-hosted-first approach considered earlier — the open source, self-hostable server comes first, and a managed tier (whether on Cloudflare Workers/Durable Objects or a traditional VPS) is layered on top.

> **Open question**: If a managed hosted tier is built on Cloudflare Workers + Durable Objects rather than a conventional VPS, the server codebase may need a separate Cloudflare-specific adapter (Durable Objects do not run Node.js). This would be a separate implementation target, not a replacement for the Docker-based server.

---

## Authentication

### Flow: OAuth 2.0 Authorization Code + PKCE

```
Plugin (Obsidian)               Auth Server (node-oidc-provider)
        |                                     |
        |-- open browser to /auth/authorize ->|
        |                                     |-- (user logs in via SSO or local)
        |<-- obsidian://multiplayer/callback -|
        |-- POST /auth/token (+ code_verifier)|
        |<-- { access_token, refresh_token } -|
        |                                     |
        |-- WS /room/:guid?token=<jwt> ------>| (relay validates JWT, checks membership)
```

The plugin is a public OIDC client (`token_endpoint_auth_method: none`, no client secret). PKCE is required.

### Token Lifecycle

| Token | Lifetime |
|---|---|
| Access token | 1 hour |
| Refresh token | 30 days sliding; expires if unused for 7 days |

Tokens are stored in Obsidian's SecretStorage (`vault.adapter.store`), not in `data.json`. They do not appear in Obsidian Sync.

Silent refresh: `getAccessToken()` refreshes automatically when the access token is within 60 seconds of expiry. On refresh failure, tokens are cleared and the user is prompted to sign in again.

### Identity Providers

Configured via `config.yaml` on the server. Multiple upstreams can be active simultaneously.

| Type | Examples |
|---|---|
| OIDC upstream | Google Workspace, Okta, Azure AD (v2), Keycloak, Authentik |
| SAML 2.0 | Azure AD (SAML), ADFS, enterprise SAML IdPs |
| Local accounts | Email + password (bcrypt); for teams without an enterprise IdP |

---

## Permissions Model

### Two Role Scopes

**Organisation roles** (`OrgRole`) — administrative access:

| Role | Capabilities |
|---|---|
| `OWNER` | All ADMIN capabilities + transfer/delete org |
| `ADMIN` | Manage users, rooms, IdP config, view audit log |
| `MEMBER` | No administrative capabilities |

**Room roles** (`RoomRole`) — per-room access:

| Role | Read | Write | Invite others | Manage members | Delete room |
|---|---|---|---|---|---|
| `OWNER` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `EDITOR` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `VIEWER` | ✓ | ✗ | ✗ | ✗ | ✗ |

Org `ADMIN`/`OWNER` can manage any room in the org via the admin UI regardless of their room role.

### Membership Resolution (server-side, per WebSocket connection)

1. **Direct room membership** — explicit `RoomMember` record. Always takes precedence.
2. **Org-open room** — if `Room.openToOrg = true` and user is an org member, they get `EDITOR`.
3. **No access** — connection refused with WS close 4003.

### WebSocket Close Codes

| Code | Meaning | Plugin action |
|---|---|---|
| 4001 | Unauthorized (bad/expired token) | Clear tokens, show "Sign in again" |
| 4003 | Forbidden (not a member) | Remove room from local list, show notice |
| 4004 | Room not found | Remove room from local list, show notice |

### VIEWER Enforcement

Server-side: the WebSocket handler wraps the socket for VIEWERs, dropping incoming Yjs update messages. The server never accepts writes from VIEWERs regardless of client behaviour.

Plugin-side: `SharedDoc` fetches the user's role after each connect (`GET /api/rooms/:guid/me`) and applies CodeMirror's `EditorState.readOnly` facet for VIEWERs. This is a UX guard; the server is authoritative.

---

## Invitation Flow

**Creating an invite (plugin):**

1. Right-click shared folder → "Invite to [Room Name]"
2. `InviteModal`: choose role (Editor / Viewer) and expiry (1 / 7 / 30 days)
3. "Copy Invite Link" → `POST /api/rooms/:guid/invites` → server returns `{ inviteUrl }`
4. Invite URL format: `https://server/join?token={uuid}`
5. URL copied to clipboard

Invites are single-use. They contain no cryptographic key material (see E2E encryption discussion below). The token is a server-side lookup for a `RoomInvite` record.

**Claiming (new team member, browser flow):**

1. Recipient opens invite URL in browser → server presents login page
2. Authenticates via SSO or local account
3. Server validates token (not expired, not claimed); creates `RoomMember` record
4. Browser shows "You've been added to [Room Name]. Open in Obsidian?"
5. Click → redirect to `obsidian://multiplayer/join?guid={guid}&name={name}&server={serverUrl}`
6. Plugin receives handler, prompts for local folder, creates `SharedFolder`

**Claiming (paste into plugin Join tab):**

The invite URL can also be pasted directly into the "Join" tab of `SharedFolderModal`. The plugin strips the token and calls `POST /api/rooms/join`.

**Constraints (v1):**

- Single-use only
- Expiry enforced server-side
- Cannot invite to a role higher than your own
- Pending invites can be revoked from the admin UI

---

## Plugin Architecture Changes

### What Gets Removed

- `src/pwManager.ts` — deleted entirely
- `PasswordModal`, `ResetPasswordModal` — deleted
- "Backup Shared Folders" and "Reset Master Password" in settings — deleted
- "Copy GUID" and "Copy Password" context menu items — deleted
- `salt`, `encPw` fields from `SharedTypeSettings` — removed
- `signalingServers` from `SharedTypeSettings` — removed (WebRTC gone)
- Startup password prompt in `main.ts` — removed

### What Gets Added

- `src/auth.ts` — `AuthManager` (OAuth PKCE flow, token lifecycle, SecretStorage)
- `src/api.ts` — `ApiClient` (typed HTTP client for all REST calls)
- `obsidian://multiplayer/callback` protocol handler — OAuth redirect target
- `obsidian://multiplayer/join` protocol handler — auto-add room from browser invite
- `InviteModal` — role + expiry picker, copies invite link
- `MembersModal` — read-only member list + link to admin panel
- `FileOverwriteWarningModal` — conflict resolution on remote file creation
- Status bar item — connection/auth state at a glance

### Settings Schema (after changes)

```typescript
interface SharedTypeSettings {
  guid: string       // Yjs doc name / room ID (was: unchanged)
  name: string       // Human-readable room name (new)
  folderPath: string // Local vault folder path (was: unchanged)
  // Removed: salt, encPw, signalingServers
}

interface MultiplayerSettings {
  serverUrl: string           // e.g. https://multiplayer.company.com
  displayName: string         // Shown over cursor (was: userName)
  sharedFolders: SharedTypeSettings[]
  // Removed: masterPasswordSet, salt
}
```

---

## Deployment

### Minimum self-hosted deployment

```yaml
# docker-compose.yml
services:
  server:
    image: ghcr.io/obsidian-multiplayer/server:latest
    environment:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/multiplayer
      DATA_DIR:     /data/yjs
      BASE_URL:     ${BASE_URL}     # https://multiplayer.company.com
      JWT_SECRET:   ${JWT_SECRET}
    volumes:
      - yjs-data:/data/yjs
      - ./config.yaml:/app/config.yaml:ro
    ports: ["3000:3000"]
    depends_on: [db]

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pg-data:/var/lib/postgresql/data
```

TLS is terminated by a reverse proxy (Nginx, Caddy, Traefik). Caddy is recommended for automatic Let's Encrypt.

First run: if no users exist, the server prints bootstrap admin credentials to stdout once.

---

## Implementation Phases

| Phase | Scope |
|---|---|
| P1 | Provider swap: y-webrtc → y-websocket; settings schema cleanup; remove password infrastructure |
| P2 | Plugin OAuth flow: AuthManager, PKCE, SecretStorage, token refresh, status bar |
| P3 | Room management: create/join modals, invite flow, members modal, available rooms list |
| P4 | Permissions enforcement: role fetch on connect, CodeMirror read-only for VIEWERs |
| P5 | Bug fixes: `util.ts:74` backup restore, extension array leak, file overwrite warning |
| P6 | Server foundation: Fastify + Prisma + OIDC + JWT middleware + WebSocket handler + y-leveldb |
| P7 | SSO federation: OIDC upstreams (Google, Okta, Azure AD), SAML 2.0, config.yaml live reload |
| P8 | Admin web UI: React app at `/admin` — users, rooms, audit log, IdP config |

---

## Open Questions

These divergences from the two design threads remain unresolved and need a decision before or during implementation.

### 1. E2E Encryption — Deferred vs. Core

**The tension:** One design thread placed client-side AES-256-GCM encryption of Yjs updates at the center of the architecture (zero-knowledge relay). The SPEC defers this explicitly: *"Server would not see plaintext. Complex; breaks server-side persistence and audit. Significant future work."*

**Implications of E2E encryption:**
- The server cannot store or deliver Yjs update history (persistence breaks unless updates are stored as opaque blobs, keyed per-room, with the server never decrypting)
- Server-side VIEWER enforcement (dropping update messages) becomes impossible — enforcement must be purely client-side, which is bypassable
- Audit logging of document events is not possible
- Admin web UI cannot display document content
- Implementation complexity is significantly higher

**Current position:** E2E encryption is **deferred** to a future version. v1 relies on server-side access control (JWT auth, room membership, VIEWER socket wrapper) and TLS in transit. This is consistent with how most collaborative tools (Notion, Linear, etc.) operate. The server is a trusted party.

**Future path:** If E2E is added later, it requires per-room AES keys wrapped with per-user asymmetric keys (as described in the auth branch design). This would be a separate feature, not a retrofit of the existing persistence layer.

### 2. Transport: WebRTC Removed vs. Hybrid

**Current position:** y-webrtc is **removed**. WebSocket-only transport.

**The hybrid case:** Keeping y-webrtc alongside y-websocket would reduce latency for peers on the same local network and reduce relay bandwidth. Yjs providers compose additively. However, it reintroduces signaling server complexity and the existing y-webrtc implementation has no auth — any peer knowing the room GUID could connect. Removal is the right call for v1.

### 3. Managed Hosting Infrastructure

**The tension:** The Cloudflare Workers + Durable Objects stack (considered in the auth branch) offers global edge deployment without operating VMs. The SPEC's Node.js/Docker stack is self-hostable and conventional but requires a VPS for managed hosting.

**Current position:** Ship the Docker/Node.js server first. Evaluate a Cloudflare adapter later if managed hosting demand justifies it. The two are not mutually exclusive — the Cloudflare Workers adapter could implement the same REST and WebSocket API surface.

### 4. Other Deferred Items

| Question | Status |
|---|---|
| Refresh token rotation on each use | Defer; `node-oidc-provider` supports it, enable later |
| Access token denylist for sub-1-hour revocation | Defer; document the 1-hour window |
| Multi-instance server scaling (Redis pub/sub) | Not needed for v1 |
| Multiple server accounts in plugin | Defer; significant complexity |
| Mobile (iOS/Android) OAuth callback | Needs investigation; WS sync works, OAuth redirect may not |
| Per-user asymmetric keypairs for zero-trust peer identity | Defer; depends on E2E encryption decision |

---

## Security Properties (v1)

| Threat | Mitigation |
|---|---|
| Unauthenticated access | JWT required on every WebSocket connection; server closes 4001 on bad/expired token |
| Unauthorised room access | Membership checked per-connection; 4003 on non-member |
| VIEWER writing content | Server-side socket wrapper drops incoming update messages; client-side `readOnly` facet |
| Token theft from disk | Stored in Obsidian SecretStorage, not `data.json` or Obsidian Sync; access tokens short-lived (1h) |
| Invite link abuse | Single-use tokens; expiry enforced server-side; revocable from admin UI |
| Deprovisioned user retaining access | SSO deactivation prevents new token issuance; existing tokens expire within 1h |
| Data in transit | TLS (terminated at reverse proxy); standard WebSocket over TLS |
| **Server operator reads documents** | **Not mitigated in v1** — server sees plaintext Yjs updates. E2E encryption deferred (see §Open Questions). |
