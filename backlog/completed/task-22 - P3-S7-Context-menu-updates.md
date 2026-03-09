---
id: TASK-22
title: '[P3-S7] Context menu updates'
status: Done
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-09 03:04'
labels:
  - enhancement
  - 'epic: P3 - Room Management'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/55'
  - 'https://github.com/brush701/obsidian-multiplayer/pull/99'
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Right-click on a shared folder shows 'Delete Multiplayer Shared Folder', 'Invite to [Room Name]', and 'Room members'
- [x] #2 'Invite to [Room Name]' is not shown when the cached role is VIEWER
- [x] #3 Clicking 'Invite to [Room Name]' opens InviteModal scoped to that room
- [x] #4 Clicking 'Room members' opens MembersModal scoped to that room
- [x] #5 'Copy GUID' does not appear
- [x] #6 'Copy Password' does not appear
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `cachedRole` to `SharedFolder` (fetched via `getMyRole()` on WS connect). Context menu hides \"Invite to [Room Name]\" for VIEWER role. PR #99."
<!-- SECTION:FINAL_SUMMARY:END -->
