---
id: TASK-23
title: '[P3-S8] Available rooms list in settings tab'
status: In Progress
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-09 03:17'
labels:
  - enhancement
  - 'epic: P3 - Room Management'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/56'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** user, **I want** to see rooms I have access to but haven't added to my vault, **so that** I can easily add them without needing an invite link.\n\nThe settings tab includes an \"Available rooms\" section below the Collaboration section.\n\nBehaviour:\n1. Populated by `ApiClient.listRooms()`, called when settings tab is opened (if authenticated).\n2. Rooms already in `settings.sharedFolders` (matched by `guid`) are excluded.\n3. If `isAuthenticated` is `false`, shows \"Sign in to see your available rooms.\"\n4. While loading, shows \"Loading rooms…\".\n5. On `ApiError`, shows \"Could not load rooms.\"\n6. \"Add to vault\" opens a folder picker. After selection, creates a `SharedFolder`. Saves settings. Removes the entry from the list.\n7. If no available rooms, shows \"No additional rooms available.\"
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Settings tab calls `ApiClient.listRooms()` when opened and `isAuthenticated` is `true`.
- [ ] #2 Rooms already in `settings.sharedFolders` are not shown in the available list.
- [ ] #3 Each listed room shows name, role, and "Add to vault" button.
- [ ] #4 Clicking "Add to vault" opens a folder picker.
- [ ] #5 After folder selection, the room is added to `settings.sharedFolders` and the entry disappears from the list.
- [ ] #6 When `isAuthenticated` is `false`, a "Sign in" message is shown instead of the list.
- [ ] #7 While `listRooms()` is in flight, a loading message is shown.
- [ ] #8 When `listRooms()` fails, an error message is shown.
- [ ] #9 When the list is empty, "No additional rooms available" is shown.
<!-- AC:END -->
