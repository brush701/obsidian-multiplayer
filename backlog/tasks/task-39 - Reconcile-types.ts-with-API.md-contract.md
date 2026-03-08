---
id: TASK-39
title: Reconcile types.ts with API.md contract
status: Done
assignee: []
created_date: '2026-03-08 18:17'
updated_date: '2026-03-08 19:32'
labels:
  - enhancement
  - tech-debt
dependencies:
  - TASK-8
references:
  - ~/dev/tektite-server/API.md
  - src/types.ts
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The types in `src/types.ts` — `RoomSummary`, `RoomDetail`, `RoomMember`, `ApiClient`, and `RoomRole` — were written before the server API contract (`~/dev/tektite-server/API.md`) was finalized and are now out of date.\n\nThis task updates all shared types to match the API contract exactly, so that downstream tasks (P3 API client, P4 permissions) build on correct foundations.\n\n**Note:** `AuthManager` interface and `StoredTokens` are handled by TASK-8. This task covers everything else in types.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 RoomRole type uses uppercase: "OWNER" | "EDITOR" | "VIEWER"
- [ ] #2 RoomListItem type matches API: { guid, name, role, orgId }
- [ ] #3 RoomDetail type matches API: { guid, name, orgId, openToOrg, members }
- [ ] #4 RoomMember type matches API: { userId, email, name, role }
- [ ] #5 ApiClient interface covers all REST endpoints from API.md (rooms CRUD, invites, join, members)
- [ ] #6 Old RoomSummary type removed or replaced
- [ ] #7 All consumers of changed types updated (no TypeScript errors)
- [ ] #8 ApiError type added matching API.md error schema
<!-- AC:END -->
