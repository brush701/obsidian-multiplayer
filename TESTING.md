# AGENTS.md — AI-Native Development & Testing Framework

> This document defines how AI agents and human collaborators work together across the full development lifecycle: from spec authorship through testing, integration validation, and UAT. It is intended as a living guide for vibe coding workflows where AI participates deeply at every stage.

---

## Table of Contents

1. [Core Philosophy](#core-philosophy)
2. [The Human-AI Collaboration Model](#the-human-ai-collaboration-model)
3. [Spec-First Development](#spec-first-development)
4. [Test Architecture](#test-architecture)
5. [Mocks, Fakes, and Fixtures](#mocks-fakes-and-fixtures)
6. [Integration Testing: Network Strategy](#integration-testing-network-strategy)
7. [UAT and Playwright MCP](#uat-and-playwright-mcp)
8. [UI Conventions for MCP Robustness](#ui-conventions-for-mcp-robustness)
9. [Coverage Policy](#coverage-policy)
10. [Language Guidance](#language-guidance)
11. [CI/CD Layering](#cicd-layering)
12. [PR Checklist](#pr-checklist)

---

## Core Philosophy

AI development changes the economics of testing in two important ways:

- **Test generation is cheap** — AI can produce tests quickly, which creates pressure toward quantity over quality
- **Code generation is fast but opaque** — AI-generated implementations may pass obvious tests while hiding subtle behavioral bugs

The response to both risks is the same: **specs are the source of truth**. If the spec is correct and complete, tests are largely derivable from it and implementations are verifiable against it. Human energy concentrates on spec quality, not test volume.

A test that doesn't correspond to a spec item is a liability — it will pass, provide false confidence, and become wrong when requirements change.

---

## The Human-AI Collaboration Model

In vibe coding, humans and AI are collaborators throughout — not a human-reviews-AI-output model. The roles look like this:

| Activity | Human Role | AI Role |
|---|---|---|
| Spec development | Provide intent, domain context, business rules | Draft structured spec, extrapolate edge cases, propose failure modes |
| Test case ideation | Validate cases, own security/auth boundaries | Generate happy path and systematic edge cases |
| Test implementation | Approve assertions and critical cases | Generate boilerplate, parametrized cases, factory functions |
| Integration test design | Own system topology and data contracts | Reason about failure modes and boundary conditions |
| UAT specification | Describe workflows, validate outcomes | Draft scenarios, operate browser via Playwright MCP |
| Coverage analysis | Interpret gaps, decide what matters | Run tooling, flag uncovered spec items |
| Test maintenance | Approve intent changes | Update tests for refactors |

**The critical gate:** AI can observe that "the page shows a success message" but only a human can confirm that message represents correct behavior. Never skip human validation of UAT assertions.

**Anti-pattern to avoid:** AI generates both implementation and tests for the same code without human review. This creates a closed loop where tests reflect what the code does, not what it should do.

---

## Spec-First Development

The recommended workflow:

```
1. Human describes intent (conversational, natural language)
2. AI drafts structured spec (with edge cases, failure modes, acceptance criteria)
3. Human reviews and refines spec
4. AI generates tests from spec
5. AI generates implementation from spec + tests
6. Human validates behavior (UAT)
```

### Spec Template

Every feature or component spec should include:

```markdown
## Feature: [Name]

### Intent
[2-3 sentences describing what this does and why, in plain language]

### Acceptance Criteria
- [ ] [Criterion 1 — observable, testable]
- [ ] [Criterion 2]
- [ ] ...

### Edge Cases
- [What happens when input is empty/null/malformed]
- [What happens on network failure]
- [What happens at scale limits]
- [Auth/permission boundaries]

### Explicitly Out of Scope
- [What this feature does NOT do — forces conscious decisions]

### Open Questions
- [Unresolved decisions that need human input]
```

### Test Suite Header

Every test file should begin with a comment block:

```
# Suite: [Component Name]
# Scope: [Unit | Integration | UAT]
# Spec: [link or reference to spec]
# Author: [human who specified these cases]
#
# What this suite validates:
#   [2-3 sentences in plain English]
#
# What is explicitly NOT tested here:
#   [intentional gaps]
#
# Critical cases (require human review before deletion):
#   - [list]
```

---

## Test Architecture

### The Three Layers

**Unit Tests**

Unit tests in AI development are primarily a *spec document* — they describe what a function should do and catch regressions when AI modifies it. Key principles:

- Test cases must be reviewed by a human before or alongside implementation, not after
- Each test validates a single named behavior — not just "returns X" but *why X is correct*
- Mock at system boundaries only — not inside the system under test
- AI generates boilerplate and parametrized cases; humans own edge case selection
- Property-based testing (Hypothesis/fast-check) is a standard tool, not an afterthought — especially valuable for catching what neither human nor AI thought to specify

**Integration Tests**

AI-generated components often work in isolation but fail at boundaries. Integration tests target exactly those seams. Key principles:

- Run against real or high-fidelity dependencies (see [Network Strategy](#integration-testing-network-strategy))
- Focus on: error propagation, timeout behavior, data contract validation, auth boundary enforcement
- AI can assist with case generation but human authorship matters more here — these tests require system context
- Consider contract tests (Pact) for internal service-to-service boundaries

**UAT / Acceptance Tests**

These answer "did we build the right thing?" Key principles:

- Co-authored: human provides workflow intent, AI drafts and automates via Playwright MCP
- Must trace directly to acceptance criteria in the spec
- Cover *workflows*, not just features — the path a real user takes
- Human validates all assertions before tests enter the suite

### The Pyramid

```
         ┌─────────────────────────────┐
         │         UAT / E2E           │  Co-authored spec (human intent + AI draft)
         │                             │  Playwright MCP for authorship & replay
         ├─────────────────────────────┤
         │       Integration           │  Human-owned topology, AI-assisted cases
         │                             │  VCR replay or fakes in CI, live for smoke
         ├─────────────────────────────┤
         │          Unit               │  Spec co-authored, AI-generated implementation
         │                             │  Property-based testing standard
         │                             │  Factories over static fixtures
         └─────────────────────────────┘
```

---

## Mocks, Fakes, and Fixtures

### Test Double Taxonomy

Use precise terminology — these are not interchangeable:

| Type | Behavior | When to Use |
|---|---|---|
| **Stub** | Returns hardcoded values, no behavior | You need a return value and don't care about call verification |
| **Mock** | Records calls, verifies interactions | You need to assert *that* something was called, *how*, *how many times* |
| **Fake** | Working implementation, simplified | In-memory DB, fake SMTP — behaves like real thing, lightweight |
| **Spy** | Wraps real object, records calls | You want real behavior plus observability |
| **Fixture** | Static test data | Shared input/expected-output data across tests |

**The golden rule:** Mock at the boundary of your system, not inside it. If you're testing a service that calls a repository that calls a database — mock the repository, not the database driver. Everything inside the boundary should use real collaborators.

**AI over-mocking:** AI tends to mock everything because it's locally easy to specify. Actively review AI-generated tests for excessive mocking. If a test mocks three things to test one function, that's a signal.

### Fixtures: Prefer Factories Over Static Files

Static fixtures (JSON/YAML files) create maintenance burden as data shapes evolve. Prefer factory functions:

```python
# Python — Object Mother pattern
def make_initiative(overrides=None):
    base = {
        "id": str(uuid4()),
        "name": "Test Initiative",
        "status": "on_track",
        "owner": "test-user",
        "program_id": "test-program",
        "created_at": datetime.now(UTC),
    }
    return {**base, **(overrides or {})}

# In tests — express only what's different
at_risk = make_initiative({"status": "at_risk"})
unowned = make_initiative({"owner": None})
```

This pattern lets each test express *what's meaningful about this case* without boilerplate repetition. AI is good at generating factories once the pattern is established.

### Property-Based Testing

Use property-based testing to find the cases neither you nor the AI specified:

```python
# Python — Hypothesis
from hypothesis import given, strategies as st

@given(st.text(min_size=1, max_size=255))
def test_initiative_name_roundtrips(name):
    initiative = make_initiative({"name": name})
    saved = save_and_reload(initiative)
    assert saved.name == name
```

Recommended tools: **Hypothesis** (Python), **fast-check** (TypeScript), **gopter** (Go).

Make property-based testing a standard part of unit test suites for AI-generated code — it finds the weird edge cases that matter.

---

## Integration Testing: Network Strategy

### The Options

**Live Integration** — tests against real external services

- ✅ No fidelity gap, catches real API changes
- ❌ Slow, flaky, costly, can't easily test error conditions
- **Use for:** smoke tests and final pre-release validation. Not for regular CI.

**VCR / Record-Replay** — record real HTTP interactions once, replay in tests

- ✅ Fast, deterministic, high fidelity to real response shapes
- ❌ Cassettes go stale; creates false confidence against outdated snapshots
- **Use for:** the majority of integration tests in CI
- **Discipline required:** cassettes must be re-recorded on a schedule or when API versions change — not just when tests break. Tag cassettes with API version or schema hash.
- **Tools:** VCR.py (Python), Polly.js / nock (TypeScript), go-vcr (Go)

**Fakes / Service Virtualization** — run a fake version of the external service

- ✅ Fast, supports stateful interactions, controllable error injection
- ❌ Fakes drift from reality; community fakes vary in quality
- **Use for:** services with good community fakes — AWS (localstack), Stripe (stripe-mock), Postgres/MySQL (testcontainers), Kafka (embedded)
- **Avoid:** building custom fakes for obscure services — maintenance cost is high

**Contract Tests** — verify both sides of an integration match expectations

- ✅ Catches breaking changes, scales across microservices
- ❌ Requires provider buy-in, not practical for third-party APIs
- **Use for:** internal service-to-service boundaries
- **Tools:** Pact

### Decision Framework

```
Is the service internal (you control both sides)?
  → Yes: Contract tests + fakes for fast CI feedback

Does a good community fake exist? (localstack, stripe-mock, testcontainers)
  → Yes: Use fake in CI, live for smoke tests

How frequently do tests hit this service?
  → High: VCR replay + scheduled re-recording
  → Low: Live integration is probably acceptable
```

---

## UAT and Playwright MCP

### What Playwright MCP Enables

Traditional UAT automation:
```
Human describes workflow → Specialist writes Playwright code → Test runs
```

With Playwright MCP:
```
Human describes workflow → AI agent navigates browser → Test artifact generated
```

UAT authorship becomes genuinely collaborative between non-technical stakeholders and AI — the human provides intent and validates outcomes; the AI operates the browser and produces the test.

### Authorship Workflow

```
1. Human describes the workflow in plain language
2. AI agent navigates the actual application via MCP
3. Human observes execution — catches UX issues, missing states, confusing flows
4. AI generates assertions based on what it observes
5. Human validates assertions represent correctness, not just current behavior  ← critical gate
6. Generated test is committed to the suite
```

### Execution Patterns

| Pattern | Mechanism | Best For |
|---|---|---|
| **Record-then-replay** | MCP drives once, generates static Playwright test | Regular CI — fast, deterministic |
| **Agent-driven** | AI agent re-navigates each run | Smoke tests — resilient to minor UI changes |
| **Hybrid** | MCP for authorship and re-recording, static test for CI | Recommended default |

### Managing Drift

UAT tests anchor to current UI state and will drift. Mitigations:

- **Prefer semantic selectors** — ARIA roles, `aria-label`, `data-testid` over CSS classes or XPath. MCP naturally prefers these; reinforce it.
- **Re-record on a schedule** — treat UAT tests like VCR cassettes. Re-record after significant UI changes, not just when tests break.
- **Keep scenarios short and focused** — decompose long workflows into smallest independently verifiable steps. Long multi-step tests are fragile regardless of tooling.
- **Seeded test data** — tests that find "any initiative" are fragile; tests that navigate to a known ID are stable. Maintain a reset-able UAT dataset.

**Human validation is non-negotiable.** Never let MCP-generated assertions enter the suite without human review of their correctness.

---

## UI Conventions for MCP Robustness

These conventions make Playwright MCP reliable. Most are good practice regardless — MCP just gives you extra incentive to be disciplined.

### `data-testid` Naming Convention

Name by domain entity and role, not implementation:

```
{domain-entity}-{element-type}-{qualifier}

Examples:
  initiative-row-{id}
  initiative-status-{id}
  cpr-meeting-summary-panel
  program-health-badge
  filter-dropdown-status
  initiative-form-submit
  initiative-list-loading
  initiative-list-ready
  initiative-empty-state
```

Establish this convention early. AI codegen will follow the pattern once it's in the codebase.

### ARIA and Accessibility Markup

Playwright MCP prefers ARIA-based selectors because they're semantic and stable. Good accessibility markup = robust test selectors for free.

```html
<!-- Label interactive elements -->
<button aria-label="Add initiative to program">+</button>
<input aria-label="Filter by initiative status" />
<dialog aria-label="Edit initiative details">...</dialog>

<!-- Use landmark roles -->
<nav aria-label="Program navigation">...</nav>
<main aria-label="Initiative list">...</main>
<aside aria-label="CPR meeting summary">...</aside>

<!-- Mark async status regions -->
<div role="status" aria-live="polite" data-testid="save-status">
  Saving...
</div>
```

### Async and Loading States

Most Playwright flakiness comes from tests running assertions during transitional UI states. Never rely on `waitForTimeout`. Always give the agent a semantic signal to wait on.

```html
<!-- Explicit loading state — agent waits for this to resolve -->
<div data-testid="initiative-list-loading" aria-busy="true">...</div>
<div data-testid="initiative-list-ready">...</div>

<!-- Disabled during async operation -->
<button disabled aria-disabled="true" data-testid="initiative-form-submit">
  Saving...
</button>
```

### Error States

Error states must be consistently structured and identifiable for UAT failure-path coverage:

```html
<!-- Validation errors -->
<div role="alert" data-testid="form-error" aria-live="assertive">
  Initiative name is required
</div>

<!-- API/system errors -->
<div role="alert" data-testid="api-error" aria-live="assertive">
  Failed to save. Please try again.
</div>
```

`role="alert"` + `aria-live="assertive"` lets the agent listen for errors to appear without polling.

### Page and View Identity

Give the agent clear signals about which view it's on:

```html
<main data-page="initiative-detail" data-initiative-id="{id}">
```

Critical for multi-step UAT scenarios — the agent verifies navigation succeeded before proceeding.

### Consistent Interaction Patterns

Agents learn patterns. Establish one canonical pattern for each interaction type and document them:

| Interaction | Convention |
|---|---|
| Open edit modal | Click element with `aria-label="Edit {entity}"` |
| Confirm destructive action | Always a `<dialog>` with confirm/cancel |
| Success feedback | Always `role="status"` toast with `data-testid="toast-success"` |
| Empty states | Always `data-testid="{entity}-empty-state"` |
| Inline status | Always `data-testid="{entity}-status-{id}"` |

Document these in a UI pattern guide and share it as AI context during vibe coding sessions.

### Feature Flags (non-production only)

Expose active feature flags in a queryable location:

```html
<html data-features="initiative-tagging,cpr-export">
```

or via a `/debug/features` endpoint. Prevents the agent from asserting on features that aren't enabled in the current environment.

---

## Coverage Policy

### What We Measure

| Metric | Target | Layer | Notes |
|---|---|---|---|
| Line coverage | ~80% | Unit | Floor, not ceiling — skip trivial/untestable code intentionally |
| Branch coverage | 100% on critical paths | Unit | More meaningful than line coverage |
| Spec coverage | 100% | All | Every acceptance criterion has a corresponding test |
| Workflow coverage | All defined workflows | UAT | Checklist-based, not percentage |

**Do not require 100% line coverage.** It optimizes for the metric, not for catching bugs. AI will generate tests that cover lines without asserting anything meaningful.

### Mutation Testing

The best signal of test quality — tells you whether tests would catch bugs, not just whether they execute lines.

- **Python:** [Mutmut](https://github.com/boxed/mutmut)
- **TypeScript:** [Stryker](https://stryker-mutator.io/)
- **Go:** [go-mutesting](https://github.com/zimmski/go-mutesting)

Run on PRs touching core logic, not every commit. Gate merges on mutation score for critical modules.

### Spec Coverage as the Primary Gate

Track whether every acceptance criterion in a spec has a corresponding test. A simple approach: acceptance criteria as checklist items in the spec, linked tests in the test suite header. This is the right metric for AI-native development because the spec is the source of truth.

---

## Language Guidance

If language choice is open, apply this decision framework:

| Layer | Recommended | Rationale |
|---|---|---|
| AI/LLM tooling, agents, data pipelines | **Python** | Best ecosystem (pytest, Hypothesis, LangChain, etc.) |
| Full-stack product with shared types | **TypeScript** | Type safety across API boundary, Vitest/Jest maturity |
| Backend services needing production hardening | **Go** | Testability by convention, strong interfaces, minimal magic |

### Testing Ergonomics by Language

| | Python | TypeScript | Go |
|---|---|---|---|
| Test framework | pytest | Vitest / Jest | testing (stdlib) |
| Property-based | Hypothesis | fast-check | gopter |
| VCR/replay | VCR.py | Polly.js / nock | go-vcr |
| Mocking | unittest.mock | Vitest mocks / sinon | testify/mock |
| Factories | Custom / factory_boy | Custom / fishery | Custom |
| Mutation testing | Mutmut | Stryker | go-mutesting |

Go is underrated for testability — its conventions (interfaces everywhere, minimal magic) force testable code. The tradeoff is a thinner ecosystem for AI/ML tooling.

---

## CI/CD Layering

```
┌─────────────────────────────────────────────────────────────┐
│  FAST CI — every commit (~5 min)                            │
│                                                             │
│  • Unit tests (mocks/stubs at system boundary)              │
│  • Linting, type checking                                   │
│  • Property-based tests (sampled, not exhaustive)           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  SLOW CI — PR merge / nightly (~20 min)                     │
│                                                             │
│  • Integration tests (fakes or VCR replay)                  │
│  • Contract tests (internal service boundaries)             │
│  • Static Playwright UAT tests (against staging)            │
│  • Mutation testing (PRs touching core logic)               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  SMOKE / PRE-RELEASE — on demand                            │
│                                                             │
│  • Live integration tests (real services, critical paths)   │
│  • MCP agent-driven UAT (human observes)                    │
│  • Full property-based test suite (exhaustive)              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  UAT SIGN-OFF — per release                                 │
│                                                             │
│  • Human-in-the-loop session with Playwright MCP            │
│  • Stakeholder describes scenarios, AI executes             │
│  • Human approves outcomes and generated assertions         │
│  • Re-record any drifted test cassettes                     │
└─────────────────────────────────────────────────────────────┘
```

---

## PR Checklist

### Every PR

```
□ New code has corresponding spec items (or links to existing spec)
□ Tests reference spec items in suite header
□ Mocks are at system boundaries only — no internal over-mocking
□ No static fixtures where a factory function would be clearer
```

### PRs with new UI components

```
□ Interactive elements have data-testid with domain-meaningful names
□ Inputs and buttons have aria-labels
□ Loading/busy states marked with aria-busy or dedicated testid
□ Error states use role="alert" with consistent testid naming
□ Success/confirmation feedback uses role="status"
□ View/page is identifiable via data-page or consistent heading
□ Empty states have a testid
□ Interaction patterns follow established conventions (see pattern guide)
```

### PRs touching core logic

```
□ Mutation testing score reviewed (Mutmut / Stryker / go-mutesting)
□ Branch coverage on critical paths verified
□ Property-based tests cover key invariants
```

### UAT scenario additions

```
□ Scenario traces to an acceptance criterion
□ Test data uses seeded dataset with known IDs
□ Assertions reviewed by a human — not just accepted from MCP output
□ Cassette tagged with environment/API version if VCR-based
```

---

*This document should evolve with the project. When a new pattern is established, add it here. When a convention is abandoned, remove it — a stale AGENTS.md is worse than none.*
