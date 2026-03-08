---
id: TASK-4
title: '[P1-S2] Remove WebRTC provider'
status: Done
assignee: []
created_date: '2026-03-08 16:26'
updated_date: '2026-03-08 16:41'
labels:
  - enhancement
  - 'epic: P1 - Transport Migration'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/37'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remove the WebRTC signaling infrastructure so the dependency on third-party signaling servers and the `y-webrtc` package is fully eliminated. This is P1-S2 of the transport migration epic; once complete the codebase has no remaining WebRTC provider code and is ready for the new transport to be wired in (P1-S3).

**GitHub issue:** https://github.com/brush701/obsidian-multiplayer/issues/37

### Background

The plugin currently uses `y-webrtc` (`WebrtcProvider`) for real-time CRDT sync in both `SharedFolder` (root doc) and `SharedDoc` (per-file doc). Each `SharedTypeSettings` entry persists a `signalingServers` array alongside `guid` and `path`. Removing WebRTC leaves IndexedDB-only persistence; cursor awareness is disabled until the new transport is added in the next story.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `y-webrtc` does not appear in `package.json` `dependencies` or `devDependencies`.
- [x] #2 `yarn install` / `npm install` completes without installing `y-webrtc`.
- [x] #3 No `import` or `require` of `y-webrtc` exists in the source tree.
- [x] #4 `SharedTypeSettings` interface contains no `signalingServers` field.
- [x] #5 Settings tab renders without any signaling server URL input.
- [x] #6 TypeScript compilation produces no errors related to removed symbols.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview
Strip all `y-webrtc` / `WebrtcProvider` references across four files and remove the package dependency. No settings migration needed.

---

### Step 1 — Remove `y-webrtc` from `package.json`
- Delete the `"y-webrtc": "^10.2.3"` line from `dependencies`.
- Run `npm install` to regenerate the lock file.

---

### Step 2 — `src/sharedTypes.ts`

**`SharedTypeSettings` interface (line 14–18)**
- Remove `signalingServers: string[]` field.

**`SharedFolder` class**
- Remove `import { WebrtcProvider } from 'y-webrtc'` (line 4).
- Remove `private _provider: WebrtcProvider` field.
- Remove the `new WebrtcProvider(...)` instantiation in the constructor (line 49).

**`SharedDoc` class**
- Remove `private _provider: WebrtcProvider` field (line 162).
- Remove the `new WebrtcProvider(...)` call in the constructor (line 198).
- Update the `binding` getter: replace `this._provider.awareness` with `null` (yCollab accepts `Awareness | null`) to disable cursor presence until the next transport story. Remove the `setLocalStateField` call.
- Update `connect()` (line 215–220): remove the provider guard and `this._provider.connect()` call; keep only the persistence guard.
- Update `close()` (line 224–233): remove `this._provider.disconnect()`, `this._provider.destroy()`, and `this._provider = null` lines.
- Update `destroy()` (line 235–242): remove the `this._provider` block.

---

### Step 3 — `src/modals.ts`

- Remove `const DEFAULT_SIGNALING_SERVERS = 'wss://signaling.tektite.team'` (line 6).
- In `SharedFolderModal.onOpen()` form submit handler:
  - Remove `const servers = DEFAULT_SIGNALING_SERVERS` and `const signalingServers = servers.split(',')` (lines 59–60).
  - Remove `signalingServers` from the settings object literal (line 63); keep `{ guid, path }`.

---

### Step 4 — `src/types.ts`

- Remove `signalingServers: string[]` from `RoomDetail` interface (line 30).
- Update `ApiClient.createRoom` signature from `createRoom(name: string, signalingServers: string[]): Promise<RoomSummary>` to `createRoom(name: string): Promise<RoomSummary>` (line 55).

---

### Step 5 — Verify

- `npm run build` → zero TypeScript errors.
- `grep -r y-webrtc src package.json` → no matches.
- Load in Obsidian dev vault, create a shared folder, open a note → no console errors.

---

### Key files
| File | Change |
|---|---|
| `package.json` | Remove `y-webrtc` dependency |
| `src/sharedTypes.ts` | Remove import, provider fields, WebrtcProvider instantiation, awareness refs |
| `src/modals.ts` | Remove signaling server constant and `signalingServers` from settings object |
| `src/types.ts` | Remove `signalingServers` from `RoomDetail` and `createRoom` signature |
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed all `y-webrtc` / `WebrtcProvider` references across the codebase:\n- `package.json`: removed `y-webrtc` from devDependencies\n- `src/sharedTypes.ts`: removed import, `signalingServers` from `SharedTypeSettings`, provider fields from both `SharedFolder` and `SharedDoc`, WebrtcProvider instantiations, awareness usage in binding getter (now passes `null`), and provider calls in `connect`/`close`/`destroy`. Also cleaned up now-unused `lib0/random` import.\n- `src/modals.ts`: removed `DEFAULT_SIGNALING_SERVERS` constant and `signalingServers` from the settings object.\n- `src/types.ts`: removed `signalingServers` from `RoomDetail` and the `createRoom` signature.\n\nBuild passes with zero TypeScript errors. No y-webrtc references remain in the repo.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria pass.
- [x] #2 TypeScript compiles with no errors (`npm run build` or equivalent).
- [x] #3 Manual smoke test: plugin loads in Obsidian, shared folder can be created and removed without console errors.
- [x] #4 No `y-webrtc` references remain in the repo (verified with grep).
<!-- DOD:END -->
