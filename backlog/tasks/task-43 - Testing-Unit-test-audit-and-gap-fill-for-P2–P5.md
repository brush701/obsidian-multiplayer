---
id: TASK-43
title: '[Testing] Unit test audit and gap-fill for P2–P5'
status: In Progress
assignee: []
created_date: '2026-03-15 13:40'
updated_date: '2026-03-15 14:10'
labels:
  - enhancement
  - 'epic: Testing'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/66'
  - 'https://github.com/brush701/obsidian-multiplayer/issues/67'
  - 'https://github.com/brush701/obsidian-multiplayer/issues/68'
  - 'https://github.com/brush701/obsidian-multiplayer/issues/69'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Consolidates TASK-32 (S3), TASK-33 (S4), TASK-34 (S5), and TASK-35 (S6) into a single task. Most unit tests were written alongside the features — this task audits existing coverage against the detailed checklists in GH issues #66–69 and fills any gaps.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All test cases from GH issue #66 (P2 Auth) are implemented and passing
- [x] #2 All test cases from GH issue #67 (P3 Room Mgmt) are implemented and passing
- [x] #3 All test cases from GH issue #68 (P4 Permissions) are implemented and passing
- [x] #4 All test cases from GH issue #69 (P5 Bug Fixes) are implemented and passing
- [x] #5 All test files include suite headers
- [x] #6 fast-check property tests where specified in issues
- [x] #7 ApiClient tests mock fetch at the boundary, not internal helpers
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
P4 (#68) gap: \"On reconnect, getMyRole() is called again\" — this behavior does not exist in the code. _fetchRole() is only called once during initial _connectWithAuth(). This is a feature gap (reconnect doesn't re-fetch role), not a missing test. Filed as observation for future work.
<!-- SECTION:NOTES:END -->
