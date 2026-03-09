---
id: TASK-20
title: '[P3-S5] InviteModal'
status: In Progress
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-09 00:25'
labels:
  - enhancement
  - 'epic: P3 - Room Management'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/53'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** user, **I want** to generate and copy an invite link from Obsidian, **so that** I can share a room with a colleague without opening a browser.\n\n`InviteModal` is a new modal opened from the \"Invite to [Room Name]\" context menu item.\n\nLayout: Role radio buttons (Editor/Viewer), expiry dropdown (1 day / 7 days / 30 days), and \"Copy Invite Link\" button.\n\nBehaviour:\n1. Default role: Editor. Default expiry: 7 days.\n2. Clicking \"Copy Invite Link\" calls `ApiClient.createInvite(guid, role, expiresIn)`.\n3. While in flight, button is disabled and shows \"Generating…\".\n4. On success, the returned URL is written to clipboard. Notice: \"Invite link copied.\"\n5. The modal remains open (user may generate additional invites).\n6. On `ApiError`: notice \"Could not create invite: {message}.\"\n7. Only accessible to OWNER or EDITOR roles."
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 InviteModal renders with role radio buttons (Editor / Viewer) and expiry dropdown (1 day / 7 days / 30 days).
- [ ] #2 Default role is Editor; default expiry is 7 days.
- [ ] #3 Clicking "Copy Invite Link" calls ApiClient.createInvite with the selected role and expiry.
- [ ] #4 While in flight, the button is disabled and shows "Generating…".
- [ ] #5 On success, the invite URL is written to the clipboard.
- [ ] #6 On success, a "Invite link copied" notice is shown.
- [ ] #7 The modal remains open after a successful link generation.
- [ ] #8 On ApiError, a notice is shown with the error message.
- [ ] #9 The "Invite to [Room Name]" context menu item is not shown to users whose local cached role for the room is VIEWER.
<!-- AC:END -->
