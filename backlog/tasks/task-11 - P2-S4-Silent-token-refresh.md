---
id: TASK-11
title: '[P2-S4] Silent token refresh'
status: In Progress
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-08 20:48'
labels:
  - enhancement
  - 'epic: P2 - Authentication'
dependencies:
  - TASK-8
  - TASK-10
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/44'
  - >-
    https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** user, **I want** my session to silently renew before it expires, **so that** my collaboration session is never interrupted by an authentication timeout.

## Requirements

`AuthManager.getAccessToken()` must be enhanced to:

1. Load tokens from `TokenStore`.
2. If no tokens, return `null`.
3. If access token expiry is more than 60 seconds in the future, return the access token directly.
4. If within 60 seconds of expiry (or already expired), attempt a refresh:
   - POST to `{serverUrl}/auth/token` with `grant_type=refresh_token`, `refresh_token`, `client_id`.
   - On success: save new tokens (both access and refresh are rotated), return new access token.
   - On non-2xx or network failure: call `signOut()`, show notice "Session expired — please sign in again", return `null`.
5. Concurrent calls during an in-progress refresh must await the same refresh promise (no duplicate requests).

## Spec Reference

`docs/epics/P2-authentication.md` — P2-S4

**Dependencies:** P2-S1 (TASK-8), P2-S3 (TASK-10)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Given a token with expiry 120s in the future, `getAccessToken()` returns the stored token without making a network request
- [ ] #2 Given a token with expiry 30s in the future, `getAccessToken()` sends a refresh POST before returning
- [ ] #3 Given a successful refresh response, `getAccessToken()` returns the new access token and `TokenStore` contains the updated tokens
- [ ] #4 Given a 401 refresh response, `getAccessToken()` returns `null`, `isAuthenticated` is `false`, and a "Session expired" notice is shown
- [ ] #5 Given two concurrent `getAccessToken()` calls both needing a refresh, exactly one POST is made to the token endpoint
- [ ] #6 After a refresh failure, `auth-changed` fires exactly once
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Step 1: Add expiry check to `getAccessToken()` in `src/auth.ts`

Currently `getAccessToken()` simply returns the cached `_accessToken` if authenticated. Enhance it to:

- Call `_tokenStore.load()` to get `StoredTokens` (which includes `expiresAt`)
- Parse `expiresAt` and compare to `Date.now()`
- If more than 60s remaining → return `_accessToken` directly
- If ≤60s remaining or expired → call new `_refreshTokens()` method

### Step 2: Implement `_refreshTokens(): Promise<string | null>` in `src/auth.ts`

New private method:

```
POST {serverUrl}/auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
refresh_token={stored_refresh_token}
client_id=obsidian-multiplayer
```

On success (2xx):
- Parse response JSON: `{ access_token, refresh_token, expires_in, token_type }`
- Compute new `expiresAt` = `Date.now() + expires_in * 1000`
- Call `_tokenStore.save()` with new tokens + existing user info
- Update `_accessToken` in memory
- Return new access token

On failure (non-2xx or network error):
- Call `this.signOut()`
- Show `new Notice('Session expired — please sign in again')`
- Return `null`

### Step 3: Add concurrent refresh deduplication

Add a `_pendingRefresh: Promise<string | null> | null` field to `AuthManager`.

In `getAccessToken()`, before calling `_refreshTokens()`:
- If `_pendingRefresh` is not null, `await` and return it
- Otherwise, set `_pendingRefresh = this._refreshTokens()`, await it, clear `_pendingRefresh`, return result

This ensures multiple concurrent callers share a single refresh request.

### Step 4: Update `restoreSession()` to use new `getAccessToken()` logic

Currently `restoreSession()` checks expiry and clears tokens if expired. Update it to attempt a refresh if tokens are expired but refresh token may still be valid (refresh tokens have 30-day sliding window).

### Step 5: Write unit tests

Test file: `test/auth.test.ts` (extend existing)

Tests to write:
1. **Fresh token** — mock TokenStore with expiry 120s ahead, verify no fetch call, correct token returned
2. **Near-expiry token** — mock TokenStore with expiry 30s ahead, mock fetch to return new tokens, verify POST body, verify new token returned and stored
3. **Successful refresh stores both tokens** — verify TokenStore.save() called with new access + refresh tokens
4. **Failed refresh (401)** — mock fetch returning 401, verify signOut() called, Notice shown, null returned
5. **Concurrent deduplication** — call getAccessToken() twice simultaneously with near-expiry token, verify fetch called exactly once
6. **Auth-changed event on failure** — verify event fires exactly once on refresh failure

### Key Design Decisions

- **Refresh threshold: 60 seconds** — per API.md §3.2, refresh proactively before expiry
- **Token rotation** — both access and refresh tokens change on each refresh (OAuth best practice, required by server)
- **No retry on failure** — a failed refresh means the session is invalid; sign out cleanly
- **Deduplication via promise caching** — simple, race-free pattern already used for `_pendingSignIn`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## API.md Reference\n\nAPI.md §3.2 — Token Refresh:\n\n- `POST /auth/token` with `grant_type=refresh_token`\n- Both `access_token` and `refresh_token` are rotated — must store both\n- Refresh when within 60 seconds of expiry (before WebSocket connect or API call)\n- On refresh failure (`invalid_grant`): clear all tokens, show \"Session expired\" notice, set auth state to signed-out\n\nToken lifetimes (§3.4):\n- Access token: 1 hour\n- Refresh token: 30 days sliding, expires if unused for 7 days
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All 6 acceptance criteria pass in unit tests
- [ ] #2 No new lint warnings introduced
- [ ] #3 Token refresh logic matches API.md §3.2 contract exactly
- [ ] #4 Concurrent refresh deduplication verified with test
<!-- DOD:END -->
