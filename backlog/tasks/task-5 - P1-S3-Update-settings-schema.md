---
id: TASK-5
title: '[P1-S3] Update settings schema'
status: Done
assignee: []
created_date: '2026-03-08 16:26'
updated_date: '2026-03-08 17:43'
labels:
  - enhancement
  - 'epic: P1 - Transport Migration'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/38'
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the settings interfaces and migration logic to reflect the new server-centric model, so all code works against a consistent, minimal data shape.

**Target interfaces:**
```typescript
interface MultiplayerSettings {
  serverUrl: string;
  username: string;
  sharedFolders: SharedTypeSettings[];
}

interface SharedTypeSettings {
  guid: string;
  path: string;
  name: string;
}
```

`DEFAULT_SETTINGS` must satisfy `MultiplayerSettings` with `serverUrl: ''`, `username: ''`, `sharedFolders: []`.

A schema migration function runs on plugin load (before any other initialisation reads settings). It is idempotent and drops stale fields (`salt`, `encPw`, `signalingServers`) while filling missing fields with defaults.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 MultiplayerSettings matches the target interface exactly (no extra fields).
- [x] #2 SharedTypeSettings matches the target interface exactly (no extra fields).
- [x] #3 DEFAULT_SETTINGS satisfies MultiplayerSettings with no TypeScript errors.
- [x] #4 TypeScript compilation produces no errors related to settings types.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

No migration needed — plugin has no existing users.

### Files to change

| File | Change |
|------|--------|
| `src/sharedTypes.ts` | Add `name: string` to `SharedTypeSettings` |
| `src/types.ts` | Add `serverUrl: string` to `MultiplayerSettings` |
| `src/main.ts` | Remove local duplicate `MultiplayerSettings`; import from `./types`; add `serverUrl: ''` and set `username: ''` in `DEFAULT_SETTINGS` |
| `test/factories.ts` | Drop `signalingServers` from `makeSharedTypeSettings`, add `name: ''`; add `serverUrl: ''` to `makeMultiplayerSettings` |

### Steps

1. `src/sharedTypes.ts` — add `name: string`
2. `src/types.ts` — add `serverUrl: string`
3. `src/main.ts` — delete local interface; import `MultiplayerSettings` from `./types`; update `DEFAULT_SETTINGS`
4. `test/factories.ts` — update both factories to match new schemas
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria checked off.
- [x] #2 TypeScript compiles with no errors (`tsc --noEmit` or equivalent).
- [x] #3 test/factories.ts updated to match new schemas (no stale fields).
<!-- DOD:END -->
