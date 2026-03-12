---
id: TASK-29
title: '[P5-S2] Fix extension array management in main.ts'
status: Done
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-12 03:28'
labels:
  - bug
  - 'epic: P5 - Bug Fixes'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/62'
---

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed in PR #104 (merged). Extracted DocExtensionManager class that tracks extensions per-document using CodeMirror Compartments instead of a shared array. Eliminates `extensions.length = 0` pattern and is safe for multiple simultaneous shared docs.
<!-- SECTION:FINAL_SUMMARY:END -->
