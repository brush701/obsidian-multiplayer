---
id: TASK-13
title: '[P2-S6] Token injection into WebSocket connections'
status: To Do
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-08 18:38'
labels:
  - enhancement
  - 'epic: P2 - Authentication'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/46'
  - >-
    https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
---

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## API.md Reference\n\nAPI.md §5 — WebSocket connection:\n\n```typescript\nnew WebsocketProvider(\n  `${serverUrl}/room/${guid}`,\n  guid,\n  ydoc,\n  { params: { token: await auth.getAccessToken() } }\n)\n```\n\nClose codes to handle:\n- `4001` Unauthorized → clear tokens, show \"Session expired\" notice\n- `4003` Forbidden → show \"no access\" notice, remove room from shared folders\n- `4004` Room not found → show notice, remove room from shared folders
<!-- SECTION:NOTES:END -->
