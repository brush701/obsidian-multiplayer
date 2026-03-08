---
id: TASK-9
title: '[P2-S2] PKCE sign-in flow'
status: To Do
assignee: []
created_date: '2026-03-08 16:26'
updated_date: '2026-03-08 18:38'
labels:
  - enhancement
  - 'epic: P2 - Authentication'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/42'
  - >-
    https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
---

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## API.md Reference\n\nThis task implements the OAuth 2.0 PKCE flow from API.md §3.1:\n\n1. Generate PKCE params (`code_verifier`, `code_challenge`, `state`)\n2. Open browser to `GET /auth/authorize` with PKCE params\n3. Handle `obsidian://multiplayer/callback` protocol handler\n4. Exchange code via `POST /auth/token` (form-urlencoded, public client)\n5. Fetch user profile via `GET /auth/userinfo` → populates `AuthManager.userInfo`\n\nClient ID: `obsidian-multiplayer`\nRedirect URI: `obsidian://multiplayer/callback`\nScope: `openid profile email`
<!-- SECTION:NOTES:END -->
