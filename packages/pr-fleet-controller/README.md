# PR Fleet Controller

OpenRouter-backed AI SDK workflow for driving every open
`shepherdjerred/monorepo` pull request toward current-head readiness. It runs as
one foreground Bun process on macOS, uses one selected catalog model for both the
conversational master and all per-PR workers, and reconstructs live state on
every invocation.

## Run

Configure `OPENROUTER_API_KEY`, then:

```bash
bun run pr:fleet \
  --model <catalog-model-id> \
  --author shepherdjerred
```

`--author <login>` scopes the run to that author's open PRs. Drafts remain in
scope; using the operator's login naturally excludes Renovate and other bots.
The manifest and dashboard show the selected scope.

The model must be a stable ID from `@shepherdjerred/llm-models` with OpenRouter
tool and structured-output capabilities, such as `gpt-5.6-sol`. The invocation
uses that exact model throughout. OpenRouter may fall back between upstream
providers, but the controller never silently changes model identity.

Every non-help invocation also requires a private local run-bundle directory.
The default is
`${XDG_STATE_HOME:-~/.local/state}/pr-fleet-controller/<run-id>`; select a
different private root with `--state-dir <path>`. The controller refuses a
symlinked, non-owned, or group/world-accessible root before model access or PR
mutation. The selected root and each run directory use mode `0700`; bundle
files use mode `0600`.

Readiness is gated on a hosted code-review provider. It defaults to the one the
repository's CI gate requires (Qodo), so a run cannot call a PR ready on
findings the gate does not see; select another registered provider with
`--review-provider <id>`. Completion is detected with the canonical
`@shepherdjerred/code-review` logic — for Qodo that is the separate
acknowledgement naming the reviewed head, and for the others a review-at-head
or a head-bound clean-review reaction.

## Live dashboard

`bun run pr:fleet` builds and spawns a live web dashboard by default, opening it
in a browser. It binds loopback only and streams the run bundle over SSE — a
fleet overview plus a per-PR detail view with the full transcript: worker turns,
tool calls, command output, evidence, state changes, and the model's reasoning
spans. Its only control is answering an active operator question inside that
PR's detail view. It cannot pause, prioritize, steer, merge, or publish.

The header projects causal run progress from the recorded event stream:
completed setups, confirmed publications, lease contention, and repeated blocker
classes. Each PR shows its latest meaningful transition plus its current
normalized blocker and repeat count. This stays in the local run bundle rather
than adding an external collector, so live and historical dashboards agree.

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
- unrestricted shell access in the assigned worktree with a sanitized operator
  environment;
- git-spice restack start/continue/publication for stacks, and bounded native
  rebase start/continue plus force-with-lease publication for ordinary branches;
- explicit-path staging, hooks, commit, git-spice publication, and one
  SHA-marked hosted review request.

Workers set up a newly assigned or changed-head worktree before validation
commands. Lease denials and setup requirements have bounded reasons instead of
only raw tool errors. A controller commit or restack may move an operator
worktree's local HEAD only when that exact SHA is recorded against the current
remote PR head; any other transition remains operator-owned and requires fresh
inspection. Commit subjects are checked against the same package/root scope
rules as the commit-msg hook before paths are staged.

Shell commands run through the operator's configured shell with network,
filesystem, and installed tools available. Environment variables whose names
identify credentials or other secrets are removed, command output is bounded,
and command output is redacted from telemetry before it reaches the run bundle.
Publication,
worktree creation, current-head verification, review-request deduplication, and
timers remain deterministic controller operations.

Worktree setup marks only the assigned worktree's `.mise.toml` as trusted for
the setup command processes via `MISE_TRUSTED_CONFIG_PATHS`; trust is not
persisted in the operator's Mise data. It then installs the pinned toolchain,
dependencies, and generated artifacts using the same sanitized worker
environment.
Command timeouts, cancellation, and shutdown terminate the command's complete
POSIX
process group so descendant processes cannot outlive the worker that spawned
them.

Each stack gets one worktree in a controller-owned clone. By default, that clone
is under the private state directory at `checkouts/repo-<owner--name>`, with
worktrees alongside it at `worktrees/repo-<owner--name>`. The checkout from
which the CLI was launched supplies only its `origin` URL and local git-spice
metadata; it is never assigned to a worker. Existing managed clones must be
clean, and the controller refuses to reset or reuse a dirty one. `--checkout`
is an explicit override for another controller-owned clone, never an operator
checkout.
Unrelated unstaged files remain untouched, and publication still names explicit
paths or a captured local commit head.

The controller never merges, closes, or approves a pull request.

## Run data, inspection, and replay

Collection is mandatory and local-only. Each run writes:

- `manifest.json` with the schema, controller source commit/version, dirty-tree
  state and content fingerprint (independent of the managed checkout), model,
  repository, optional author scope, and capture contract;
- `events.jsonl` with sequenced, hash-chained controller, worker, command,
  evidence, model-turn, shutdown, lease, setup, publication, and worktree-head
  transition events;
- `summary.json` with final status, duration, event counts, last hash, and final
  fleet snapshot;
- `spans.jsonl` with completed, secret-redacted OpenTelemetry spans, including
  AI SDK/OpenRouter reasoning, tools, usage, cost, and trace correlation. It is
  the authoritative telemetry artifact in run-bundle schema v2 and its byte
  length plus SHA-256 digest are bound into the terminal event and summary.

Readers retain complete schema-v1 support for historical bundles containing
`mastra.db` and `observability.duckdb`; those files are digest-verified but no
new run creates them.

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
credential environment values, and the OpenRouter key before writing any event,
span, or summary. The same literal-value redactor runs synchronously before
OpenTelemetry span persistence, so traces retain redacted model/tool bodies,
timing, token metadata, and correlation IDs. Commands inherit
their worker attempt and tool-call correlation, record whether they exited,
timed out, or were aborted, and distinguish deliberate worker cancellation from
failure. Shutdown awaits active reconciliation, workers, and the master model
turn before finalizing the bundle. Terminal, startup, controller, and shutdown
failures converge on one outcome-aware finalizer, and overlapping recorder
finalization attempts serialize around the first terminal outcome.
Runs are retained indefinitely, so operators must delete old run
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
