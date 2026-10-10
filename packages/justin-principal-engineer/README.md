# justin-principal-engineer

Local macOS automation that turns a labeled Linear issue into a reviewed,
merged pull request. Curated DevEx issues can run through merge autonomously;
other issues retain exact-head owner approval.

The CLI is intentionally one-shot. `launchd` starts `reconcile` every minute;
each invocation advances one durable task and exits. Coding turns run through
the Codex SDK inside Docker. GitHub App credentials, CI access, commits,
pull requests, evidence uploads, approvals, and
merges stay on the host.

## Commands

| Command            | Effect                                             |
| ------------------ | -------------------------------------------------- |
| `doctor`           | Verify tools, Docker, labels, credentials, and App |
| `reconcile`        | Advance one queue or task transition               |
| `merge-ready <ID>` | Read-only readiness hook used by Git-Spice         |
| `daemon install`   | Install and load the 60-second LaunchAgent         |
| `daemon start`     | Load or immediately kick the LaunchAgent           |
| `daemon stop`      | Unload it without deleting state                   |
| `daemon status`    | Show service and task states                       |
| `daemon uninstall` | Unload and remove the plist; preserve task state   |

Runtime files live under
`~/Library/Application Support/justin-principal-engineer`. The configuration
contract is in `config.example.json`.

New task checkouts live in `tasks.noindex` so macOS Spotlight excludes their
source files and build output. Existing tasks retain their saved checkout paths
under `tasks`; the runner does not move active checkouts. Keep that legacy
directory in Spotlight Search Privacy while those tasks remain in use.

Configure Woodpecker's `apiToken` as an `op://` reference and its `baseUrl` and
numeric `repoId` for the intended CI repository. Dev and launchd pass all three
connection details to PR health; missing connection details fail configuration
validation before the runner claims a task.

## Development

Run from this package directory after configuring the runner:

```bash
bun src/cli.ts daemon stop
bun run dev
```

`dev` first checks native OpenAI model access through the shared LLM runtime and
that the configured Woodpecker repository ID matches `repository.slug`.
Credential failures stop startup before a task is claimed. `doctor` performs
the same checks, and each coding turn checks OpenAI again before installing or
building container dependencies.

`dev` runs the real configured Linear queue in the foreground, using the same
durable task state as the LaunchAgent. It injects credentials through `op run`
on every turn. It refuses to start while the LaunchAgent is loaded.

Each reconcile starts a fresh Bun process from your current checkout. Saving a
TypeScript file under `src/` queues an immediate reload. Saves during a turn
wait until that turn finishes, so a reload cannot interrupt publication or
orphan a Docker agent. The terminal shows agent stages, elapsed time, and task
phases. Idle runs poll every five seconds; use `--interval-seconds 60` to slow
the loop down. Ctrl-C drains the current turn and exits with state preserved.

Startup builds the host Toolkit from the same checkout and puts that binary
first on the reconcile's command path. Review parsing and host workflow changes
therefore use the development tree without replacing the installed Toolkit.
Restart `dev` after changing Toolkit source to rebuild that binary.

Dev agent containers read Justin's source and package manifest from this
checkout, mounted read-only outside the editable task workspace. Their
dependencies still come from the task clone's Linux install. Source edits to
the container runner therefore take effect on the next agent turn too. Changes
to dependency versions or other workspace packages require updating the task
checkout and its lockfile; editing the dev supervisor itself requires restarting
`dev`.

For one foreground reconcile with local source:

```bash
bun run dev:once
```

These commands process live issues and can publish or merge PRs under the
ticket's delivery policy. Use a bounded issue to exercise the flow. See the
setup guide linked below for configuration and enqueueing.

Run focused checks separately:

```bash
bunx turbo run build typecheck test lint \
  --filter=@shepherdjerred/justin-principal-engineer
```

When finished, restore the installed service with `bun src/cli.ts daemon start`.

## Publication checks and recovery

Before publishing, the host independently runs build, typecheck, test, and lint
in a Docker container without forwarding provider or GitHub credentials. It
selects affected workspaces from the base revision's package inventory and checks
the entire branch, including earlier commits. Root changes and new workspaces
run the repository verification command. Failed checks block publication.

The PR reports the exact host-run command and its successful exit status. Agent
summary and verification text remain excluded from public metadata because the
agent sees private Linear comments. Changed files are checked for private
comment content before and after verification. Local checks do not replace
exact-head Woodpecker CI or the ticket's merge authorization.

## Autonomous DevEx delivery

An issue must belong to the `AI` team's `Developer Experience` project and
carry both `agent:codex` and `agent:autonomous`. The host also resolves the
typed `justin_autonomous_devex_enabled` flag before work, publication, and
merge. Its default and production rollout are off; beta targets AI-104.
For local development with the flag provider disabled, explicitly list issue
identifiers in `autonomy.enabledIssueIdentifiers`. A resolved Flipt `false`
overrides that file authorization.

The host checks the entire branch against the base revision's workspace
inventory. Autonomous changes are limited to source, tests, README files, and
the package manifest in one existing workspace, plus related wiki pages.
Manifest metadata and test registration are allowed; the host compares actual
dependency declarations and resolution fields against the base revision.
The runner rejects changes
to infrastructure, dependencies, credentials, agent instructions, release and
review controls, or Justin itself. Scope violations block publication and merge.

The delivery mode is persisted when a task is claimed. Legacy state defaults
to `owner_approved`; labeling an already active task does not silently change
its authority. Requeue a parked task with the autonomous label to opt it in.
An existing PR receives a fresh coding turn against the current ticket,
comments, and review findings before autonomous publication or merge. This
uses a remaining repair turn and preserves the existing repair budget.

One initial coding turn and three follow-up repair turns are allowed. A repair
counts when the coding process starts, before its output is available. CI logs
and provider-specific Codex and CodeRabbit finding keys feed those repairs.
Only findings the agent reports addressed are resolved, with a visible audit.
The repository's existing automated review policy remains authoritative.

Green exact-head CI queues a Git-Spice merge without owner approval for
autonomous tasks. The host readiness hook rechecks the issue, flag, full branch
scope, PR identity, branch, head, and CI. The merge API is bound to that head.
Linear completes only after GitHub confirms the merge commit and the host
verifies it is an ancestor of the fetched base branch. This completion does
not imply deployment or production acceptance.

Autonomous failures use `agent:blocked`, with the reason and retry time shown
in status and Linear. Temporary provider or CI failures retry after 5, 15,
then 60 minutes, capped at hourly. CI pending for an hour also yields the
active slot. Exhausted repair budgets and scope violations remain blocked
without further coding turns. Other issues can run while a task is blocked.

After fixing an external blocker or authorizing a policy correction, use
`bun packages/justin-principal-engineer/src/cli.ts retry AI-123` to queue an
immediate retry. It rechecks issue authorization and publication scope under
the reconcile lock, preserves completed work, and resumes the recorded phase.
It does not reset the coding budget or replenish exhausted repair turns.

CI authorization rejection, skipped or declined pipelines, and cancelled
pipelines park owner-approved tasks with `agent:needs-human` and preserve their CI phase and
checkout. Ordinary failing checks still enter a coding repair turn. Release
the required CI fix through GitOps or rerun the interrupted pipeline, then
remove `agent:needs-human` to resume. The CI extension names Justin's exact
`justin-principal-engineer[bot]` identity; forks and untrusted senders remain
rejected. Autonomous tasks use the blocked recovery described above.

See [Run the Linear agent queue](../docs/wiki/src/content/docs/how-to/run-the-linear-agent-queue.md)
for setup and operation.
