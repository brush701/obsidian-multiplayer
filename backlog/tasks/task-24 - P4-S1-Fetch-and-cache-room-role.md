---
id: TASK-24
title: '[P4-S1] Fetch and cache room role'
status: To Do
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-08 18:38'
labels:
  - enhancement
  - 'epic: P4 - Permissions'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/57'
  - >-
    https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
---

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## API.md Reference\n\nAPI.md §4 — `GET /api/rooms/:guid/me` returns `{ role: RoomRole }`.\n\nThe `MyRoleResult` type is already defined in `src/types.ts`. Use this endpoint to fetch and cache the user's effective role per room for determining read-only mode.
<!-- SECTION:NOTES:END -->
