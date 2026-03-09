---
id: TASK-24
title: '[P4-S1] Fetch and cache room role'
status: Done
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-09 04:28'
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

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Already implemented. SharedFolder.cachedRole and _fetchRole() exist in sharedTypes.ts, called automatically on WebSocket connect. Used to gate UI in main.ts context menu and MembersModal. All tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
