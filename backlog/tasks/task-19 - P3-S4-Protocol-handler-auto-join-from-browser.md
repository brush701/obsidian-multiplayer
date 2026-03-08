---
id: TASK-19
title: '[P3-S4] Protocol handler: auto-join from browser'
status: To Do
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-08 18:38'
labels:
  - enhancement
  - 'epic: P3 - Room Management'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/52'
  - >-
    https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
---

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## API.md Reference\n\nAPI.md §6 — Protocol handler `obsidian://multiplayer/join`:\n\nQuery params: `guid`, `name`, `server`\n\nPlugin action: prompt user to select local folder → create SharedFolder with `{ guid, name, path }` → begin sync.\n\nPrecondition: user must be signed in. If not, show \"Sign in first\" notice.
<!-- SECTION:NOTES:END -->
