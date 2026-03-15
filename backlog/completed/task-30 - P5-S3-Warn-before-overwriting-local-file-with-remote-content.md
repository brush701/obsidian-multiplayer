---
id: TASK-30
title: '[P5-S3] Warn before overwriting local file with remote content'
status: Done
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-12 03:35'
labels:
  - enhancement
  - 'epic: P5 - Bug Fixes'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/63'
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FileOverwriteWarningModal is implemented as a new modal with the specified layout
- [ ] #2 Given a file that does not exist, the remote write proceeds without showing the modal
- [ ] #3 Given a file that exists but is empty (0 bytes), the remote write proceeds without showing the modal
- [ ] #4 Given a file that exists with non-empty content, FileOverwriteWarningModal is shown
- [ ] #5 Clicking Keep local file does not modify the file on disk
- [ ] #6 Clicking Accept remote writes the remote content to the file
- [ ] #7 The room remains connected regardless of which option the user chooses
- [ ] #8 After choosing Keep local file for a path, subsequent sync writes proceed silently with keep local behaviour
- [ ] #9 After choosing Accept remote for a path, subsequent sync writes proceed silently with accept remote behaviour
- [ ] #10 TypeScript compilation produces no errors
<!-- AC:END -->
