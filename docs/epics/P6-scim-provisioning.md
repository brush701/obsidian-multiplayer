# P6 — SCIM 2.0 Provisioning

Implement a SCIM 2.0 (RFC 7644) provisioning API so that enterprise identity providers (Okta, Azure AD / Entra ID, etc.) can automatically manage user and group lifecycle. This eliminates manual user management at scale and ensures deprovisioning happens automatically when someone leaves the organisation.

**Enterprise context:** This is the feature that makes Obsidian Multiplayer viable for a 5,000-person organisation. IT cannot manually onboard and offboard users at that scale. SCIM is the industry standard for IdP-driven provisioning. Without it, every joiner and leaver requires manual admin action — which creates both an operational burden and a security risk (delayed offboarding).

**Dependencies:** P3 (server foundation and database schema, including `ScimToken`, `DirectoryGroup`, `GroupMember`, `GroupRoomAccess`, `Session` tables)
**Blocks:** P7 (Audit — SCIM events feed the audit log), P8 (Enterprise Operations — SCIM status surfaces in admin UI)

---

## Stories

### P6-S1 — SCIM bearer token management

**As an** IT administrator,
**I want** to generate a bearer token that I can paste into my IdP's SCIM provisioning configuration,
**so that** the IdP can authenticate to the provisioning API without using a user credential.

#### Requirements

**Admin API:**
- `POST /admin/api/scim/tokens` — creates a new SCIM token. Returns `{ id, token }`. The raw `token` value is shown exactly once; the server stores only a bcrypt hash.
- `GET /admin/api/scim/tokens` — lists all tokens with `{ id, description, createdAt, lastUsedAt, revokedAt }`. Never returns raw token values.
- `DELETE /admin/api/scim/tokens/:id` — revokes a token. Sets `ScimToken.revokedAt`; does not delete the record.

**Token authentication:**
SCIM endpoints authenticate via `Authorization: Bearer <token>`. On each SCIM request, the server:
1. Extracts the bearer token.
2. Iterates non-revoked `ScimToken` records and bcrypt-compares.
3. If a match is found, updates `ScimToken.lastUsedAt` and proceeds.
4. If no match, returns HTTP 401.

> **Note:** bcrypt comparison is intentionally slow. For performance, tokens should use a fast prefix (e.g., first 8 chars) to narrow candidates before bcrypt. Implement a lookup index or prefix table if more than 5 tokens are ever expected.

**Admin UI:**
The Provisioning page in the admin UI shows:
- List of SCIM tokens (description, created date, last used date, status)
- "Generate new token" button: prompts for a description, then shows the raw token once in a dismissible modal ("Copy this token now — it will not be shown again.")
- "Revoke" button per token

#### Acceptance Criteria

- [ ] `POST /admin/api/scim/tokens` returns a token that authenticates successfully against `GET /scim/v2/ServiceProviderConfig`.
- [ ] `GET /admin/api/scim/tokens` never includes a raw token value in its response.
- [ ] After `DELETE /admin/api/scim/tokens/:id`, the token is rejected with 401 on SCIM requests.
- [ ] `ScimToken.lastUsedAt` is updated on each successful SCIM request.
- [ ] A revoked token does not appear as "active" in the token list; it may appear as "revoked" with a timestamp.
- [ ] A request to any `/scim/v2/*` endpoint without a valid bearer token returns HTTP 401 with a SCIM-compliant error body.

---

### P6-S2 — SCIM discovery endpoints

**As an** IdP administrator setting up a SCIM connection,
**I want** the server to expose SCIM discovery endpoints,
**so that** the IdP can auto-configure the connection without me specifying every endpoint manually.

#### Requirements

```
GET /scim/v2/ServiceProviderConfig
  Returns SCIM ServiceProviderConfig resource describing supported features.
  No authentication required (standard SCIM behaviour).

GET /scim/v2/Schemas
  Returns SCIM Schema resources for User and Group.

GET /scim/v2/ResourceTypes
  Returns SCIM ResourceType resources for User and Group.
```

`ServiceProviderConfig` response must declare:
- `patch.supported: true` (we support PATCH)
- `bulk.supported: false` (not implemented)
- `filter.supported: true` (basic `userName eq` and `externalId eq` filters)
- `changePassword.supported: false`
- `sort.supported: false`
- `etag.supported: false`
- `authenticationSchemes`: HTTP Bearer token

#### Acceptance Criteria

- [ ] `GET /scim/v2/ServiceProviderConfig` returns a valid SCIM ServiceProviderConfig JSON document.
- [ ] `GET /scim/v2/Schemas` returns Schema definitions for `urn:ietf:params:scim:schemas:core:2.0:User` and `urn:ietf:params:scim:schemas:core:2.0:Group`.
- [ ] `GET /scim/v2/ResourceTypes` returns ResourceType definitions for User and Group.
- [ ] Discovery endpoints do not require authentication.
- [ ] All responses include `Content-Type: application/scim+json`.

---

### P6-S3 — SCIM Users: provisioning and updates

**As an** IdP,
**I want** to create, read, update, and list user accounts via SCIM,
**so that** new hires are automatically provisioned and user attributes stay in sync.

#### Requirements

**`POST /scim/v2/Users`** — provision a new user:
1. Check if a `User` with the same `email` (mapped from SCIM `userName`) already exists.
   - If yes: link by setting `User.externalId = scimUser.id`; update `name`; do not create a duplicate.
   - If no: create a new `User` with `externalId`, `email`, `name`.
2. Return the SCIM User representation with HTTP 201.
3. Write `AuditEvent` of type `SCIM_USER_PROVISIONED`.

**`GET /scim/v2/Users`** — list users:
- Supports `filter=userName eq "alice@company.com"` and `filter=externalId eq "..."`.
- Returns SCIM ListResponse with matching users.
- Does not paginate for v1 (return all; document as a known limitation).

**`GET /scim/v2/Users/:id`** — get a single user by SCIM `id` (which maps to `User.externalId`).

**`PUT /scim/v2/Users/:id`** — full replace:
- Updates `name`, `email`.
- Does not change `deactivatedAt` (use PATCH for activation/deactivation).

**`PATCH /scim/v2/Users/:id`** — partial update:
- Supports `active` attribute: `active: false` triggers deprovisioning (see P6-S4); `active: true` re-activates.
- Supports updating `displayName` and `emails`.

#### SCIM User attribute mapping:

| SCIM attribute | Server field |
|---|---|
| `id` | `User.externalId` |
| `userName` | `User.email` |
| `displayName` | `User.name` |
| `name.formatted` | `User.name` |
| `emails[primary=true].value` | `User.email` |
| `active` | `!(User.deactivatedAt)` |
| `externalId` | `User.externalId` |

#### Acceptance Criteria

- [ ] `POST /scim/v2/Users` creates a `User` record and returns HTTP 201 with a SCIM User body.
- [ ] `POST /scim/v2/Users` with an email matching an existing user links the records without creating a duplicate.
- [ ] `GET /scim/v2/Users` returns all users as a SCIM ListResponse.
- [ ] `GET /scim/v2/Users?filter=userName+eq+"alice@company.com"` returns only the matching user.
- [ ] `GET /scim/v2/Users/:id` returns the user with the matching `externalId`.
- [ ] `GET /scim/v2/Users/:nonexistent` returns HTTP 404 with a SCIM error body.
- [ ] `PUT /scim/v2/Users/:id` updates `name` and `email`.
- [ ] `PATCH /scim/v2/Users/:id` with `active: false` triggers the deprovisioning path (P6-S4).
- [ ] A `SCIM_USER_PROVISIONED` audit event is written on `POST`.
- [ ] All responses include `Content-Type: application/scim+json`.

---

### P6-S4 — SCIM Users: deprovisioning

**As an** IT administrator,
**I want** deactivating a user in my IdP to immediately revoke their Obsidian Multiplayer access,
**so that** a departing employee loses access as part of the standard offboarding workflow without requiring a separate manual step.

#### Requirements

Deprovisioning is triggered by either:
- `PATCH /scim/v2/Users/:id` with `active: false`
- `DELETE /scim/v2/Users/:id`

Both paths execute the same deprovisioning sequence atomically (within a database transaction):

1. Set `User.deactivatedAt = now()`.
2. Set `Session.revokedAt = now()` for all non-revoked sessions belonging to this user.
3. Write `AuditEvent` of type `SCIM_USER_DEPROVISIONED` with `detail: { triggeredBy: 'scim', method: 'patch' | 'delete' }`.

After deprovisioning:
- The user cannot complete a new OAuth flow (OIDC provider checks `User.deactivatedAt`).
- Any attempt to refresh an access token using a revoked session returns HTTP 401.
- Any WebSocket connect attempt using the (soon-to-expire) access token will fail at `sessionId` validation within the token's remaining lifetime (≤1 hour).

`DELETE` additionally removes group memberships (`GroupMember` records) but preserves the `User` record and `AuditEvent` history.

Re-activation (`PATCH` with `active: true`):
- Clears `User.deactivatedAt`.
- Does not restore revoked sessions (user must sign in again).
- Writes `AuditEvent` of type `USER_REACTIVATED`.

#### Acceptance Criteria

- [ ] `PATCH /scim/v2/Users/:id` with `{ "active": false }` sets `User.deactivatedAt`.
- [ ] After deprovisioning, all `Session` records for the user have `revokedAt` set.
- [ ] After deprovisioning, a `SCIM_USER_DEPROVISIONED` audit event exists.
- [ ] A deprovisioned user cannot obtain a new access token (server returns 401 on token refresh).
- [ ] `DELETE /scim/v2/Users/:id` executes the same deprovisioning sequence and removes `GroupMember` records.
- [ ] `PATCH /scim/v2/Users/:id` with `{ "active": true }` on a deprovisioned user clears `deactivatedAt` and writes `USER_REACTIVATED`.
- [ ] All operations are executed within a database transaction (partial failure rolls back all changes).

---

### P6-S5 — SCIM Groups: sync

**As an** IT administrator,
**I want** my IdP's groups (e.g. Okta groups, Azure AD security groups) to be reflected in Obsidian Multiplayer,
**so that** I can assign room access to a group once, and membership updates in the IdP propagate automatically.

#### Requirements

**`POST /scim/v2/Groups`** — create a group:
- Creates `DirectoryGroup` with `externalId` and `displayName`.
- If `members` are included, creates `GroupMember` records for each member (looked up by `User.externalId`).
- Returns HTTP 201 with SCIM Group body.
- Writes `AuditEvent` of type `SCIM_GROUP_SYNCED`.

**`GET /scim/v2/Groups`** — list groups.

**`GET /scim/v2/Groups/:id`** — get a group.

**`PUT /scim/v2/Groups/:id`** — full replace (replaces `displayName` and full member list).

**`PATCH /scim/v2/Groups/:id`** — partial update:
- Supports `add members`, `remove members` operations (RFC 7644 §3.5.2).
- This is the primary operation used by IdPs to keep group membership in sync.

**`DELETE /scim/v2/Groups/:id`** — deletes the `DirectoryGroup`, all `GroupMember` records, and all `GroupRoomAccess` records. Does not delete users.

**SCIM Group attribute mapping:**

| SCIM attribute | Server field |
|---|---|
| `id` | `DirectoryGroup.externalId` |
| `displayName` | `DirectoryGroup.displayName` |
| `members[].value` | `User.externalId` |
| `externalId` | `DirectoryGroup.externalId` |

**Membership resolution impact:**
After each group sync, WebSocket connections established by existing group members are not terminated — the new membership takes effect on the user's next connect or token refresh. This is acceptable; groups are for steady-state access management, not emergency revocation (use user deprovisioning for that).

#### Acceptance Criteria

- [ ] `POST /scim/v2/Groups` creates a `DirectoryGroup` record and returns HTTP 201.
- [ ] `POST /scim/v2/Groups` with a `members` array creates `GroupMember` records.
- [ ] `PATCH /scim/v2/Groups/:id` with `add members` operation adds the specified users to the group.
- [ ] `PATCH /scim/v2/Groups/:id` with `remove members` operation removes the specified users from the group.
- [ ] `PUT /scim/v2/Groups/:id` replaces the full member list (no orphaned records from the old list).
- [ ] `DELETE /scim/v2/Groups/:id` removes `DirectoryGroup`, all `GroupMember`, and all `GroupRoomAccess` records.
- [ ] A `SCIM_GROUP_SYNCED` audit event is written on create, update, and delete.
- [ ] A user in a group with `GroupRoomAccess` for a room can connect to that room's WebSocket.
- [ ] A user removed from a group via SCIM can no longer connect to rooms where only group membership granted access (on next connect, after their current session naturally ends).

---

### P6-S6 — IdP integration documentation

**As an** IT administrator,
**I want** step-by-step setup guides for my specific IdP,
**so that** I can configure SCIM provisioning without engaging engineering support.

#### Requirements

Create `docs/deployment/scim/` with the following guides:

- `okta.md` — Okta SCIM setup (Okta Lifecycle Management)
- `azure-ad.md` — Azure AD / Entra ID enterprise application provisioning
- `google-workspace.md` — Google Workspace (via third-party SCIM bridge, e.g. Okta or custom)
- `onelogin.md` — OneLogin provisioning
- `jumpcloud.md` — JumpCloud SCIM provisioning

Each guide includes:
1. Prerequisites
2. Creating the SCIM token in the admin UI
3. Configuring the IdP's SCIM endpoint URL (`{serverUrl}/scim/v2`)
4. Attribute mapping (IdP field → SCIM attribute → server field)
5. Group provisioning setup
6. Verification steps (provision a test user, confirm in admin UI)
7. Deprovisioning verification (deactivate test user, confirm session revocation)

#### Acceptance Criteria

- [ ] `docs/deployment/scim/okta.md` exists with all required sections.
- [ ] `docs/deployment/scim/azure-ad.md` exists with all required sections.
- [ ] Each guide includes a verification section with specific steps to confirm provisioning and deprovisioning work correctly.
- [ ] Attribute mapping tables are present in each guide.
