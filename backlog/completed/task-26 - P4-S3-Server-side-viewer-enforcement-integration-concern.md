---
id: TASK-26
title: '[P4-S3] Server-side viewer enforcement (integration concern)'
status: Done
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-09 04:53'
labels:
  - enhancement
  - 'epic: P4 - Permissions'
dependencies:
  - TASK-25
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/59'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verification-only task: confirm the plugin behaves correctly when the server silently drops updates from VIEWER users. No plugin code changes are needed — the server enforces the constraint, and the client-side read-only facet (TASK-25) prevents updates from being generated.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No plugin code attempts to detect whether the server has dropped a Yjs update message.
- [x] #2 No error notice is shown to a VIEWER user as a result of the server discarding their updates.
- [x] #3 Given a VIEWER opens a file, edits are prevented client-side; the document content matches the server state within 2 seconds of connecting.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Verification Result\n\nAll three acceptance criteria confirmed satisfied with no code changes:\n\n1. **No dropped-update detection** — searched entire `src/` directory; no code checks for or handles dropped Yjs update messages.\n2. **No VIEWER error notices** — `Notice` usage is limited to auth/access WebSocket close codes (4001, 4003, 4004). Nothing related to update drops.\n3. **Client-side read-only** — `EditorState.readOnly.of(true)` is applied for VIEWER role via `SharedDoc.binding` (src/sharedTypes.ts:274-295). Comprehensive test coverage in `test/shared-doc-role.test.ts` covers initial binding, EditorView reconciliation, and dynamic role transitions.\n\nThe plugin correctly relies on:\n- CodeMirror read-only facet to prevent updates from being generated (defense-in-depth)\n- Server-side silent drop of any updates that slip through\n- Yjs CRDT reconciliation on next server sync push"
<!-- SECTION:FINAL_SUMMARY:END -->
