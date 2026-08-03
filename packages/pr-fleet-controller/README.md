# PR Fleet Controller

Provider-neutral Mastra workflow for driving every open
`shepherdjerred/monorepo` pull request toward current-head readiness. It runs as
one foreground Bun process on macOS, uses one selected API model for both the
conversational master and all per-PR workers, and reconstructs live state on
every invocation.

## Run

Configure the API credential expected by the selected Mastra provider, then:

```bash
bun run pr:fleet --model <provider>/<model-id>
```

Provider families include `openai/…`, `anthropic/…`, `xai/…`, and an
OpenRouter model such as a Kimi model. A custom OpenAI-compatible endpoint is
also supported:

```bash
bun run pr:fleet \
  --model openai-compatible/<model-id> \
  --base-url "$PROVIDER_BASE_URL" \
  --api-key-env PROVIDER_API_KEY
```

The invocation deliberately uses one model throughout. It does not silently
route individual workers to another model or provider.

Every non-help invocation also requires a private local run-bundle directory.
The default is
`${XDG_STATE_HOME:-~/.local/state}/pr-fleet-controller/<run-id>`; select a
different private root with `--state-dir <path>`. The controller refuses a
symlinked, non-owned, or group/world-accessible root before model access or PR
mutation. The selected root and each run directory use mode `0700`; bundle
files use mode `0600`.

Readiness is gated on a hosted code-review provider (Codex by default). Select
a different registered provider with `--review-provider <id>`; completion is
detected as a review-at-head or a head-bound clean-review reaction, reusing the
canonical `@shepherdjerred/code-review` gate logic.

Interactive input:

- `/status` prints the deterministic fleet snapshot.
- `/tick` requests an immediate complete reconciliation.
- `/help` prints command help.
- `/stop` or terminal EOF aborts active model turns, preserves worktrees, waits
  for workers to settle, and exits.
- Any other line is queued as conversational steering. Input remains available
  while the master is answering; queued messages are handled by the next
  serialized master turn.

## Agent tools

The language model never receives a general shell, unrestricted filesystem, or
raw GitHub/Buildkite mutation tool.

The master receives:

- fleet snapshot and immediate tick;
- priority changes;
- pause and resume;
- queued per-PR worker guidance;
- worker-limit changes;
- safe controller shutdown.

Each worker receives:

- normalized current-head PR, Buildkite, merge-tree, and review evidence;
- worktree-scoped UTF-8 reads, ripgrep, Git status, Git diff, and unified patch
  application;
- serial worktree setup;
- setup, heavy-command, and stack-write lease requests;
- an allowlisted validation command surface;
- git-spice restack start/continue/publication;
- explicit-path staging, hooks, commit, git-spice publication, and one
  SHA-marked hosted review request.

Validation commands run through `sandbox-exec` with network denied, writes
restricted to the assigned worktree and macOS temporary directories, reads of
well-known host credential stores (`~/.aws`, `~/.ssh`, `~/.config/gh`, …)
denied, and a credential-scrubbed environment so tool output cannot exfiltrate
host secrets. Only read-only script and task forms are accepted. Publication,
worktree creation, current-head verification, review-request deduplication, and
timers remain deterministic controller operations.

Worktree setup never runs `mise trust`: the controller does not persist trust
for configuration supplied by a pull request. Setup enables Mise paranoid mode
and grants invocation-scoped trust to only the assigned worktree's exact
`.mise.toml` while it runs inside the credential-scrubbed setup sandbox. Command
timeouts, cancellation, and shutdown terminate the command's complete POSIX
process group so descendant processes cannot outlive the worker that spawned
them.

The controller never merges, closes, or approves a pull request.

## Run data, inspection, and replay

Collection is mandatory and local-only. Each run writes:

- `manifest.json` with the schema, controller source commit/version, dirty-tree
  state and content fingerprint (independent of the managed checkout), model,
  repository, and capture contract;
- `events.jsonl` with sequenced, hash-chained controller, worker, command,
  evidence, model-turn, and shutdown events;
- `summary.json` with final status, duration, event counts, last hash, and final
  fleet snapshot;
- `mastra.db` and `observability.duckdb` with local Mastra storage and spans.

The bundle begins before required-tool, Git-checkout, configuration, and source
provenance preflight. A failed preflight therefore still produces an
inspectable, replayable failed run; successful preflight atomically replaces
the bootstrap manifest metadata with the resolved controller provenance and
runtime configuration. SIGINT coordination is installed immediately after the
bootstrap bundle is created and waits for in-progress storage initialization
before shutting down and finalizing it.

The event payload redactor masks secret-shaped fields, bearer values, known
credential environment values, and the value selected by `--api-key-env`
before writing any event or summary. The same literal-value redactor runs
before Mastra's structural sensitive-field filter, so traces retain redacted
model/tool bodies, timing, token metadata, and correlation IDs. Commands inherit
their worker attempt and tool-call correlation, record whether they exited,
timed out, or were aborted, and distinguish deliberate worker cancellation from
failure. Shutdown awaits active reconciliation, workers, and the master model
turn before finalizing the bundle.
Runs are retained indefinitely in v1, so operators must delete old run
directories themselves when they no longer need them. Nothing is uploaded.

Verify and inspect a run without revealing prompt, output, patch, log,
command-argument, operator-input, pause, escalation, or worker-result bodies:

```bash
bun run pr:fleet:inspect --run <run-id-or-directory>
bun run pr:fleet:inspect --run <run-id-or-directory> --pr 1961 --show-bodies
```

Deterministic replay is an offline control-plane audit. It verifies schema and
controller versions, the hash chain, lifecycle correlations, tick/snapshot
equivalence, aggregate state, summary counts, and final state. A completed run
with any open command, tool, worker, or model-turn lifecycle is rejected rather
than labeled verified. Replay does not resolve a model, read a credential,
execute a subprocess, access the network, or touch a checkout:

```bash
bun run pr:fleet:replay --run <run-id-or-directory>
```

Use `--json` on either command for machine-readable output. Replay rejects a
controller-version mismatch unless `--allow-version-mismatch` is explicit.
This is collection and deterministic inspection infrastructure only: there are
no datasets, scorers, judges, experiments, benchmarks, or evaluation gates.

## Verification

```bash
cd packages/pr-fleet-controller
bun run typecheck
bun run test
bun run lint
bun run build
```

## Session Log — 2026-07-29

### Done

- Added the provider-neutral Mastra workflow, interactive terminal, typed tool
  boundary, current-head evidence collection, leases, sandboxing, worktrees,
  git-spice publication, and deterministic tests.

### Remaining

- Verify the published PR's current-head Buildkite and hosted review results.

### Caveats

- A live model turn requires a configured API credential for the selected
  provider; deterministic tests use fake ports and do not spend provider quota.
