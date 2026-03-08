---
id: TASK-9
title: '[P2-S2] PKCE sign-in flow'
status: Done
assignee: []
created_date: '2026-03-08 16:26'
updated_date: '2026-03-08 19:31'
labels:
  - enhancement
  - 'epic: P2 - Authentication'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/42'
  - >-
    https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** user, **I want** to click "Sign in" and complete authentication in my browser, **so that** the plugin can act on my behalf without me entering credentials into Obsidian.

Implement the OAuth 2.0 Authorization Code with PKCE flow in `AuthManager.signIn()`. The plugin generates PKCE parameters, opens the system browser to the server's `/auth/authorize` endpoint, receives the callback via `obsidian://multiplayer/callback` protocol handler, exchanges the authorization code for tokens via `POST /auth/token`, and fetches user profile via `GET /auth/userinfo`.

**Key constraints:**
- Public client (no client secret), `client_id = "obsidian-multiplayer"`
- Redirect URI: `obsidian://multiplayer/callback`
- Scope: `openid profile email`
- PKCE parameters (`code_verifier`, `state`) stored in memory only, never persisted
- Only one sign-in flow at a time; duplicate calls reuse the pending promise
- Token storage is stubbed (wired in TASK-10); this task stores tokens via a temporary in-memory holder so `isAuthenticated` and `userInfo` can be set

**Dependencies:** TASK-8 (AuthManager core — Done)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 signIn() opens the system browser to a URL matching `{serverUrl}/auth/authorize?client_id=obsidian-multiplayer&redirect_uri=obsidian://multiplayer/callback&response_type=code&code_challenge={code_challenge}&code_challenge_method=S256&state={state}&scope=openid+profile+email`
- [ ] #2 The constructed URL contains `code_challenge_method=S256`
- [ ] #3 The `code_challenge` is the base64url-encoded SHA-256 hash of the `code_verifier`
- [ ] #4 `obsidian://multiplayer/callback` is registered as a protocol handler on plugin load
- [ ] #5 Given a callback URL with an incorrect `state`, the flow is aborted and a notice is shown; `isAuthenticated` remains `false`
- [ ] #6 Given a callback URL with the correct `state` and `code`, a POST is made to `{serverUrl}/auth/token` with form-urlencoded body: `grant_type=authorization_code&code={code}&code_verifier={code_verifier}&client_id=obsidian-multiplayer&redirect_uri=obsidian://multiplayer/callback`
- [ ] #7 After a successful token response, `isAuthenticated` is `true` and `userInfo` reflects the returned `email` and `name` from `/auth/userinfo`
- [ ] #8 After a successful token response, `'auth-changed'` fires exactly once
- [ ] #9 Given a non-2xx token response, a "Sign-in failed" notice is shown; `isAuthenticated` remains `false`
- [ ] #10 A second call to `signIn()` while the first is pending returns the same promise (no duplicate browser windows)
- [ ] #11 `code_verifier` and `state` are not readable on `AuthManager` after the flow completes or fails
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Phase 1: PKCE Utilities

**File:** `src/auth.ts` (add private helper methods)

1. Add private method `_generateCodeVerifier(): string`
   - Use `crypto.getRandomValues(new Uint8Array(64))` (Web Crypto API)
   - Base64url-encode the result (no padding)

2. Add private method `_generateState(): string`
   - Use `crypto.getRandomValues(new Uint8Array(32))`
   - Base64url-encode the result

3. Add private method `async _computeCodeChallenge(verifier: string): Promise<string>`
   - UTF-8 encode the verifier
   - Hash with `crypto.subtle.digest('SHA-256', ...)`
   - Base64url-encode the hash (no padding)

4. Add private static helper `_base64urlEncode(bytes: Uint8Array): string`
   - Standard base64 → replace `+` with `-`, `/` with `_`, strip `=`

### Phase 2: Sign-In Flow

**File:** `src/auth.ts`

5. Add private fields:
   - `_pendingSignIn: Promise<void> | null` — for deduplication
   - `_codeVerifier: string | null` — cleared after flow
   - `_state: string | null` — cleared after flow
   - `_resolveCallback: ((params: {code: string; state: string}) => void) | null` — bridge between protocol handler and signIn

6. Implement `signIn()`:
   ```
   a. If _pendingSignIn exists, return it (deduplication)
   b. Generate code_verifier, state, code_challenge
   c. Store code_verifier and state in private fields
   d. Create a Promise that waits for the protocol handler callback
   e. Build the authorize URL with all query params
   f. Open browser via window.open() or Obsidian's openExternal
   g. Await the callback promise
   h. Validate state matches
   i. POST to /auth/token with form-urlencoded body
   j. On success: GET /auth/userinfo, set _isAuthenticated, _userInfo, emit 'auth-changed'
   k. On failure: show Notice "Sign-in failed — try again."
   l. Finally: clear _codeVerifier, _state, _pendingSignIn
   ```

### Phase 3: Protocol Handler Registration

**File:** `src/main.ts`

7. In `setup()` or `onload()`, register the protocol handler:
   ```typescript
   this.registerObsidianProtocolHandler('multiplayer/callback', (params) => {
     this.authManager.handleAuthCallback(params)
   })
   ```

8. Add public method `handleAuthCallback(params: ObsidianProtocolData)` to AuthManager:
   - Extract `code` and `state` from params
   - If no pending flow or state mismatch → show Notice, abort
   - Otherwise resolve the callback promise with {code, state}

### Phase 4: Token Exchange & User Info

**File:** `src/auth.ts` (within signIn flow)

9. Implement token exchange (`_exchangeCodeForTokens`):
   - `POST {serverUrl}/auth/token` with `Content-Type: application/x-www-form-urlencoded`
   - Body: `grant_type=authorization_code&code=...&code_verifier=...&client_id=obsidian-multiplayer&redirect_uri=obsidian://multiplayer/callback`
   - Parse JSON response for `access_token`, `refresh_token`, `token_type`, `expires_in`

10. Implement user info fetch (`_fetchUserInfo`):
    - `GET {serverUrl}/auth/userinfo` with `Authorization: Bearer {access_token}`
    - Parse response for `email`, `name`

11. Store tokens temporarily in memory (placeholder for TASK-10 SecretStorage):
    - `_accessToken: string | null`
    - `_refreshToken: string | null`
    - Update `getAccessToken()` to return `_accessToken`

### Phase 5: Tests

**File:** `test/auth.test.ts` (extend existing)

12. Test PKCE utility functions:
    - `_generateCodeVerifier` produces base64url string of correct length
    - `_computeCodeChallenge` produces correct SHA-256 hash
    - Verify base64url encoding (no `+`, `/`, or `=`)

13. Test signIn flow (mock fetch, mock protocol handler):
    - Happy path: signIn → callback with correct state → token exchange → userInfo → isAuthenticated=true
    - State mismatch: callback with wrong state → error notice, isAuthenticated=false
    - Token exchange failure (non-2xx): error notice, isAuthenticated=false
    - Network error: error notice, isAuthenticated=false
    - Concurrent calls: second signIn returns same promise
    - Cleanup: code_verifier and state are null after success/failure

14. Test handleAuthCallback:
    - With no pending flow → no-op / notice
    - With correct state → resolves promise

### Key Design Decisions

- **Callback bridge pattern:** `signIn()` creates a Promise + resolver; `handleAuthCallback()` resolves it. This cleanly separates the browser redirect from the async flow.
- **Deduplication via `_pendingSignIn`:** Simple promise caching prevents multiple browser windows.
- **Token storage is in-memory only for this task.** TASK-10 will wire in SecretStorage persistence. This keeps scope tight.
- **No OIDC discovery:** Per API.md, paths are stable — hardcode `/auth/authorize`, `/auth/token`, `/auth/userinfo`.
- **`window.open` vs Obsidian API:** Use Obsidian's `window.open()` which works cross-platform for opening the system browser.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## API.md Reference

This task implements the OAuth 2.0 PKCE flow from API.md §3.1:

1. Generate PKCE params (`code_verifier`, `code_challenge`, `state`)
2. Open browser to `GET /auth/authorize` with PKCE params
3. Handle `obsidian://multiplayer/callback` protocol handler
4. Exchange code via `POST /auth/token` (form-urlencoded, public client)
5. Fetch user profile via `GET /auth/userinfo` → populates `AuthManager.userInfo`

Client ID: `obsidian-multiplayer`
Redirect URI: `obsidian://multiplayer/callback`
Scope: `openid profile email`

## Key Files

| File | Role |
|------|------|
| `src/auth.ts` | AuthManager — add signIn(), handleAuthCallback(), PKCE helpers |
| `src/main.ts` | Register `obsidian://multiplayer/callback` protocol handler |
| `src/types.ts` | IAuthManager interface (may need handleAuthCallback added) |
| `test/auth.test.ts` | Unit tests |
| `~/dev/tektite-server/API.md` §3.1 | Source of truth for endpoints |

## Token Response Shape (from API.md)

```json
{
  "access_token": "eyJhbG...",
  "refresh_token": "dGhpcyBpcyBh...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

## UserInfo Response Shape

```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "email": "alice@company.com",
  "name": "Alice Chen"
}
```

## Error Response Shape

```json
{
  "error": "invalid_grant",
  "error_description": "Authorization code is invalid or expired"
}
```
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria pass
- [ ] #2 Unit tests cover: PKCE parameter generation, state mismatch rejection, successful token exchange + userInfo flow, non-2xx error handling, concurrent signIn deduplication, cleanup of code_verifier/state
- [ ] #3 No lint errors (`npm run lint`)
- [ ] #4 Build succeeds (`npm run build`)
- [ ] #5 Code reviewed via PR
<!-- DOD:END -->
