# PR Fleet Controller

Provider-neutral Mastra workflow for driving every open
`shepherdjerred/monorepo` pull request toward current-head readiness. It runs as
one foreground Bun process on macOS, uses one selected API model for both the
conversational master and all per-PR workers, and reconstructs live state on
every invocation.

## Run

Configure the API credential expected by the selected Mastra provider, then:

```bash
bun run pr:fleet \
  --model <provider>/<model-id> \
  --author shepherdjerred
```

`--author <login>` scopes the run to that author's open PRs. Drafts remain in
scope; using the operator's login naturally excludes Renovate and other bots.
The manifest and dashboard show the selected scope.

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

## Live dashboard

`bun run pr:fleet` builds and spawns a live web dashboard by default, opening it
in a browser. It binds loopback only and streams the run bundle over SSE — a
fleet overview plus a per-PR detail view with the full transcript: worker turns,
tool calls, command output, evidence, state changes, and the model's reasoning
spans. Its only control is answering an active operator question inside that
PR's detail view. It cannot pause, prioritize, steer, merge, or publish.

- `--no-ui` does not spawn the dashboard.
- `--ui-port <port>` binds a fixed port (default: an ephemeral loopback port).
- `--no-open` starts the dashboard without opening a browser.

The dashboard is a detached child process; controller shutdown (`/stop`, EOF, or
SIGINT) terminates it. Attach to any run — live or finished — standalone:

```bash
bun run pr:fleet:watch                     # newest run under the state root
bun run pr:fleet:watch --run <run-id-or-directory>
```

A live run exposes a mode-`0600` Unix control socket inside its private run
directory. The dashboard accepts same-origin JSON answers and forwards them over
that socket. Standalone and historical dashboards receive no socket and remain
read-only. A finished run replays from its bundle, so the same dashboard doubles
as the historical viewer.

Interactive input:

- `/status` prints the deterministic fleet snapshot.
- `/tick` requests an immediate complete reconciliation.
- `/questions` prints every unanswered operator request.
- `/answer <request-id> <free-text>` is the terminal answer fallback.
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
- inherited-work inspection for staged and unstaged patches, untracked paths,
  local commits, and local/remote divergence; untracked file contents are never
  serialized, and subprocess capture limits fail closed before authorization;
- a typed `request_operator_input` boundary for one to three evidence-backed
  questions, each with two or three choices and exactly one recommendation; a
  successful request is persisted before that worker turn is aborted, and its
  leases are released after in-flight work settles;
- explicit unstaging that preserves file contents and publication of a captured,
  validated ahead-of-remote commit chain;
- worktree-scoped UTF-8 reads, ripgrep, Git status, and Git diff;
- worktree-scoped edits: `str_replace` (exact-match substring replacement) and
  `write_file` (full-file create/overwrite) are the preferred edit surface, with
  `apply_patch` (unified diff) retained as a fallback — all path-contained and
  gated on the stack-write lease;
- explicit-path formatting through the repository's pinned Prettier, for
  repairing a formatting-hook failure without exposing a general command;
- serial worktree setup;
- setup, heavy-command, and stack-write lease requests;
- an allowlisted validation command surface;
- git-spice restack start/continue/publication for stacks, and bounded native
  rebase start/continue plus force-with-lease publication for ordinary branches;
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
`.mise.toml` while it runs inside the credential-scrubbed setup sandbox. Mise
cache, state, and shim directories are invocation-scoped as well, including
`XDG_CACHE_HOME`, so generators cannot write to the operator's home cache.
Command timeouts, cancellation, and shutdown terminate the command's complete
POSIX
process group so descendant processes cannot outlive the worker that spawned
them.

Each stack gets one worktree. A fleet-owned worktree is always preferred, but
when a branch is already checked out in an operator's own worktree — git forbids
the same branch in two worktrees, so the fleet cannot provision its own — the
fleet reuses that exact-branch worktree in place. Matching-branch worktrees are
never reset: staged and unstaged edits plus local commits are inventoried for the
worker. It proceeds only when the inherited work is explainable by the PR and
can be isolated safely; ambiguity moves only that PR to `waiting-for-answer`.
Unrelated unstaged files remain untouched, and publication still names explicit
paths or a captured local commit head.

The controller never merges, closes, or approves a pull request.

## Run data, inspection, and replay

Collection is mandatory and local-only. Each run writes:

- `manifest.json` with the schema, controller source commit/version, dirty-tree
  state and content fingerprint (independent of the managed checkout), model,
  repository, optional author scope, and capture contract;
- `events.jsonl` with sequenced, hash-chained controller, worker, command,
  evidence, model-turn, and shutdown events;
- `summary.json` with final status, duration, event counts, last hash, and final
  fleet snapshot;
- `mastra.db` and `observability.duckdb` with local Mastra storage and spans.
- `spans.jsonl` with a best-effort, append-only mirror of completed
  model-reasoning spans and token/cost metrics. It exists because
  `observability.duckdb` is exclusively locked by the running controller, so the
  live dashboard cannot read it in flight; the DuckDB copy remains the
  authoritative, verified store. This mirror is not hash-chained, is not part of
  the manifest, and a write failure never aborts the run.

The bundle begins before required-tool, Git-checkout, configuration, and source
provenance preflight. A failed preflight therefore still produces an
inspectable, replayable failed run; successful preflight atomically replaces
the bootstrap manifest metadata with the resolved controller provenance and
runtime configuration. Source-provenance Git commands pass through the recorded
command boundary, with their output redacted, and the state directory must be
outside the controller repository so run data cannot change the source
fingerprint it is recording. SIGINT coordination is installed immediately after
the bootstrap bundle is created and waits for in-progress storage initialization
before shutting down and finalizing it.

The event payload redactor masks secret-shaped fields, bearer values, known
credential environment values, and the value selected by `--api-key-env`
before writing any event or summary. The same literal-value redactor runs
before Mastra's structural sensitive-field filter, so traces retain redacted
model/tool bodies, timing, token metadata, and correlation IDs. Commands inherit
their worker attempt and tool-call correlation, record whether they exited,
timed out, or were aborted, and distinguish deliberate worker cancellation from
failure. Shutdown awaits active reconciliation, workers, and the master model
turn before finalizing the bundle. Terminal, startup, controller, and shutdown
failures converge on one outcome-aware finalizer, and overlapping recorder
finalization attempts serialize around the first terminal outcome.
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
equivalence, operator-request PR/head binding and single-answer lifecycle,
aggregate state, summary counts, and final state. A completed run with any open
command, tool, worker, or model-turn lifecycle is rejected rather than labeled
verified. Unanswered operator requests may remain open indefinitely. Replay does
not resolve a model, read a credential, execute a subprocess, access the
network, or touch a checkout:

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
