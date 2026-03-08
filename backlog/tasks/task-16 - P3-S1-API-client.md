---
id: TASK-16
title: '[P3-S1] API client'
status: To Do
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-08 18:38'
labels:
  - enhancement
  - 'epic: P3 - Room Management'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/49'
  - >-
    https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
---

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Post-TASK-39 Update

`src/types.ts` now has the full `ApiClient` interface matching all 11 REST endpoints from API.md §4. Types (`RoomListItem`, `RoomDetail`, `RoomMember`, `CreateRoomResult`, `JoinResult`, `InviteResponse`, `MemberRoleResult`, `MyRoleResult`, `VersionInfo`, `ApiError`) are all aligned. This task should implement the concrete class against these types.
<!-- SECTION:NOTES:END -->
