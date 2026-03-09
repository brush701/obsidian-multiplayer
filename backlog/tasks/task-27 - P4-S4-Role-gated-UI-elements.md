---
id: TASK-27
title: '[P4-S4] Role-gated UI elements'
status: Done
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-09 15:37'
labels:
  - enhancement
  - 'epic: P4 - Permissions'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/60'
  - 'https://github.com/brush701/obsidian-multiplayer/pull/102'
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 "Invite to [Room Name]" is hidden when `SharedFolder.role === 'VIEWER'`
- [x] #2 "Invite to [Room Name]" is visible when `SharedFolder.role === 'OWNER'`
- [x] #3 "Invite to [Room Name]" is visible when `SharedFolder.role === 'EDITOR'`
- [x] #4 "Invite to [Room Name]" is visible when `SharedFolder.role === null`
- [x] #5 "Invite someone new" in MembersModal is hidden when the room role is VIEWER
- [x] #6 "Invite someone new" in MembersModal is visible for OWNER and EDITOR
- [x] #7 The InviteModal "Copy Invite Link" button is disabled when the role is VIEWER
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Most role gating was already in place from prior tasks (context menu in main.ts:101, MembersModal in modals.ts:550). Added defence-in-depth: disabled the \"Copy Invite Link\" button in InviteModal when `cachedRole === 'VIEWER'`. Improved test mock `createEl` to return chainable elements. PR #102.
<!-- SECTION:FINAL_SUMMARY:END -->
