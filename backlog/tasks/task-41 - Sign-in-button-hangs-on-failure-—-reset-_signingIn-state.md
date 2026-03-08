---
id: TASK-41
title: Sign-in button hangs on failure — reset _signingIn state
status: To Do
assignee: []
created_date: '2026-03-08 23:48'
labels:
  - bug
  - auth
dependencies: []
references:
  - src/auth.ts
  - src/main.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When sign-in fails (e.g., server error, user abandons browser flow), the settings tab button stays stuck on "Signing in…" and is disabled. The user must restart Obsidian to clear the state.

**Root cause:** In `auth.ts:_doSignIn()`, the `callbackPromise` (line 119) waits indefinitely for the OAuth callback via `handleAuthCallback`. If the callback never arrives (server down, user closes browser, etc.), the promise never resolves or rejects, so `_signingIn` in `main.ts` stays `true` forever.

**Fix:** Add a timeout (e.g., 2 minutes) to the callback promise so it rejects and the `finally` block in the onClick handler resets `_signingIn`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 If the OAuth callback is not received within a reasonable timeout, the sign-in promise rejects and the button resets to 'Sign In' (enabled)
- [ ] #2 User does not need to restart Obsidian to retry sign-in after a failure
<!-- AC:END -->
