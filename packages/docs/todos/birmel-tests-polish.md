---
id: birmel-tests-polish
type: todo
status: in-progress
board: true
verification: operator
disposition: blocked
source_marker: false
---

# Birmel 3.0 production acceptance

## What

Birmel now uses the explicit AI SDK 6 runtime described in the Birmel 3.0
architecture page. The normal package suite covers admission, bounded context,
all seven routes, every registered tool assignment, one-reply flow and failure
boundaries, claim memory, thread sessions, durable jobs, migrations, health,
and a fake PinchTab HTTP service with no skipped tests.

## Delivered verification

- Deterministic Discord event -> admission -> context -> route -> direct or
  specialist -> validated tool -> one edited response coverage.
- Context budgets, message-ID deduplication, scope isolation, transcript
  failures, and proof assembled prompts are not persisted.
- Claim creation, confirmation, supersession, uncertainty, temporal validity,
  relationship retrieval, correction, forget, privacy erase, and provenance.
- Thread admission, monotonic session events, versioned summaries,
  archive/resume, concurrent turns, and scheduled delivery.
- Atomic job claims, actor propagation/revalidation, retries, timeout,
  recurrence, restart recovery, isolated agents, and non-overlapping ticks.
- Fresh and production-shaped migration fixtures and liveness/readiness checks.

## Remaining

- [ ] After the image and GitOps rollout, run and record the reversible live
      acceptance set: mention/chat, engaged follow-up, one read tool, one
      verified write, memory create/query/correct/forget, a two-turn thread
      session, one one-shot job, and browser/editor health. Confirm one response
      per input, clean logs, new traces, stable context sizes, and no writes to
      `mastra-memory.db`.

## References

- `packages/birmel/AGENTS.md`
- `packages/docs/plans/2026-08-08_birmel-3-single-explicit-agent-runtime.md`
- `packages/docs/wiki/src/content/docs/birmel.md`

## Comment Log

### 2026-07-27 — in-progress board audit

- Retained as active. The repository still has broad unit coverage and several
  component e2e scripts, but no committed deterministic message-to-tool
  delegation test or recorded full Discord happy-path proof.

### 2026-08-08 — Birmel 3.0 implementation

- Replaced the stale VoltAgent-era testing inventory with the current explicit
  runtime contract. Automated coverage is complete; only direct production
  acceptance remains before this TODO and its implementation plan are archived.
