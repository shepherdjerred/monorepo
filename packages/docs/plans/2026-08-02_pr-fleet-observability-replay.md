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
reconstructs the control-plane history from recorded environment, command,
tool, model-turn, worker, tick, and snapshot events. It validates lifecycle
correlations, snapshot aggregates, per-tick snapshot equivalence, summary
counts, and final state, exiting nonzero on divergence. Replay does not resolve
a model, read credentials, access the network, spawn commands, or write to a
repository checkout.

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

- Published native-stack PRs #1961 (runtime safety) and #1963 (run-data
  collection/replay), promoted both to ready after local and mechanical CI
  verification, and attached the refreshed terminal recording to #1963.
- Implemented process-group termination, deleted-path publication, heartbeat
  rearming, EOF shutdown, and invocation-scoped Mise trust under paranoid mode.
  A fresh untrusted linked-worktree probe confirmed the exact config becomes
  trusted only through `MISE_TRUSTED_CONFIG_PATHS` for that invocation.
- Implemented mandatory private run bundles, shared pre-persistence redaction,
  hash-chained events, Mastra/LibSQL/DuckDB storage, inspect/replay commands,
  and controller/environment/model/tool correlation on the upper layer.
- Addressed all six hosted-review findings: redact the full summary, propagate
  attempt/tool correlation into commands, reject completed replays with open
  lifecycles, distinguish deliberate worker cancellation, order worker parents
  before attempts, and record controller-source provenance independently of the
  managed checkout. The prior lower-layer Mise finding was accepted by a clean
  current-head re-review and its thread was resolved.
- Addressed the next current-head review with reconciliation-aware shutdown,
  explicit command exit/timeout/abort metadata, and default masking for singular
  guidance-message fields.
- Addressed the final current-head findings by waiting for reconciliation and
  worker settlement before shutdown completion, correlating master tools with
  their commands, recording operator-aborted workers as cancellations, and
  masking payload-bearing final-summary fields during default JSON inspection.
- Addressed the subsequent current-head findings by redacting xAI and
  OpenRouter credential values, correlating controller ticks and PR refreshes,
  retaining each worker's dispatched head through stale-head cancellation, and
  routing patch application through the recorded command boundary.
- Addressed the next exact-head review by making every overlapping CLI shutdown
  caller await the same in-flight operation and making replay reject missing,
  mismatched, inactive, or prematurely closed correlation parents.
- Prevented `gh auth token` output and related failure details from entering
  command telemetry while retaining the credential only for the in-memory API
  call that needs it.
- Addressed the latest exact-head review by redacting even short explicitly
  selected credentials, fingerprinting dirty controller source (including
  tracked and untracked changes), and keeping shutdown completion behind the
  active master-turn settlement boundary.
- Fixed an exhaustive-verify race where the Pokémon benchmark test created and
  removed a fixture inside the package while concurrent ESLint traversed it;
  the fixture now lives under the OS temp directory with explicit dependency
  resolution.
- Addressed six further exact-head review findings: worker attempts and terminal
  events now retain their dispatch tick, inspection masks structured finding
  arrays, replay rejects open and orphaned tick lifecycles, cancellation is
  armed before a command can block writing stdin, and model-, terminal-, and
  failure-initiated shutdown all pass through one master-settlement boundary.
- Addressed the next exact-head findings by resolving package-scoped untracked
  source paths from the repository root and making replay validate the run and
  shutdown lifecycles plus summary-to-terminal consistency.
- Passed focused typecheck, 84 controller tests, 42 observability tests, lint,
  native-aware build, docs validation, Markdown lint, diff checks, and staged
  Lefthook/Gitleaks/Prettier/lockfile checks.
- Completed a final non-mutating `openai/gpt-5.6-terra` model/tool turn from the
  latest implementation against a zero-open-PR repository at the distinct
  commit `c356aef4326669e9e90db15fabd50a691c667116`. The manifest correctly
  recorded controller-source provenance, inspect hid eight body values by
  default, the command recorded `termination: exit`, replay verified all 17
  events with no open lifecycles (`commands=1/1`, `tools=1/1`,
  `masterTurns=1/1`), every database sidecar was mode `0600`, and DuckDB
  contained one correlated 11-span agent/model/tool trace.

### Remaining

- No implementation work remains.

### Caveats

- Live mutating controller acceptance remains prohibited unless separately
  authorized; verification uses a real zero-PR Terra turn plus synthetic worker
  retry/failure/publication scenarios.
- V1 retains redacted local bundles indefinitely and has no remote exporter or
  pruning. It adds no datasets, scorers, judges, experiments, or eval gates.
