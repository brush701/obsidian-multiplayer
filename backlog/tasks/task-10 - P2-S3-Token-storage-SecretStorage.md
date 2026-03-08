---
id: TASK-10
title: '[P2-S3] Token storage (SecretStorage)'
status: Done
assignee: []
created_date: '2026-03-08 16:26'
updated_date: '2026-03-08 20:40'
labels:
  - enhancement
  - 'epic: P2 - Authentication'
dependencies:
  - TASK-9
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/43'
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a `TokenStore` class that persists OAuth tokens securely using Obsidian's LocalForage-backed SecretStorage (`this.app.vault.adapter.store`), keeping tokens out of `data.json` and Obsidian Sync.

The `TokenStore` stores five keys (`mp-access-token`, `mp-refresh-token`, `mp-token-expiry`, `mp-user-email`, `mp-user-name`) and exposes `save()`, `load()`, and `clear()` methods. It is internal to the plugin — not exported from the module boundary.

This replaces the in-memory token fields (`_accessToken`, `_refreshToken`) currently in `AuthManager` (see `src/auth.ts:49-51`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After `save(tokens)`, `load()` returns a `StoredTokens` object equal to the saved value
- [x] #2 After `clear()`, `load()` returns `null`
- [x] #3 After `save()` followed by `clear()`, `load()` returns `null`
- [x] #4 `load()` returns `null` if only a subset of the five keys exist in storage
- [x] #5 None of the stored keys appear in `plugin.settings` or `data.json`
- [x] #6 `TokenStore` class and `StoredTokens` interface are not exported from the plugin module boundary
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Step 1: Update Obsidian mock to support SecretStorage

**File:** `test/__mocks__/obsidian.ts`

- Add `store(key, value)`, `load(key)`, and `remove(key)` methods to a new `DataAdapter` class (backed by an in-memory `Map`)
- Update `App` class to expose `vault.adapter` as a `DataAdapter` instance
- This unblocks all TokenStore tests

### Step 2: Create TokenStore class

**File:** `src/tokenStore.ts` (new)

- Define `StoredTokens` interface (not exported from plugin boundary):
  ```
  { accessToken, refreshToken, expiresAt, email, name }
  ```
- Define storage key constants:
  ```
  mp-access-token, mp-refresh-token, mp-token-expiry, mp-user-email, mp-user-name
  ```
- Implement `TokenStore` class (not exported from plugin boundary):
  - Constructor takes `App` instance
  - `save(tokens: StoredTokens): Promise<void>` — writes all 5 keys via `this.app.vault.adapter.store()`
  - `load(): Promise<StoredTokens | null>` — reads all 5 keys; returns `null` if any key is missing/null
  - `clear(): Promise<void>` — removes all 5 keys via `this.app.vault.adapter.remove()`

### Step 3: Write TokenStore unit tests

**File:** `test/tokenStore.test.ts` (new)

Test cases:
1. `save()` then `load()` returns matching StoredTokens
2. `clear()` then `load()` returns null
3. `save()` then `clear()` then `load()` returns null
4. `load()` returns null when only subset of keys exist
5. `load()` returns null on fresh adapter (no keys)
6. `save()` overwrites previous values

### Step 4: Integrate TokenStore into AuthManager

**File:** `src/auth.ts`

- Import `TokenStore` and `StoredTokens` (file-internal, not re-exported)
- Add `_tokenStore: TokenStore` field, initialized in constructor from `app`
- In `_doSignIn()` (after token exchange + userInfo fetch):
  - Compute `expiresAt` from `expires_in` response field
  - Call `this._tokenStore.save(...)` with all token data
- In `signOut()`:
  - Call `this._tokenStore.clear()`
- In `getAccessToken()`:
  - Keep returning `this._accessToken` (still cached in memory for performance)
- Remove the old in-memory `_accessToken` and `_refreshToken` fields — replace with reads from TokenStore where needed
- Add a `restoreSession()` method that calls `this._tokenStore.load()` and restores auth state if tokens exist and haven't expired (this enables session persistence across app restarts)

### Step 5: Update existing auth tests

**File:** `test/auth.test.ts`

- The `App` mock now has `vault.adapter` — existing tests should pass without changes
- Verify existing tests still pass; fix any that break due to mock shape changes

### Step 6: Verify

- Run `npm test` — all tests pass
- Run `npm run lint` — no lint errors
- Verify `TokenStore` is not in the plugin's public exports
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary\n\n### Files changed:\n- `src/tokenStore.ts` (new) — `TokenStore` class with `save()`, `load()`, `clear()` + `StoredTokens` interface\n- `src/auth.ts` — Integrated `TokenStore`, added `restoreSession()`, removed `_refreshToken` in-memory field\n- `src/types.ts` — Added `restoreSession()` to `IAuthManager` interface\n- `test/__mocks__/obsidian.ts` — Added `DataAdapter` with `store/load/remove`, `Vault` class, updated `App` and `FileSystemAdapter`\n- `test/tokenStore.test.ts` (new) — 6 unit tests for TokenStore\n\n### Design notes:\n- `SecretAdapter` interface casts Obsidian's undocumented `DataAdapter.store/load/remove` LocalForage methods\n- `restoreSession()` checks token expiry and clears expired tokens automatically\n- In-memory `_accessToken` cache kept for `getAccessToken()` performance\n\n### Node version note:\n`.nvmrc` specifies Node 22 but shell defaulted to Node 16 (vitest requires Node 18+). Tests run with `nvm use 22`."
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 TokenStore class implemented in src/tokenStore.ts with save/load/clear methods
- [x] #2 AuthManager updated to use TokenStore instead of in-memory token fields
- [x] #3 Unit tests for TokenStore (save/load/clear/partial-keys scenarios)
- [x] #4 Existing auth.test.ts tests still pass with TokenStore integration
- [x] #5 Obsidian mock updated to support vault.adapter.store/load/remove
- [x] #6 All tests pass (`npm test`)
- [x] #7 Code lints cleanly (`npm run lint`)
<!-- DOD:END -->
