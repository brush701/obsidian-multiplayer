# P5 — Bug Fixes & Hardening

Known bugs identified in the existing codebase. These are self-contained and can be worked on in parallel with other epics, except where noted.

**Dependencies:** None (each story is independent unless noted)
**Blocks:** Nothing — but these should ship before a public release.

---

## Stories

### P5-S1 — Fix backup restore path parsing (`util.ts:74`)

**As a** developer,
**I want** the backup restore function to correctly parse the room GUID from a backup path,
**so that** restored rooms are associated with the correct document.

#### Problem

`util.ts` line 74 contains:

```typescript
let guid = path[-2]
```

Negative array indexing is not valid in JavaScript. `path[-2]` always evaluates to `undefined`. This means restored documents are associated with `undefined` as their GUID, silently corrupting the restore.

#### Requirements

- The expression `path[-2]` is replaced with correct array indexing:
  ```typescript
  const parts = path.split('/')
  const guid = parts[parts.length - 2]
  ```
- The fix does not change any other logic in the function.
- The variable is changed from `let` to `const` as it is not reassigned.

#### Acceptance Criteria

- [ ] `path[-2]` does not appear anywhere in `util.ts`.
- [ ] Given a backup path `"backups/abc-123/2024-01-01.json"`, the extracted GUID is `"abc-123"`.
- [ ] Given a backup path with a deeply nested structure, the second-to-last path segment is returned as the GUID.
- [ ] TypeScript compilation produces no errors in `util.ts`.
- [ ] The fix is a minimal change — no surrounding logic is altered.

---

### P5-S2 — Fix extension array management in main.ts

**As a** developer,
**I want** CodeMirror extensions to be tracked and removed correctly per document,
**so that** opening and closing shared files does not accumulate stale extensions or cause editor errors.

#### Problem

The current implementation pushes `sharedDoc.binding` into a shared `extensions` array on file open and uses `extensions.length = 0` on close. This approach:

1. Does not remove the extension for the specific closed document — it clears all extensions.
2. Re-adds the same extension on every open, potentially adding duplicates.
3. Is not safe if multiple shared docs are open simultaneously.

#### Requirements

- Extensions are tracked per-document, not in a single shared array.
- On file open, the extension for that specific `SharedDoc` is added to the editor's state via a `Compartment` that is specific to the document instance.
- On file close / `SharedDoc` destroy, only that document's compartment is reconfigured to an empty extension.
- The fix must be safe when multiple shared documents are simultaneously open.
- No `extensions.length = 0` pattern is used.

#### Acceptance Criteria

- [ ] No `extensions.length = 0` appears in `main.ts` or any other source file.
- [ ] Opening a shared file adds exactly one CodeMirror extension entry for that file.
- [ ] Closing a shared file removes exactly that file's extension without affecting other open shared files.
- [ ] Opening the same shared file twice (e.g. in a split pane) does not result in duplicate extension registrations.
- [ ] Opening three shared files, then closing the middle one, leaves the first and third files with their extensions active.
- [ ] TypeScript compilation produces no errors.

---

### P5-S3 — Warn before overwriting local file with remote content

**As a** user,
**I want** to be warned before a remote sync overwrites local content,
**so that** I do not lose work I have done before joining a shared room.

#### Problem

`sharedTypes.ts` lines 56–61 (approximately) open a file for writing without checking whether the file already exists with content. If a user has local notes at the same path, they are silently overwritten on first sync.

#### Requirements

- Before writing remote content to a local file path, check whether a file exists at that path **and** contains non-empty content.
- If the file exists with content, display `FileOverwriteWarningModal` (new modal):

```
┌─ File conflict ─────────────────────────────┐
│                                             │
│  "[path]" already exists in your vault     │
│  with local content.                        │
│                                             │
│  Accepting the remote version will          │
│  overwrite your local changes.              │
│                                             │
│  [ Keep local file ]  [ Accept remote ]    │
└─────────────────────────────────────────────┘
```

- "Keep local file": the write is aborted. The file is not touched. The room remains connected (the Yjs doc will have the remote state, but the file on disk keeps local content; the user is responsible for reconciling manually).
- "Accept remote": the write proceeds. The local file content is overwritten with the remote content.
- If the file does not exist, or exists but is empty, the write proceeds without a modal.
- The modal is shown at most once per file per session. If the user has already chosen for a given path, subsequent syncs for that path follow the same choice without re-prompting.

#### Acceptance Criteria

- [ ] `FileOverwriteWarningModal` is implemented as a new modal with the layout above.
- [ ] Given a file that does not exist, the remote write proceeds without showing the modal.
- [ ] Given a file that exists but is empty (0 bytes), the remote write proceeds without showing the modal.
- [ ] Given a file that exists with non-empty content, `FileOverwriteWarningModal` is shown.
- [ ] Clicking "Keep local file" in the modal does not modify the file on disk.
- [ ] Clicking "Accept remote" in the modal writes the remote content to the file.
- [ ] The room remains connected regardless of which option the user chooses.
- [ ] After choosing "Keep local file" for a path, subsequent sync writes to that path in the same session proceed silently with the "keep local" behaviour (no repeated modal).
- [ ] After choosing "Accept remote" for a path, subsequent sync writes to that path in the same session proceed silently with the "accept remote" behaviour.
- [ ] TypeScript compilation produces no errors.
