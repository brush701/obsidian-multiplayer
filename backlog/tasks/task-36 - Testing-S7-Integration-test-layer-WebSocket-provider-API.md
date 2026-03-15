---
id: TASK-36
title: '[Testing-S7] Integration test layer (WebSocket provider + API)'
status: In Progress
assignee: []
created_date: '2026-03-08 16:27'
updated_date: '2026-03-15 15:12'
labels:
  - enhancement
  - 'epic: Testing'
dependencies: []
references:
  - 'https://github.com/brush701/obsidian-multiplayer/issues/70'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Integration test layer exercising WebSocket provider and HTTP API client against realistic fakes/VCR cassettes. Tests target the seams between plugin and server to catch boundary failures and data contract issues.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Integration tests run with `npm run test:integration`
- [x] #2 VCR cassettes (nock) exist for all ApiClient methods
- [x] #3 WS close code tests run against a local test server (not production)
- [x] #4 API client tests verify correct serialization/deserialization against recorded responses
- [x] #5 Expired access token triggers refresh before API call proceeds
- [x] #6 Cassettes tagged with server API version
- [x] #7 `npm run record-cassettes` script exists for re-recording
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

### API Client Integration Tests (nock VCR cassettes)
- 11 cassette JSON files in `test/integration/cassettes/` covering all `TektiteApiClient` methods
- Each cassette tagged with `apiVersion`, `serverVersion`, `recordedAt`
- Tests use `fetchRequestUrl` adapter (Node `fetch`) so nock can intercept real HTTP
- Cassette discipline test ensures all cassettes have API version metadata
- Token refresh tests verify `getAccessToken()` called per-request (not cached)

### WebSocket Close Code Integration Tests
- Local WS test server using `ws` package (random port, zero config)
- Tests close codes 4001 (unauthorized), 4003 (forbidden), 4004 (not found)
- Tests that `disconnect()` in close handler prevents reconnection
- Tests transient disconnect recovery (normal close → auto reconnect)
- Document convergence transport test (two providers connect to same room)

### Infrastructure
- `vitest.integration.config.ts` — separate config for integration test layer
- `npm run test:integration` — runs integration tests only
- `npm run record-cassettes` — re-record cassettes against live server
- `scripts/record-cassettes.ts` — recording script with version detection
- Default `npm test` excludes `test/integration/` (fast CI layer)
<!-- SECTION:NOTES:END -->
