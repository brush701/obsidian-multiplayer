# P2 — Authentication

Implement the OAuth 2.0 Authorization Code + PKCE sign-in flow, secure token storage via Obsidian's SecretStorage API, and all plugin-side surfaces that reflect authentication state.

**Dependencies:** P1 (settings schema and WebSocket provider stub must exist)
**Blocks:** P3 (Room Management), P4 (Permissions)

---

## Stories

### P2-S1 — AuthManager core

**As a** developer,
**I want** a single `AuthManager` class that owns all token lifecycle logic,
**so that** every other part of the plugin can get a valid access token without knowing the details of OAuth or token storage.

#### Requirements

`src/auth.ts` exports a class `AuthManager` with the following public interface:

```typescript
class AuthManager {
  constructor(app: App, settings: MultiplayerSettings)

  /** Start PKCE sign-in. Opens browser; resolves when callback received. */
  signIn(): Promise<void>

  /** Clear all stored tokens and fire 'auth-changed'. */
  signOut(): Promise<void>

  /**
   * Return a currently valid access token, refreshing silently if needed.
   * Returns null if not authenticated.
   */
  getAccessToken(): Promise<string | null>

  /** True if tokens are stored and not known to be permanently invalid. */
  readonly isAuthenticated: boolean

  /** Email and display name from the last successful token exchange, or null. */
  readonly userInfo: { email: string; name: string } | null

  /** Subscribe to auth state changes (sign-in, sign-out, token refresh failure). */
  on(event: 'auth-changed', handler: () => void): void
  off(event: 'auth-changed', handler: () => void): void
}
```

- `AuthManager` is instantiated once in `main.ts` and passed to components that need it.
- `AuthManager` reads its `serverUrl` from `settings.serverUrl`. If `serverUrl` changes, the existing instance is replaced.

#### Acceptance Criteria

- [ ] `src/auth.ts` exists and exports `AuthManager`.
- [ ] `AuthManager` satisfies the interface above with no TypeScript errors.
- [ ] `isAuthenticated` returns `false` on a freshly instantiated manager with no stored tokens.
- [ ] `getAccessToken()` returns `null` when not authenticated.
- [ ] `on('auth-changed', handler)` and `off('auth-changed', handler)` correctly add and remove listeners.
- [ ] `AuthManager` is instantiated in `main.ts` and accessible to plugin components.

---

### P2-S2 — PKCE sign-in flow

**As a** user,
**I want** to click "Sign in" in the settings tab and complete authentication in my browser,
**so that** the plugin can act on my behalf without me entering credentials into Obsidian.

#### Requirements

`AuthManager.signIn()`:

1. Generates a cryptographically random `code_verifier` (64 bytes, base64url encoded) and `state` nonce (32 bytes, base64url encoded) using the Web Crypto API.
2. Computes `code_challenge = base64url(sha256(code_verifier))`.
3. Stores `code_verifier` and `state` in memory (not persisted).
4. Opens the system browser to:
   ```
   {serverUrl}/auth/authorize
     ?client_id=obsidian-multiplayer
     &redirect_uri=obsidian://multiplayer/callback
     &response_type=code
     &code_challenge={code_challenge}
     &code_challenge_method=S256
     &state={state}
   ```
5. A protocol handler registered under `obsidian://multiplayer/callback` receives the redirect from the browser.
6. The handler validates that `state` in the callback URL matches the stored nonce. If not, the flow is aborted and an error notice is shown.
7. The handler POSTs to `{serverUrl}/auth/token`:
   ```json
   {
     "grant_type": "authorization_code",
     "code": "<code from callback>",
     "code_verifier": "<stored verifier>",
     "client_id": "obsidian-multiplayer",
     "redirect_uri": "obsidian://multiplayer/callback"
   }
   ```
8. On success, the response `{ access_token, refresh_token, expires_in, user: { email, name } }` is stored via `TokenStore` (P2-S3).
9. `isAuthenticated` becomes `true`; `userInfo` is populated; `'auth-changed'` fires.
10. On network error or non-2xx response, a notice is shown: "Sign-in failed — try again."
11. In-memory `code_verifier` and `state` are cleared regardless of outcome.

- The protocol handler is registered in `main.ts` via `this.registerObsidianProtocolHandler('multiplayer/callback', ...)` and unregistered on plugin unload.
- Only one sign-in flow can be in progress at a time. A second call to `signIn()` while one is pending reuses the existing pending promise.

#### Acceptance Criteria

- [ ] `signIn()` opens the system browser to a URL matching the template above.
- [ ] The constructed URL contains `code_challenge_method=S256`.
- [ ] The `code_challenge` is the base64url-encoded SHA-256 hash of the `code_verifier`.
- [ ] `obsidian://multiplayer/callback` is registered as a protocol handler on plugin load.
- [ ] Given a callback URL with an incorrect `state`, the flow is aborted and a notice is shown; `isAuthenticated` remains `false`.
- [ ] Given a callback URL with the correct `state` and `code`, a POST is made to `{serverUrl}/auth/token` with the body described above.
- [ ] After a successful token response, `isAuthenticated` is `true` and `userInfo` reflects the returned `email` and `name`.
- [ ] After a successful token response, `'auth-changed'` fires exactly once.
- [ ] Given a non-2xx token response, a "Sign-in failed" notice is shown; `isAuthenticated` remains `false`.
- [ ] A second call to `signIn()` while the first is pending returns the same promise (no duplicate browser windows).
- [ ] `code_verifier` and `state` are not readable on `AuthManager` after the flow completes or fails.

---

### P2-S3 — Token storage (SecretStorage)

**As a** user,
**I want** my OAuth tokens stored securely and separately from synced settings,
**so that** tokens are not exposed via Obsidian Sync or in `data.json`.

#### Requirements

A `TokenStore` class (internal to `src/auth.ts` or its own `src/tokenStore.ts`) handles all token persistence:

```typescript
interface StoredTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string   // ISO 8601
  email: string
  name: string
}

class TokenStore {
  async save(tokens: StoredTokens): Promise<void>
  async load(): Promise<StoredTokens | null>
  async clear(): Promise<void>
}
```

Storage keys:

| Key | Value |
|---|---|
| `mp-access-token` | access token string |
| `mp-refresh-token` | refresh token string |
| `mp-token-expiry` | ISO 8601 expiry timestamp |
| `mp-user-email` | user email string |
| `mp-user-name` | user display name string |

- Storage uses `this.app.vault.adapter.store` (Obsidian's `LocalForage`-backed SecretStorage).
- `save()` writes all five keys atomically (best-effort; individual `setItem` calls are acceptable if Obsidian's API does not provide a transaction).
- `load()` returns `null` if any required key is missing.
- `clear()` removes all five keys.
- `TokenStore` is not exported from the plugin's public surface.

#### Acceptance Criteria

- [ ] After `save(tokens)`, `load()` returns a `StoredTokens` object equal to the saved value.
- [ ] After `clear()`, `load()` returns `null`.
- [ ] After `save()` followed by `clear()`, `load()` returns `null`.
- [ ] `load()` returns `null` if only a subset of the keys exist in storage.
- [ ] None of the stored keys appear in `plugin.settings` or `data.json`.
- [ ] `TokenStore` does not export its class or interface from the plugin module boundary.

---

### P2-S4 — Silent token refresh

**As a** user,
**I want** my session to silently renew before it expires,
**so that** my collaboration session is never interrupted by an authentication timeout.

#### Requirements

`AuthManager.getAccessToken()`:

1. Loads tokens from `TokenStore`.
2. If no tokens, returns `null`.
3. If the access token expiry is more than 60 seconds in the future, returns the access token directly.
4. If the access token is within 60 seconds of expiry (or already expired), attempts a refresh:
   - POSTs to `{serverUrl}/auth/token`:
     ```json
     {
       "grant_type": "refresh_token",
       "refresh_token": "<stored refresh token>",
       "client_id": "obsidian-multiplayer"
     }
     ```
   - On success: saves new tokens, returns new access token.
   - On non-2xx or network failure: calls `signOut()` (which clears tokens and fires `'auth-changed'`), shows notice "Session expired — please sign in again", returns `null`.
5. Concurrent calls during an in-progress refresh await the same refresh promise (no duplicate refresh requests).

#### Acceptance Criteria

- [ ] Given a token with expiry 120 seconds in the future, `getAccessToken()` returns the stored token without making a network request.
- [ ] Given a token with expiry 30 seconds in the future, `getAccessToken()` sends a refresh POST before returning.
- [ ] Given a successful refresh response, `getAccessToken()` returns the new access token and `TokenStore` contains the updated tokens.
- [ ] Given a 401 refresh response, `getAccessToken()` returns `null`, `isAuthenticated` is `false`, and a "Session expired" notice is shown.
- [ ] Given two concurrent `getAccessToken()` calls both needing a refresh, exactly one POST is made to the token endpoint.
- [ ] After a refresh failure, `'auth-changed'` fires exactly once.

---

### P2-S5 — Sign-out

**As a** user,
**I want** to be able to sign out from the settings tab,
**so that** I can switch accounts or revoke the plugin's access.

#### Requirements

`AuthManager.signOut()`:

1. Calls `TokenStore.clear()`.
2. Optionally hits `GET {serverUrl}/auth/logout` (fire-and-forget; failure is silently ignored).
3. Sets `isAuthenticated = false` and `userInfo = null`.
4. Fires `'auth-changed'`.

The settings tab "Sign Out" button calls `plugin.auth.signOut()`. After sign-out, open WebSocket connections are closed (providers call `provider.disconnect()`).

#### Acceptance Criteria

- [ ] After `signOut()`, `isAuthenticated` is `false`.
- [ ] After `signOut()`, `userInfo` is `null`.
- [ ] After `signOut()`, `getAccessToken()` returns `null`.
- [ ] After `signOut()`, `TokenStore.load()` returns `null`.
- [ ] After `signOut()`, `'auth-changed'` fires exactly once.
- [ ] A network failure hitting the logout endpoint does not throw or prevent the local sign-out from completing.
- [ ] Clicking "Sign Out" in the settings tab results in all active `WebsocketProvider` instances calling `provider.disconnect()`.

---

### P2-S6 — Token injection into WebSocket connections

**As a** developer,
**I want** the access token passed as a query parameter on WebSocket connections,
**so that** the server can authenticate the connection.

#### Requirements

- The `// TODO(P2): attach token` placeholder from P1-S4 is replaced.
- Before calling `provider.connect()`, `AuthManager.getAccessToken()` is awaited.
- If the result is `null`, `provider.connect()` is not called; a notice is shown: "Not signed in — cannot connect to room."
- If the result is a token, it is set on the provider via `provider.url` reassignment or by constructing the URL with `?token={accessToken}` before calling `new WebsocketProvider(...)`. Token is passed as a URL query parameter (`token`), not as a WebSocket subprotocol.
- When the WebSocket is closed with code 4001 (Unauthorized), `AuthManager.signOut()` is called and a notice is shown: "Session expired — please sign in again."
- When the WebSocket is closed with code 4003 (Forbidden), a notice is shown: "Access denied to [room name]." The room is removed from `settings.sharedFolders`.
- When the WebSocket is closed with code 4004 (Room not found), a notice is shown: "Room '[name]' no longer exists." The room is removed from `settings.sharedFolders`.

#### Acceptance Criteria

- [ ] `WebsocketProvider` is constructed with `?token=<accessToken>` in the URL.
- [ ] If `getAccessToken()` returns `null`, `provider.connect()` is not called.
- [ ] If `getAccessToken()` returns `null`, a "Not signed in" notice is shown.
- [ ] A WS close with code 4001 triggers `signOut()` and shows a "Session expired" notice.
- [ ] A WS close with code 4003 removes the room from settings and shows an "Access denied" notice.
- [ ] A WS close with code 4004 removes the room from settings and shows a "no longer exists" notice.

---

### P2-S7 — Authentication UI in settings tab

**As a** user,
**I want** the settings tab to show my sign-in status and provide sign-in/out controls,
**so that** I can manage my session without leaving Obsidian.

#### Requirements

The settings tab `MultiplayerSettingTab` is updated:

**Server section:**

```
Server URL   [______________________________]
             (e.g. https://multiplayer.company.com)
```

- Changing the server URL does not immediately trigger sign-in; it updates `settings.serverUrl`.
- A "Test connection" affordance is not required for v1.

**Auth section (shown below server URL):**

When `isAuthenticated` is `true`:
```
● Signed in as alice@company.com     [Sign Out]
```

When `isAuthenticated` is `false`:
```
○ Not signed in                      [Sign In]
```

- The section re-renders whenever `'auth-changed'` fires.
- "Sign In" is disabled (greyed out) if `settings.serverUrl` is empty.
- "Sign Out" calls `plugin.auth.signOut()`.
- "Sign In" calls `plugin.auth.signIn()`. While sign-in is in progress, the button is replaced with "Signing in…" and is disabled.

#### Acceptance Criteria

- [ ] Settings tab renders a "Server URL" text input whose value reflects `settings.serverUrl`.
- [ ] Changing the server URL input updates `settings.serverUrl` and saves settings.
- [ ] When `isAuthenticated` is `false`, the settings tab shows "Not signed in" and a "Sign In" button.
- [ ] When `isAuthenticated` is `true`, the settings tab shows `● Signed in as {email}` and a "Sign Out" button.
- [ ] "Sign In" button is disabled when `settings.serverUrl` is empty.
- [ ] Clicking "Sign In" with a non-empty `serverUrl` calls `AuthManager.signIn()`.
- [ ] Clicking "Sign Out" calls `AuthManager.signOut()`.
- [ ] The auth section updates without requiring a settings tab close/reopen after sign-in or sign-out.
- [ ] While `signIn()` is pending, the button label is "Signing in…" and the button is disabled.

---

### P2-S8 — Connection status bar item

**As a** user,
**I want** a status bar item showing the current sync state,
**so that** I can see at a glance whether the plugin is connected and healthy.

#### Requirements

A status bar item is added in `main.ts` via `this.addStatusBarItem()`.

| Condition | Display text |
|---|---|
| Not signed in | `Multiplayer: not signed in` |
| Signed in, all providers connected and synced | `● Multiplayer` |
| Any provider syncing (initial state transfer in progress) | `⟳ Multiplayer` |
| Any provider disconnected / reconnecting (but not auth error) | `○ Multiplayer` |
| Auth error (after 4001 or refresh failure) | `⚠ Multiplayer: sign in again` |

- Clicking the status bar item when in "sign in again" state opens the settings tab (`plugin.app.setting.open()`; `plugin.app.setting.openTabById(plugin.manifest.id)`).
- Clicking in any other state has no action (or optionally opens settings; either is acceptable).
- The status bar item is removed on plugin unload.

#### Acceptance Criteria

- [ ] A status bar item is present after plugin load.
- [ ] Status bar displays "Multiplayer: not signed in" when `isAuthenticated` is `false`.
- [ ] Status bar displays "● Multiplayer" when signed in and all providers report `connected = true` and `synced = true`.
- [ ] Status bar displays "⟳ Multiplayer" when any provider has `synced = false` (initial sync in progress).
- [ ] Status bar displays "○ Multiplayer" when any provider has `connected = false` (reconnecting) but there is no auth error.
- [ ] Status bar displays "⚠ Multiplayer: sign in again" after a 4001 close or refresh failure.
- [ ] Clicking the status bar item in the "sign in again" state opens the settings tab.
- [ ] Status bar item is removed on plugin unload.
