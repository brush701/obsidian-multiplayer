---
id: TASK-12
title: '[P2-S5] Sign-out'
status: To Do
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-08 18:38'
labels:
  - enhancement
  - 'epic: P2 - Authentication'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/45'
  - >-
    https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
---

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## API.md Reference\n\nAPI.md §3.3 — Sign-Out:\n\n- Clear all tokens from SecretStorage (keys: `mp-access-token`, `mp-refresh-token`, `mp-token-expiry`, `mp-user-email`, `mp-user-name`)\n- Optionally call `GET /auth/logout` with Bearer token to revoke refresh token server-side\n- Plugin does not need to wait for the logout response
<!-- SECTION:NOTES:END -->
