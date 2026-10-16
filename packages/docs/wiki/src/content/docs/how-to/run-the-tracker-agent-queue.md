---
title: Run the Tracker agent queue
description: Configure the local Mac runner, enqueue a task for owner approval or autonomous DevEx delivery, and inspect recovery.
sidebar:
  order: 2
---

Configure the runner once, then choose owner-approved work or autonomous DevEx delivery when enqueueing an issue.

## 1. Create the GitHub App

Create `justin-principal-engineer`, disable webhooks, and install it only on the
monorepo. Grant these repository permissions:

| Permission      | Access     |
| --------------- | ---------- |
| Metadata        | Read       |
| Administration  | Read       |
| Contents        | Read/write |
| Pull requests   | Read/write |
| Issues          | Read/write |
| Checks          | Read       |
| Commit statuses | Read       |

Approve permission updates on the App installation after changing these settings.
Administration read access lets [PR health inspect branch protection](https://github.com/shepherdjerred/monorepo/blob/main/packages/toolkit/src/lib/ci/github.ts) before merging.

Store its App ID, installation ID, and generated private key in 1Password. Do
not copy them into the repository or the runner configuration.

## 2. Create the Tracker labels

Create the provider and parking labels in the team you queue from:

```bash
toolkit tracker label create --team AI --name agent:codex --color '#059669'
toolkit tracker label create --team AI --name agent:needs-human --color '#DC2626'
```

Applying `agent:codex` is the entire enqueue action. The runner accepts
issues in the configured `tracker.team`, defaulting to `AI`, in any
non-terminal state. It chooses the highest priority, then the oldest issue.
Tracker scopes labels to teams. Inspect existing labels before creating them;
imported workspaces may already contain them. Agents create issues only in AI.

## 3. Write the local configuration

From the stable checkout at `/Users/jerred/git/monorepo`:

```bash
mkdir -p "$HOME/Library/Application Support/justin-principal-engineer"
cp packages/justin-principal-engineer/config.example.json \
  "$HOME/Library/Application Support/justin-principal-engineer/config.json"
```

Set `tracker.team` to `AI` and `tracker.url` to the private Tracker endpoint.
Tracker needs no token. Edit the `op://` references and any local path that
differs. The Woodpecker reference is consumed by `op run` each time launchd
invokes the reconciler; secrets are never written into the plist. Set
`pinchtab.configPath` to the local PinchTab config path so visual captures can
reach the configured browser. The example pins
Jerred's GitHub login and numeric user ID so a lookalike account cannot
authorize a merge. It also selects `linux/amd64`, matching the pinned CI image
when Docker runs it under emulation on Apple Silicon.

The stable checkout must not be a Herdr worktree. Task clones and state live
under `~/Library/Application Support/justin-principal-engineer`.

## 4. Validate and choose a runner

Build and install the matching toolkit before starting this runner:

```bash
bun run --cwd packages/toolkit build
bun run --cwd packages/toolkit install:local
toolkit tracker whoami --json
```

When upgrading, replace the former `linear` configuration block with `tracker`,
then reinstall the LaunchAgent to remove its obsolete credential reference.

```bash
bun packages/justin-principal-engineer/src/cli.ts doctor
bun packages/justin-principal-engineer/src/cli.ts daemon install
bun packages/justin-principal-engineer/src/cli.ts daemon status
```

`doctor` checks the required CLIs, Docker daemon, Tracker catalog and labels, 1Password
references, pinned container image, and GitHub App repository access. Installing
from a temporary Herdr worktree is rejected.

For local iteration, unload the installed service and run from the monorepo root:

```bash
bun packages/justin-principal-engineer/src/cli.ts daemon stop
bun run --cwd packages/justin-principal-engineer dev
```

Save a TypeScript source file to reload on the next reconcile. Ctrl-C drains
the current turn and preserves state. Use
`bun run --cwd packages/justin-principal-engineer dev:once` for one transition.
These commands operate the configured live queue. See the
[package contributor reference](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/README.md)
for the reload and credential contracts.

## 5. Enqueue a small task

Write a bounded issue with an observable finish line. Add `agent:codex` and
leave the issue wherever it is. The next reconcile claims it, moves it to
`In Progress`, and creates a draft PR. The provider label stays on for the
whole task and is removed on merge.

For autonomous delivery, use an issue in the `AI` team's `Developer Experience`
project. State the allowed files, expected behavior, and focused verification.
Choose a small code, CLI, test, or documentation change within the
[autonomous scope contract](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/README.md#autonomous-devex-delivery).

Enable that issue through the managed flag or local file targeting described
in the same reference. Add both `agent:codex` and `agent:autonomous` to enqueue
it. For a parked legacy task, also remove `agent:needs-human` once to opt it in.
Justin reviews the current ticket, comments, and existing PR in a fresh coding
turn before it publishes or merges. That turn uses the existing repair budget.
No further human approval is needed for that delivery mode.

The [Tracker integration](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/integrations/tracker.ts)
and [reconciler](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/reconcile.ts)
move it to `In Progress` and create a draft PR. Visual
changes use [Docker capture](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/host/docker.ts)
and [host evidence upload](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/host/evidence.ts):
the host uploads only the resulting trusted PNG when the agent returns a known
`toolkit screenshot` target.

## 6. Observe delivery or approve owner-controlled work

Leave issue comments, review bodies, inline comments, or screenshots on the PR.
Only feedback from Jerred's pinned GitHub identity starts a repair turn.

Wait for the PR to become ready and all checks to pass. Approve the current
head with GitHub's native review control. The next reconcile rechecks CI and
that exact-head approval, then squash-merges and completes the Tracker issue.

Any later push requires a new approval.

For autonomous work, inspect the PR and local status instead. The
[reconciler](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/reconcile.ts)
repairs failing checks within its persisted budget and merges after green CI.
Confirm the issue reaches `Done` with its merged PR linked. Deployment is a
separate acceptance step.

## 7. Recover a parked task

Inspect the reason in Tracker or local status:

```bash
bun packages/justin-principal-engineer/src/cli.ts daemon status
```

Resolve the external problem or add the missing decision. In Tracker, remove
`agent:needs-human`. The provider label is still on the issue, so the next
reconcile requeues it directly.

The runner restores the phase recorded before parking and reuses the task clone.
Other queued issues can run while this task remains parked.

For autonomous work, inspect `agent:blocked`, its reason, and its next retry
time. Temporary failures retry automatically. Resolve the external dependency
before a retry. Resolve a scope violation or authorize its policy correction
before requesting an immediate retry:

```bash
bun packages/justin-principal-engineer/src/cli.ts retry AI-123
```

The command rechecks authorization and publication scope, then resumes the
recorded phase with its existing work and repair budget. An exhausted budget
requires a new, explicitly scoped task. Do not edit runtime state to reset it.

## Related

- [The local Tracker agent queue](/explanation/tracker-agent-queue/)
- [Run the PR fleet](/how-to/run-the-pr-fleet/)
