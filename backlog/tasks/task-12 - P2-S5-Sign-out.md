---
id: TASK-12
title: '[P2-S5] Sign-out'
status: Done
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-08 21:18'
labels:
  - enhancement
  - 'epic: P2 - Authentication'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/45'
  - >-
    https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
  - 'https://github.com/brush701/obsidian-multiplayer/pull/88'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** user, **I want** to be able to sign out from the settings tab, **so that** I can switch accounts or revoke the plugin's access.\n\n## Requirements\n\n`AuthManager.signOut()`:\n1. Calls `TokenStore.clear()`.\n2. Optionally hits `GET {serverUrl}/auth/logout` (fire-and-forget; failure is silently ignored).\n3. Sets `isAuthenticated = false` and `userInfo = null`.\n4. Fires `'auth-changed'`.\n\nAfter sign-out, open WebSocket connections are closed (`provider.disconnect()`).\n\n## Spec Reference\n`docs/epics/P2-authentication.md` — P2-S5\n\n**Dependencies:** P2-S1 (TASK-8), P2-S3 (TASK-10)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After `signOut()`, `isAuthenticated` is `false`.
- [x] #2 After `signOut()`, `userInfo` is `null`.
- [x] #3 After `signOut()`, `getAccessToken()` returns `null`.
- [x] #4 After `signOut()`, `TokenStore.load()` returns `null`.
- [x] #5 After `signOut()`, `'auth-changed'` fires exactly once.
- [x] #6 A network failure hitting the logout endpoint does not throw or prevent the local sign-out from completing.
- [x] #7 Clicking "Sign Out" in the settings tab results in all active `WebsocketProvider` instances calling `provider.disconnect()`.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan\n\n### Step 1: Enhance `AuthManager.signOut()` — fire-and-forget server logout\n**File:** `src/auth.ts` (line ~186)\n\nThe current `signOut()` already clears local state (`_isAuthenticated`, `_userInfo`, `_accessToken`), calls `_tokenStore.clear()`, and emits `auth-changed`. What's missing is the optional server-side logout call.\n\n- Before clearing tokens, capture the current access token\n- Fire a `GET {serverUrl}/auth/logout` with `Authorization: Bearer {token}` in a fire-and-forget manner (no await, catch all errors silently)\n- Keep existing local cleanup logic unchanged — the local sign-out must never be blocked by the network call\n\n```ts\nasync signOut(): Promise<void> {\n  // Fire-and-forget server-side logout (best-effort)\n  if (this._accessToken) {\n    fetch(`${this._settings.serverUrl}/auth/logout`, {\n      headers: { Authorization: `Bearer ${this._accessToken}` },\n    }).catch(() => { /* silently ignore */ })\n  }\n\n  this._isAuthenticated = false\n  this._userInfo = null\n  this._accessToken = null\n  this._tokenStore.clear()\n  this._emit('auth-changed')\n}\n```\n\n### Step 2: Disconnect WebSocket providers on sign-out\n**File:** `src/main.ts`\n\nThe plugin's `Multiplayer` class holds `sharedFolders: SharedFolder[]`, each of which owns a `WebsocketProvider`. On auth-changed (when `isAuthenticated` becomes false), all shared folders must be disconnected.\n\n- In `setup()`, register an `auth-changed` listener on `this.authManager`\n- When `isAuthenticated` flips to `false`, call `sharedFolder.destroy()` on every active shared folder (this calls `provider.destroy()` internally per `sharedTypes.ts`)\n- Clear the `sharedFolders` array and update extensions\n\n```ts\n// In setup(), after authManager is created:\nthis.authManager.on('auth-changed', () => {\n  if (!this.authManager.isAuthenticated) {\n    this.sharedFolders.forEach(f => f.destroy())\n    this.sharedFolders = []\n    this._extensions.length = 0\n    this.app.workspace.updateOptions()\n    this.refreshIconStyles()\n  }\n})\n```\n\n### Step 3: Add \"Sign Out\" button to settings tab\n**File:** `src/main.ts` — `MultiplayerSettingTab.display()`\n\nAdd a sign-out button that is conditionally shown when the user is authenticated.\n\n```ts\nif (this.plugin.authManager.isAuthenticated) {\n  const userInfo = this.plugin.authManager.userInfo\n  new Setting(containerEl)\n    .setName('Signed in')\n    .setDesc(`Signed in as ${userInfo?.email ?? 'unknown'}`)\n    .addButton(btn => {\n      btn.setButtonText('Sign Out')\n        .setWarning()\n        .onClick(async () => {\n          await this.plugin.authManager.signOut()\n          this.display() // re-render settings tab\n        })\n    })\n}\n```\n\n### Step 4: Write unit tests\n**File:** `test/auth.test.ts` (extend existing test file)\n\nTests to add:\n1. `signOut()` sets `isAuthenticated` to `false`\n2. `signOut()` sets `userInfo` to `null`\n3. `signOut()` causes `getAccessToken()` to return `null`\n4. `signOut()` causes `TokenStore.load()` to return `null`\n5. `signOut()` emits `auth-changed` exactly once\n6. `signOut()` completes successfully even when the logout endpoint fails (mock fetch to reject)\n7. `signOut()` fires the server logout request with the correct Bearer token (verify fetch was called)\n\n### Step 5: Lint and verify\n- Run `npm run lint` and fix any issues\n- Run `npm test` to confirm all tests pass\n\n### Summary of files changed\n| File | Change |\n|---|---|\n| `src/auth.ts` | Add fire-and-forget `GET /auth/logout` call in `signOut()` |\n| `src/main.ts` | Add auth-changed listener to disconnect providers; add Sign Out button to settings |\n| `test/auth.test.ts` | Add 7 unit tests for sign-out behavior |
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## API.md Reference\n\nAPI.md §3.3 — Sign-Out:\n\n- Clear all tokens from SecretStorage (keys: `mp-access-token`, `mp-refresh-token`, `mp-token-expiry`, `mp-user-email`, `mp-user-name`)\n- Optionally call `GET /auth/logout` with Bearer token to revoke refresh token server-side\n- Plugin does not need to wait for the logout response
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## PR #88 — feat: implement sign-out (TASK-12)\n\n### Changes\n- **`src/auth.ts`** — `signOut()` now fires a best-effort `GET /auth/logout` with Bearer token before clearing local state (fire-and-forget, errors silently caught)\n- **`src/main.ts`** — Auth-changed listener destroys all SharedFolder/WebSocket providers on sign-out; \"Sign Out\" button added to settings tab (shows email, re-renders on click)\n- **`test/auth.test.ts`** — 8 new sign-out tests (expanded from 2) covering all 7 acceptance criteria\n\n### Test results\n- 68/68 tests pass, no regressions\n- No new lint errors in changed files\n- DoD #3 (manual smoke test) pending reviewer verification
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All 7 acceptance criteria pass in unit tests
- [x] #2 No lint errors (`npm run lint`)
- [ ] #3 Manual smoke test: sign out from settings tab clears auth state and disconnects providers
<!-- DOD:END -->
