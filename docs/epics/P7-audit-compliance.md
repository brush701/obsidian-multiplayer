# P7 — Audit & Compliance

Implement a comprehensive, append-only audit log covering all security-relevant events, an admin UI for viewing and filtering the log, and an export mechanism for SIEM ingestion.

**Enterprise context:** Security and compliance teams need to be able to answer questions like "who accessed the Board Docs room on March 5th?", "when was Alice's access revoked?", and "what did the SCIM provisioner do last week?". Without a reliable audit trail, the system cannot be used in regulated industries or by organisations with meaningful security review processes. The audit log is not a nice-to-have — it is a hard requirement for enterprise adoption.

**Dependencies:** P3 (server foundation — `AuditEvent` table exists from day 1), P6 (SCIM events feed the log)
**Blocks:** P8 (Enterprise Operations admin UI includes audit export tooling)

---

## Stories

### P7-S1 — Audit event emission throughout the server

**As a** security engineer,
**I want** all security-relevant server operations to write an audit event,
**so that** I have a complete, accurate record of what happened and who did it.

#### Requirements

A shared `auditLog.emit(event)` function is implemented in `src/audit.ts`:

```typescript
interface AuditEventInput {
  actorId?:    string      // userId; omit for system/SCIM events
  actorEmail?: string      // denormalized; required if actorId is set
  actorIp?:    string
  event:       AuditEventType
  resourceType: string
  resourceId?:  string
  detail?:     Record<string, unknown>
}

async function auditLog(input: AuditEventInput): Promise<void>
```

`auditLog()` inserts an `AuditEvent` record. It never throws — errors are logged to stderr but do not propagate to the caller (a failed audit write must not break the primary operation).

**Events emitted at each operation:**

| Operation | Event type | resourceType | detail |
|---|---|---|---|
| User created (admin or SCIM) | `USER_CREATED` | `user` | `{ email, orgRole, source: 'admin' \| 'scim' }` |
| User deactivated (admin) | `USER_DEACTIVATED` | `user` | `{ reason: 'manual' }` |
| User deactivated (SCIM) | `SCIM_USER_DEPROVISIONED` | `user` | `{ triggeredBy: 'scim', method: 'patch' \| 'delete' }` |
| User reactivated | `USER_REACTIVATED` | `user` | |
| Org role changed | `USER_ORG_ROLE_CHANGED` | `user` | `{ oldRole, newRole }` |
| Session created (sign-in) | `SESSION_CREATED` | `session` | `{ userAgent }` |
| Session terminated (admin) | `SESSION_TERMINATED` | `session` | `{ terminatedBy: adminUserId }` |
| Room created | `ROOM_CREATED` | `room` | `{ name }` |
| Room deleted | `ROOM_DELETED` | `room` | `{ name }` |
| Member added to room | `ROOM_MEMBER_ADDED` | `room` | `{ targetUserId, targetEmail, role, grantedBy: 'direct' \| 'invite' \| 'group' }` |
| Member removed from room | `ROOM_MEMBER_REMOVED` | `room` | `{ targetUserId, targetEmail }` |
| Member role changed | `ROOM_MEMBER_ROLE_CHANGED` | `room` | `{ targetUserId, targetEmail, oldRole, newRole }` |
| Invite created | `INVITE_CREATED` | `invite` | `{ roomId, role, expiresAt }` |
| Invite claimed | `INVITE_CLAIMED` | `invite` | `{ roomId, claimedByEmail }` |
| Invite revoked | `INVITE_REVOKED` | `invite` | `{ roomId }` |
| SCIM user provisioned | `SCIM_USER_PROVISIONED` | `user` | `{ email }` |
| SCIM group synced | `SCIM_GROUP_SYNCED` | `group` | `{ externalId, displayName, memberCount }` |
| IdP config changed | `IDP_CONFIG_CHANGED` | `org` | `{ changedBy: adminUserId }` |
| SSO enforcement toggled | `SSO_ENFORCEMENT_CHANGED` | `org` | `{ ssoRequired: boolean, changedBy: adminUserId }` |

All events include `occurredAt` (auto-set by database) and `actorIp` where the request IP is available.

#### Acceptance Criteria

- [ ] `src/audit.ts` exports `auditLog(input)`.
- [ ] `auditLog()` inserts an `AuditEvent` record into the database.
- [ ] A thrown exception inside `auditLog()` is caught and logged to stderr — it does not propagate.
- [ ] Each operation in the table above triggers an audit event with the correct `event` type.
- [ ] `actorEmail` is denormalized (written at the time of the event) and does not change if the user is later deleted.
- [ ] `AuditEvent` records are never updated or deleted by application code.

---

### P7-S2 — Admin audit log API

**As a** security team member,
**I want** to query the audit log via the admin API with flexible filters,
**so that** I can investigate specific incidents or generate reports for a date range.

#### Requirements

```
GET /admin/api/audit
  Query params:
    page        integer, default 1
    limit       integer, default 50, max 500
    event       AuditEventType (optional)
    actorId     userId (optional)
    resourceId  string (optional)
    from        ISO 8601 datetime (optional)
    to          ISO 8601 datetime (optional)

  Returns:
    {
      total:  number,
      page:   number,
      limit:  number,
      events: AuditEvent[]
    }

  Order: newest first.
  Auth: requires OrgRole.ADMIN or OWNER.
```

```
GET /admin/api/audit/export
  Query params:
    format      "csv" | "jsonl" (required)
    from        ISO 8601 datetime (optional)
    to          ISO 8601 datetime (optional)
    event       AuditEventType (optional, repeatable: ?event=USER_CREATED&event=USER_DEACTIVATED)

  Returns:
    Streamed response with appropriate Content-Type:
      csv   → text/csv; Content-Disposition: attachment; filename="audit-{from}-{to}.csv"
      jsonl → application/x-ndjson (one JSON object per line)

  Auth: requires OrgRole.ADMIN or OWNER.
  Note: No pagination — streams all matching records. Use date ranges to limit output.
```

JSONL format (one event per line):
```json
{"id":"...","occurredAt":"2026-03-07T10:00:00Z","actorEmail":"alice@co.com","actorIp":"10.0.0.1","event":"ROOM_MEMBER_ADDED","resourceType":"room","resourceId":"room-uuid","detail":{"targetEmail":"bob@co.com","role":"EDITOR"}}
```

CSV format: headers match `AuditEvent` field names; `detail` column is JSON-encoded.

#### Acceptance Criteria

- [ ] `GET /admin/api/audit` returns paginated results ordered newest first.
- [ ] `event` query param filters by event type.
- [ ] `from` and `to` query params filter by `occurredAt` range (inclusive).
- [ ] `actorId` and `resourceId` filter as expected.
- [ ] `GET /admin/api/audit/export?format=jsonl` streams JSONL output.
- [ ] `GET /admin/api/audit/export?format=csv` streams CSV output with appropriate headers.
- [ ] Export responds with `Content-Disposition: attachment` header.
- [ ] Both endpoints return 403 for users without ADMIN or OWNER org role.

---

### P7-S3 — Audit log UI in admin panel

**As a** security team member,
**I want** a web UI to browse and search the audit log without writing API queries,
**so that** I can investigate incidents quickly during an on-call situation.

#### Requirements

The admin UI "Audit Log" page:

```
Audit Log                               [ Export CSV ]  [ Export JSONL ]

Filters:
  Event type [All ▾]   Actor [_____]   From [__date__]   To [__date__]   [ Apply ]

┌──────────────────────────────────────────────────────────────────────────────┐
│ 2026-03-07 10:23:14  alice@co.com   ROOM_MEMBER_ADDED    room: Q4 Planning  │
│   → bob@co.com added as Editor                                               │
│                                                                              │
│ 2026-03-07 09:55:02  SCIM           SCIM_USER_DEPROVISIONED   user: dave    │
│   → deprovisioned via PATCH active:false                                     │
│                                                                              │
│ ...                                                                          │
└──────────────────────────────────────────────────────────────────────────────┘

  ← Previous   Page 1 of 47   Next →
```

- Each row is expandable to show the full `detail` JSON.
- "Export CSV" and "Export JSONL" buttons trigger the export API with current filter values.
- Filters are applied client-side via API query params, not JavaScript filtering.
- Actor column shows "SCIM" for system/SCIM events where `actorId` is null.

#### Acceptance Criteria

- [ ] Audit log page renders a paginated list of events.
- [ ] Event type, actor, from/to date filters update the displayed results via API query params.
- [ ] Expanding a row reveals the full `detail` payload.
- [ ] "Export CSV" triggers a file download with the current filter applied.
- [ ] "Export JSONL" triggers a file download with the current filter applied.
- [ ] SCIM/system events display "SCIM" in the actor column.

---

### P7-S4 — Audit log retention policy

**As a** compliance officer,
**I want** audit events to be retained for a configurable period and then purged automatically,
**so that** we meet our data retention obligations without the database growing unboundedly.

#### Requirements

`config.yaml` accepts:
```yaml
audit:
  retention_days: 730   # default: 2 years; minimum: 90
```

A background job runs daily (at a configurable time, default: 03:00 server local time):
1. Deletes `AuditEvent` records with `occurredAt < now() - retention_days`.
2. Logs to stdout: `Audit retention: deleted {n} events older than {date}.`
3. Does **not** write an audit event for the purge (to avoid a self-referential loop). Instead, the deletion is reflected in structured server logs.

The minimum retention period is 90 days. If `retention_days < 90` is configured, the server logs a warning at startup and uses 90 days.

#### Acceptance Criteria

- [ ] `audit.retention_days` is read from `config.yaml`; defaults to 730 if absent.
- [ ] A background job runs at server startup and daily thereafter.
- [ ] The job deletes `AuditEvent` records older than `retention_days`.
- [ ] The deletion count is logged to stdout.
- [ ] Setting `retention_days: 30` at startup logs a warning and uses 90 instead.
- [ ] The background job does not insert any `AuditEvent` records.
