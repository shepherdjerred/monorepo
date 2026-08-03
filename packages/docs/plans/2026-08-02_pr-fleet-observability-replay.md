---
id: pr-fleet-observability-replay
type: plan
status: in-progress
board: false
---

# PR Fleet Observability and Replay

## Goal

Make `pr:fleet` produce a complete, locally inspectable, redacted record of
each controller run so future evaluation work can use real evidence. This work
collects data and provides deterministic control-plane replay; it does not add
datasets, scorers, model judges, experiments, or evaluation gates.

## Stack

Two native GitHub stack layers keep runtime hardening independently reviewable:

1. `fix/pr-fleet-runtime-safety`
2. `feat/pr-fleet-observability`

Both layers use the same isolated worktree and remain draft until focused
verification is complete.

## Runtime safety layer

- Terminate command process groups on timeout so descendants cannot survive.
- Remove controller-managed persistent `mise trust`; setup uses Mise paranoid
  mode plus invocation-scoped trust for the exact assigned `.mise.toml` inside
  the credential-scrubbed setup sandbox.
- Validate changed and deleted publication paths without requiring a deleted
  parent directory to still exist.
- Rearm heartbeat scheduling after a failed tick.
- Shut the controller down cleanly when terminal input reaches EOF.
- Cover each repaired failure mode with focused Bun tests.

## Collection layer

### Mandatory local run bundle

Every controller start creates a private run directory below
`${XDG_STATE_HOME:-~/.local/state}/pr-fleet-controller`, or below the explicit
`--state-dir` path. Startup fails before model access or repository mutation if
the directory cannot be created with safe permissions.

Each run stores:

- `manifest.json` — immutable run identity, versions, model, repository, and
  capture contract.
- `events.jsonl` — schema-versioned, monotonically sequenced, hash-chained,
  redacted events.
- `summary.json` — completion state and aggregate counts/durations.
- `mastra.db` — local Mastra storage.
- `observability.duckdb` — local Mastra trace and metric storage.

Run directories use mode `0700`; persisted files use mode `0600`. Runs are
retained indefinitely in v1. There is no automatic pruning.

### Event contract

Events carry `schemaVersion: 1`, a sequence number, timestamp, previous hash,
event hash, event kind, and correlation fields where applicable: run, trace,
causation, tick, PR number, head SHA, generation, model turn, tool call, and
command.

Capture includes:

- startup, operator input, shutdown, cancellation, and errors;
- tick lifecycle, fleet snapshots, state transitions, dispatch decisions, and
  final state;
- worker lifecycle, retry attempts, model input/output, step/tool activity,
  and structured worker results;
- command arguments, working directory, output, exit status, duration, and
  timeout state;
- patches, publication attempts/results, review results, and controller
  steering.

All payloads pass through the repository redactor before any persistence.
Credential values and authorization material must never be written.

### Mastra observability

Register master and worker agents with one run-scoped Mastra instance. Use
run-scoped local storage and observability exporters so model spans, tool spans,
token usage, cost, and durations are retained alongside the event stream.
Keep exporter construction behind a seam suitable for a future OTLP exporter;
v1 does not add central Tempo, Loki, or Prometheus infrastructure.

## Inspection and replay

Add two root commands:

```bash
bun run pr:fleet:inspect --run <id-or-path> [--state-dir <path>] [--pr <number>] [--show-bodies] [--json]
bun run pr:fleet:replay --run <id-or-path> [--state-dir <path>] [--allow-version-mismatch] [--json]
```

Inspection verifies the hash chain and renders the exact correlated timeline,
with bodies hidden unless explicitly requested.

Replay verifies the bundle, rejects incompatible versions by default, and
re-executes controller decisions against recorded environment and worker
responses. Replay must not resolve a model, read credentials, access the
network, spawn commands, or write to repository checkouts. It compares state
transitions, dispatch decisions, snapshots, and final state with the recording
and exits nonzero on divergence.

## Verification

- Focused package tests for safety fixes, secure bundle creation, redaction,
  event ordering/hash integrity, failure finalization, inspection filters, and
  offline replay equivalence/divergence.
- Package typecheck, test, lint, and build tasks.
- Staged-file Lefthook checks and root docs validation.
- A zero-open-PR Terra smoke run to prove capture without branch mutation.
- Synthetic worker scenarios to exercise retries, failures, publication
  records, and replay without touching a real PR.
- An asciinema recording of real inspect/replay output attached to the upper
  draft PR.
- Exact-current-head Buildkite and hosted review verification for both stack
  layers. No merge without explicit authorization.

## Non-goals

- No evaluation dataset or corpus materialization.
- No scorers, grading, model judges, experiments, or benchmark runner.
- No CI evaluation gate.
- No retention pruning or remote upload.
- No live mutating PR-fleet canary without separate authorization.

## Session Log — 2026-08-02

### Done

- Approved the collection-only design and two-layer native stack boundary.

### Remaining

- Implement, verify, publish, and drive both draft PRs to green.

### Caveats

- Live mutating controller acceptance remains prohibited unless separately
  authorized; verification uses zero-PR and synthetic scenarios.
