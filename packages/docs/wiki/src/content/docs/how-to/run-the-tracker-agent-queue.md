---
title: Run the Tracker agent queue
description: Start Justin on a Mac, hand off Tracker issues, approve pull requests, and recover passed work.
sidebar:
  order: 2
---

Configure Justin to take work from Tracker and deliver it for owner review.

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

Use `agent:codex` for explicit handoffs. The `AI` queue also picks up unassigned
Backlog and Todo issues. Inspect team labels before creating them.

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

```bash
scripts/onepassword/with-service-account.sh \
  bun packages/justin-principal-engineer/src/cli.ts doctor
bun packages/justin-principal-engineer/src/cli.ts daemon install
bun packages/justin-principal-engineer/src/cli.ts daemon status
```

Run `doctor` with the same Keychain-backed 1Password account as the LaunchAgent.
It checks the required CLIs, Docker daemon, Tracker catalog, 1Password references,
container image, and GitHub App access. Install from the stable checkout.

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

## 5. Hand off a task

Write a bounded issue with an observable finish line. Leave unassigned `AI`
work in Backlog or Todo, or add `agent:codex` for an explicit handoff. Justin
claims the highest-priority eligible issue when a PR slot is available.

For scoped DevEx work, use an issue in the `AI` team's `Developer Experience`
project. State the allowed files, expected behavior, and focused verification.
Choose a small code, CLI, test, or documentation change within the
[scoped DevEx contract](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/README.md#scoped-devex-work).

Enable that issue through the managed flag or local file targeting described
in the same reference. Add both `agent:codex` and `agent:autonomous` to enqueue
it. For a parked legacy task, also remove `agent:needs-human` once to opt it in.
Justin reviews the current ticket, comments, and existing PR in a fresh coding
turn before it publishes or merges. That turn uses the existing repair budget.
Approve the current PR head as usual.

The [Tracker integration](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/integrations/tracker.ts)
and [reconciler](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/reconcile.ts)
move it to `In Progress` and create a draft PR. Visual
changes use [Docker capture](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/host/docker.ts)
and [host evidence upload](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/host/evidence.ts):
the host uploads only the resulting trusted PNG when the agent returns a known
`toolkit screenshot` target.

## 6. Approve the current PR head

Leave issue comments, review bodies, inline comments, or screenshots on the PR.
Only feedback from Jerred's pinned GitHub identity starts a repair turn.

Wait for the PR to become ready and all checks to pass. Approve the current
head with GitHub's native review control. The next reconcile rechecks CI and
that exact-head approval, then squash-merges and completes the Tracker issue.

Any later push requires a new approval.

Confirm the issue reaches `Done` with its merged PR linked. Deployment is a
separate acceptance step.

## 7. Recover a parked task

Inspect the reason in Tracker or local status:

```bash
bun packages/justin-principal-engineer/src/cli.ts daemon status --json
```

Read the pass reason in Tracker. Update the issue title or description, or
leave a comment with the missing information. This makes the issue eligible
again at its current priority. Justin reuses the checkout and any existing PR.
Approve the PR again if Justin reopens it.

For an operator action such as rerunning an interrupted CI pipeline, resolve
the problem and remove `agent:needs-human` to resume the recorded phase.

For scoped DevEx work, inspect `agent:blocked`, its reason, and its next retry
time. Temporary failures retry automatically. Resolve the external dependency
before a retry. Resolve a scope violation or authorize its policy correction
before requesting an immediate retry:

```bash
bun packages/justin-principal-engineer/src/cli.ts retry AI-123
```

The command rechecks authorization and publication scope, then resumes the
recorded phase with its existing work and repair budget.

## 8. Monitor the queue

Use the Justin dashboard in Grafana for queue depth, wait times, failures, and
Codex usage. Use `daemon status --json` to identify the task and look up its issue
ID in the structured logs under the runner's `logs` directory.

## Related

- [The local Tracker agent queue](/explanation/tracker-agent-queue/)
- [Run the PR fleet](/how-to/run-the-pr-fleet/)
