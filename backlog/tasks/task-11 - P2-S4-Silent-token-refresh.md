---
id: TASK-11
title: '[P2-S4] Silent token refresh'
status: To Do
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-08 18:38'
labels:
  - enhancement
  - 'epic: P2 - Authentication'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/44'
  - >-
    https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
---

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## API.md Reference\n\nAPI.md §3.2 — Token Refresh:\n\n- `POST /auth/token` with `grant_type=refresh_token`\n- Both `access_token` and `refresh_token` are rotated — must store both\n- Refresh when within 60 seconds of expiry (before WebSocket connect or API call)\n- On refresh failure (`invalid_grant`): clear all tokens, show \"Session expired\" notice, set auth state to signed-out\n\nToken lifetimes (§3.4):\n- Access token: 1 hour\n- Refresh token: 30 days sliding, expires if unused for 7 days
<!-- SECTION:NOTES:END -->
