# P8 — Enterprise Operations

Implement the operational capabilities that IT teams need to deploy, monitor, and manage the server in a corporate environment: health and metrics endpoints, admin session management UI, SSO enforcement, network isolation documentation, and deployment hardening.

**Enterprise context:** IT teams don't just install software — they operate it. They need it to integrate with their monitoring stack (Prometheus, Datadog, Grafana), they need to know the server is healthy before users report problems, and they need confidence that the deployment is secure and auditable. This epic makes Obsidian Multiplayer a thing IT is willing to run, not just a thing developers can spin up.

**Dependencies:** P3 (server foundation), P6 (SCIM), P7 (audit log)
**Blocks:** nothing (this is the final hardening epic)

---

## Stories

### P8-S1 — Health and readiness endpoints

**As an** IT operations engineer,
**I want** health check endpoints I can point my load balancer and monitoring system at,
**so that** I know when the server is up and ready to serve traffic.

#### Requirements

```
GET /health
  Auth: none (intentionally unauthenticated)
  Returns HTTP 200 if:
    - Server process is running
    - PostgreSQL connection is healthy (simple SELECT 1 query succeeds)
    - LevelDB (Yjs persistence) is accessible
  Returns HTTP 503 if any dependency is unhealthy.

  Response body (both 200 and 503):
  {
    "status": "ok" | "degraded",
    "checks": {
      "postgres": { "status": "ok" | "error", "latencyMs": number },
      "leveldb":  { "status": "ok" | "error" },
    },
    "version": "1.2.3",
    "uptime": 3600   // seconds
  }
```

```
GET /ready
  Auth: none
  Returns HTTP 200 if the server has completed startup (migrations run, OIDC
  provider initialized, config loaded). Returns HTTP 503 during startup.
  Used by Kubernetes readinessProbe.

  Response: { "ready": true | false }
```

Both endpoints are exempt from rate limiting.

#### Acceptance Criteria

- [ ] `GET /health` returns HTTP 200 with `status: "ok"` when PostgreSQL and LevelDB are healthy.
- [ ] `GET /health` returns HTTP 503 with `status: "degraded"` if PostgreSQL is unreachable.
- [ ] `GET /health` response includes `version` (from `package.json`) and `uptime`.
- [ ] `GET /ready` returns HTTP 503 during server startup (before migrations complete).
- [ ] `GET /ready` returns HTTP 200 after successful startup.
- [ ] Both endpoints do not require an `Authorization` header.
- [ ] Both endpoints are not rate-limited.

---

### P8-S2 — Prometheus metrics endpoint

**As an** IT operations engineer,
**I want** a Prometheus-compatible metrics endpoint,
**so that** I can scrape operational metrics into our monitoring stack (Grafana, Datadog, etc.) and set up alerts.

#### Requirements

```
GET /metrics
  Auth: Bearer token (same mechanism as admin API, OR a separate static scrape token
        configured in config.yaml as metrics.scrape_token)
  Returns: Prometheus text format (text/plain; version=0.0.4)
```

Metrics to expose:

| Metric | Type | Description |
|---|---|---|
| `multiplayer_active_ws_connections` | Gauge | Current open WebSocket connections |
| `multiplayer_http_requests_total` | Counter | Total HTTP requests, labelled by method, route, status |
| `multiplayer_http_request_duration_seconds` | Histogram | HTTP request latency |
| `multiplayer_ws_messages_total` | Counter | Total WS messages received, labelled by type |
| `multiplayer_active_sessions_total` | Gauge | Non-revoked sessions in the database |
| `multiplayer_users_total` | Gauge | Total users (active and deactivated) |
| `multiplayer_rooms_total` | Gauge | Total rooms |
| `multiplayer_scim_operations_total` | Counter | SCIM operations, labelled by resource and method |
| `multiplayer_audit_events_total` | Counter | Audit events written, labelled by event type |
| `multiplayer_db_pool_size` | Gauge | PostgreSQL connection pool size |
| `multiplayer_db_pool_idle` | Gauge | Idle PostgreSQL connections |
| `process_resident_memory_bytes` | Gauge | Node.js process RSS |
| `process_cpu_seconds_total` | Counter | Node.js CPU usage |

Use `prom-client` npm package for metric registration and exposition.

**Scrape token configuration:**
```yaml
metrics:
  scrape_token: "a-long-random-secret"  # If set, required as Bearer token to /metrics
```

If `scrape_token` is not set, `/metrics` is accessible to users with `OrgRole.ADMIN`.

#### Acceptance Criteria

- [ ] `GET /metrics` returns Prometheus text format.
- [ ] All metrics listed in the table above are present in the response.
- [ ] `multiplayer_active_ws_connections` reflects the current number of open WebSocket connections.
- [ ] If `metrics.scrape_token` is configured, `/metrics` requires that token as a Bearer token; requests without it return 401.
- [ ] If `metrics.scrape_token` is not configured, admin users can access `/metrics`.
- [ ] HTTP request duration histogram uses appropriate buckets (e.g. 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5).

---

### P8-S3 — Admin session management UI

**As an** IT administrator,
**I want** to view and force-terminate active user sessions from the admin panel,
**so that** I can respond to a security incident or account compromise without waiting for the user's session to naturally expire.

#### Requirements

**Sessions page in admin UI:**

```
Sessions

  Filter by user: [________________________]  [ Apply ]

┌──────────────────────────────────────────────────────────────────────────────┐
│ alice@company.com                                                            │
│   Session started: 2026-03-07 08:00   Last active: 2026-03-07 10:15        │
│   IP: 10.0.1.50   Browser: Obsidian/1.7.4 (darwin)   [ Terminate ]         │
│                                                                              │
│ bob@company.com                                                              │
│   Session started: 2026-03-06 14:30   Last active: 2026-03-07 09:45        │
│   IP: 10.0.2.11   Browser: Obsidian/1.7.4 (linux)    [ Terminate ]         │
│   Session started: 2026-03-05 09:00   Last active: 2026-03-05 11:00        │
│   IP: 192.168.1.5  Browser: Obsidian/1.7.1 (darwin)   [ Terminate ]        │
└──────────────────────────────────────────────────────────────────────────────┘
```

Additionally, the Users page shows a "Terminate all sessions" button per user (next to "Deactivate").

**API backing:**
- `GET /admin/api/sessions` — lists all non-revoked sessions across all users (paginated; sorted by `lastSeenAt` desc).
- `DELETE /admin/api/sessions/:sessionId` — revokes a session; writes `SESSION_TERMINATED` audit event.
- `DELETE /admin/api/users/:id/sessions` — revokes all sessions for a user; writes `SESSION_TERMINATED` per session.

**What "terminate" does:**
Sets `Session.revokedAt`. The next time the user's plugin attempts to refresh their access token using that session's refresh token, the server returns 401. The plugin then shows the "session ended by administrator" notice (P2-S9).

#### Acceptance Criteria

- [ ] Sessions page lists all active sessions with user email, start time, last active time, IP address, and user agent.
- [ ] "Terminate" button for a session calls `DELETE /admin/api/sessions/:sessionId`.
- [ ] After termination, the session disappears from the active sessions list.
- [ ] `SESSION_TERMINATED` audit event is written with `detail.terminatedBy` set to the admin's userId.
- [ ] Users page "Terminate all sessions" button calls `DELETE /admin/api/users/:id/sessions`.
- [ ] "Terminate all sessions" is disabled if the user has no active sessions.
- [ ] A terminated session causes the next plugin token refresh to return 401.

---

### P8-S4 — SSO enforcement UI and server enforcement

**As an** IT administrator,
**I want** to disable local account login from the admin panel once SSO is configured,
**so that** I can ensure all users authenticate via the corporate identity provider.

#### Requirements

**Config-based enforcement (static):**
```yaml
auth:
  sso_required: true   # Disables local account login
  local_accounts: true # Whether local accounts can be created at all; overridden by sso_required
```

**Admin UI toggle (dynamic, without restart):**
The Identity Providers page has a toggle: "Require SSO for all logins". When enabled:
- The OIDC provider's local login form is removed from the auth page.
- Users attempting the OAuth flow see only the SSO provider buttons.
- An `SSO_ENFORCEMENT_CHANGED` audit event is written.
- The toggle state is persisted to the database (a `ServerConfig` key-value table) and survives server restarts.

**Bootstrap exception:**
If `sso_required` is enabled but no upstream OIDC or SAML provider is configured, the server refuses to start and logs: `ERROR: sso_required is true but no upstream identity providers are configured. Refusing to start.`

This prevents accidental lockout.

#### Acceptance Criteria

- [ ] Setting `auth.sso_required: true` in `config.yaml` hides the local login form from the auth page.
- [ ] Toggling SSO enforcement in the admin UI takes effect immediately (next auth page load shows or hides local login form).
- [ ] The admin UI toggle state is persisted and survives a server restart.
- [ ] `SSO_ENFORCEMENT_CHANGED` audit event is written when the toggle changes.
- [ ] If `sso_required: true` is set with no upstream providers configured, the server exits at startup with a clear error message.
- [ ] A local account user who was previously able to sign in cannot complete a new sign-in after SSO enforcement is enabled.

---

### P8-S5 — Structured logging and request correlation

**As an** IT operations engineer,
**I want** all server logs to be structured JSON with correlation IDs,
**so that** I can ingest logs into our log aggregation system (Splunk, Elastic, Datadog) and trace a single request through the system.

#### Requirements

Replace any `console.log` calls with [Pino](https://github.com/pinojs/pino) logger:

```typescript
import pino from 'pino'
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })
```

Each incoming HTTP request gets a `requestId` (UUID v4), added as an `X-Request-Id` response header and included in all log entries emitted during that request's lifecycle.

Log format (JSON, one object per line):
```json
{
  "level": 30,
  "time": 1741349413000,
  "requestId": "a3f1...",
  "method": "POST",
  "url": "/api/rooms",
  "statusCode": 201,
  "responseTimeMs": 42,
  "actorId": "user-uuid",
  "msg": "room created"
}
```

Log levels:
- `error` — unhandled exceptions, database connection failures
- `warn` — recoverable errors (audit write failure, non-critical config issue)
- `info` — request completion, startup/shutdown, significant state changes
- `debug` — per-request detail, query timing (not emitted in production by default)

`LOG_LEVEL` environment variable controls the minimum log level. Default: `info`.

#### Acceptance Criteria

- [ ] All log output is valid JSON (one object per line), parseable by standard log aggregators.
- [ ] Each HTTP request emits a log entry with `method`, `url`, `statusCode`, `responseTimeMs`.
- [ ] Each HTTP response includes an `X-Request-Id` header.
- [ ] `requestId` is consistent across all log entries emitted during a single request.
- [ ] `console.log`, `console.error`, etc. are not used in production code paths.
- [ ] Setting `LOG_LEVEL=debug` enables verbose per-request logging.
- [ ] Setting `LOG_LEVEL=error` suppresses info and warn entries.

---

### P8-S6 — Network isolation documentation and deployment hardening

**As an** IT security engineer,
**I want** clear documentation of the server's network behaviour and example security configurations,
**so that** I can confidently deploy it in a restricted corporate environment and demonstrate to my security team that it makes no unauthorized outbound connections.

#### Requirements

Create `docs/deployment/` with:

**`network-policy.md`**
- Complete list of all outbound connections the server may make, by component:
  - Database (PostgreSQL): always required
  - LevelDB: local filesystem only
  - OIDC upstream JWKS fetch: only if OIDC federation configured; endpoint URL and frequency
  - SAML metadata fetch: only if SAML configured; how to use static metadata to eliminate this
  - SMTP: only if `smtp_url` configured; optional
  - No telemetry, no license checks, no analytics — explicitly stated
- Example Kubernetes `NetworkPolicy` (egress only to PostgreSQL + configured IdP)
- Example Linux iptables rules for non-Kubernetes deployments

**`tls.md`**
- How to configure TLS termination with nginx (internal CA example)
- How to configure TLS termination with Caddy (public Let's Encrypt)
- TLS minimum version configuration (`tls.min_version: "1.2"` or `"1.3"`)
- Cipher suite configuration (link to Mozilla SSL Config Generator recommended settings)

**`docker-compose-production.yml`**
An extended Docker Compose file demonstrating:
- Read-only container filesystem (`read_only: true` with explicit tmpfs mounts)
- Non-root user (`user: "1000:1000"`)
- Dropped Linux capabilities (`cap_drop: [ALL]`)
- Resource limits (`mem_limit`, `cpus`)
- Log rotation (`logging.driver: json-file` with `max-size` and `max-file`)

**`kubernetes/`**
- `deployment.yaml` with security context (`runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`)
- `networkpolicy.yaml` restricting egress to PostgreSQL and configured IdP only
- `service.yaml` and `ingress.yaml` examples

#### Acceptance Criteria

- [ ] `docs/deployment/network-policy.md` exists and lists every outbound connection the server can make.
- [ ] The document explicitly states that no telemetry or external service dependency exists.
- [ ] A Kubernetes NetworkPolicy example is included.
- [ ] `docs/deployment/tls.md` includes examples for both nginx (internal CA) and Caddy (public TLS).
- [ ] `docs/deployment/docker-compose-production.yml` uses a read-only filesystem, non-root user, and dropped capabilities.
- [ ] `docs/deployment/kubernetes/deployment.yaml` includes a security context with `runAsNonRoot: true` and `readOnlyRootFilesystem: true`.

---

### P8-S7 — Rate limiting

**As a** security engineer,
**I want** rate limiting on sensitive endpoints,
**so that** the server is resilient to brute-force attacks and accidental DoS from misconfigured clients.

#### Requirements

Use `@fastify/rate-limit` with per-IP limits (Redis not required; in-memory is acceptable for v1 single-instance deployments).

| Endpoint group | Limit | Window |
|---|---|---|
| `POST /auth/token` | 10 requests | 1 minute per IP |
| `GET /auth/authorize` | 20 requests | 1 minute per IP |
| `POST /api/rooms/join` | 5 requests | 1 minute per IP |
| `POST /api/rooms/:guid/invites` | 20 requests | 1 hour per IP |
| `POST /admin/api/scim/tokens` | 5 requests | 1 hour per IP |
| `/scim/v2/*` | 100 requests | 1 minute per IP |
| All other `/api/*` | 300 requests | 1 minute per IP |

Rate limit response: HTTP 429 with `Retry-After` header and body:
```json
{ "error": "rate_limit_exceeded", "retryAfterSeconds": 30 }
```

Rate limit events at `warn` log level (include IP, endpoint, limit).

`/health` and `/ready` are exempt from rate limiting.

#### Acceptance Criteria

- [ ] `POST /auth/token` returns HTTP 429 after 10 requests within 1 minute from the same IP.
- [ ] HTTP 429 response includes a `Retry-After` header.
- [ ] Rate limit events are logged at `warn` level with IP and endpoint.
- [ ] `GET /health` and `GET /ready` are not rate-limited.
- [ ] Rate limits reset after the window expires (the 11th request after the window rolls over succeeds).
