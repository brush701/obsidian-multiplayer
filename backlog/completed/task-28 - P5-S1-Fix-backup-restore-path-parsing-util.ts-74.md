---
id: TASK-28
title: '[P5-S1] Fix backup restore path parsing (util.ts:74)'
status: Done
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-12 03:27'
labels:
  - bug
  - 'epic: P5 - Bug Fixes'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/61'
---

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed in PR #103 (merged). Replaced invalid `path[-2]` negative array indexing with correct `path.split("/")` and `components[components.length - 2]` approach.
<!-- SECTION:FINAL_SUMMARY:END -->
