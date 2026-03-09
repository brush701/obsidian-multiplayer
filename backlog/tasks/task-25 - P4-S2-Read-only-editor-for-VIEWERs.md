---
id: TASK-25
title: '[P4-S2] Read-only editor for VIEWERs'
status: In Progress
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-09 04:31'
labels:
  - enhancement
  - 'epic: P4 - Permissions'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/58'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**As a** user with the VIEWER role, **I want** the document to open in read-only mode, **so that** I cannot accidentally modify content and my changes are not rejected by the server.\n\nIn SharedDoc, the CodeMirror extension composition checks the role:\n- VIEWER: yCollab without UndoManager, EditorState.readOnly=true, visual indicator\n- null (unknown): default read-write\n- Late role arrival: dynamically reconfigure via Compartment
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When role is VIEWER, yCollab() is called without an UndoManager
- [ ] #2 When role is VIEWER, EditorState.readOnly facet is true and keystrokes do not modify content
- [ ] #3 When role is VIEWER, a visual indicator (Read only) is visible in the editor
- [ ] #4 When role is null, editor opens in read-write mode
- [ ] #5 When role transitions from null to VIEWER on open file, editor becomes read-only without close/reopen
- [ ] #6 When role is OWNER or EDITOR, editor is fully editable with no read-only indicator
- [ ] #7 Ctrl+Z in VIEWER mode does not modify the document
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add @codemirror/view dependency (for EditorView, showPanel)\n2. Modify SharedDoc to accept role from SharedFolder.cachedRole\n3. Use Compartment for readOnly facet so it can be reconfigured dynamically\n4. Modify binding getter: skip UndoManager for VIEWER, add readOnly + panel\n5. Add method to update role after binding is created (for late role arrival)\n6. In main.ts file-open handler, pass role and handle role updates\n7. Write tests
<!-- SECTION:PLAN:END -->
