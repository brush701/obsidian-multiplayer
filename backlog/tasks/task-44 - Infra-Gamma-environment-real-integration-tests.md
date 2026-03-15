---
id: TASK-44
title: 'Infra: Gamma environment + real integration tests'
status: To Do
assignee: []
created_date: '2026-03-15 16:05'
labels:
  - enhancement
  - 'epic: Testing'
  - infrastructure
dependencies:
  - TASK-36
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/70'
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Set up an always-on shared gamma environment for real integration testing against tektite-server. Current "contract tests" validate the plugin's assumptions about the API contract using hand-authored cassettes and a toy WS server — they don't test actual server behaviour.

Real integration tests should hit a live tektite-server instance to catch boundary failures like response shape mismatches, auth flow issues, close code timing, and Yjs sync through the full server stack.

## Architecture decisions (agreed)

- **Separate infra repo** (e.g. `tektite-infra`) — docker-compose for tektite-server + postgres, environment configs, deployment scripts
- **Always-on shared gamma instance** — persistent environment that CI and developers point at for integration tests and cassette recording
- **Plugin CI calls gamma** for the integration test stage

## Scope

1. Create `tektite-infra` repo with docker-compose (tektite-server + postgres + seed data)
2. Deploy gamma instance (hosting TBD — VPS, cloud, etc.)
3. Write real integration tests in obsidian-multiplayer that hit the gamma server:
   - API client tests against live endpoints (replaces hand-authored cassettes)
   - WS close code tests against real tektite-server (expired JWT → 4001, non-member → 4003, bad GUID → 4004)
   - Document convergence through the full server stack
4. Add `npm run test:integration` script that requires `GAMMA_URL` env var
5. Add CI job that runs integration tests against gamma on master push
6. Update `record-cassettes` script to record from gamma and refresh contract test cassettes
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tektite-infra repo exists with docker-compose for tektite-server + postgres
- [ ] #2 Gamma instance is deployed and accessible
- [ ] #3 Real integration tests exist that hit the gamma server API endpoints
- [ ] #4 WS close code tests run against gamma's WebSocket endpoint
- [ ] #5 Document convergence test runs through gamma's full Yjs sync stack
- [ ] #6 `npm run test:integration` runs against gamma (requires GAMMA_URL)
- [ ] #7 CI runs integration tests against gamma on master push
- [ ] #8 record-cassettes script records from gamma to refresh contract test cassettes
<!-- AC:END -->
