---
id: TASK-42
title: Switch OAuth redirect to loopback HTTP server (RFC 8252 §7.3)
status: Done
assignee: []
created_date: '2026-03-08 23:48'
updated_date: '2026-03-09 03:13'
labels:
  - auth
  - enhancement
dependencies: []
references:
  - src/auth.ts
  - 'https://datatracker.ietf.org/doc/html/rfc8252#section-7.3'
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The current OAuth flow uses `obsidian://multiplayer/callback` as the redirect URI, but the server's OIDC provider correctly enforces RFC 8252 §7.1 which requires reverse-DNS format for custom URI schemes. This means the `obsidian://` scheme doesn't work properly.

**Solution:** Implement the RFC 8252 §7.3 loopback interface redirect pattern — the standard way desktop/CLI apps handle OAuth:

1. Start a temporary HTTP server on `http://127.0.0.1` with a random port
2. Use `http://127.0.0.1:{port}/callback` as the `redirect_uri`
3. Receive the auth code at that callback endpoint
4. Shut down the temp server and proceed with token exchange

The tektite-server already accepts `http://127.0.0.1/callback` and `http://localhost/callback` with any port.

This also naturally solves the sign-in hang bug (TASK-19) since the HTTP server can be shut down on timeout, but both issues should be addressed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Plugin starts a temporary HTTP server on 127.0.0.1 with a random available port when sign-in begins
- [x] #2 redirect_uri is set to http://127.0.0.1:{port}/callback
- [x] #3 Auth code is received via the HTTP callback and exchanged for tokens
- [x] #4 Temporary HTTP server is shut down after receiving the callback or on timeout
- [x] #5 The obsidian:// protocol handler registration for auth callback is removed
- [x] #6 Sign-in flow works end-to-end with the server's OIDC provider
<!-- AC:END -->
