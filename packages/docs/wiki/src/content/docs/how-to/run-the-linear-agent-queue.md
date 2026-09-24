---
title: Run the Linear agent queue
description: Configure the local Mac runner, enqueue a task, review its evidence, and recover a parked task.
sidebar:
  order: 2
---

Configure the runner once, then enqueue work with four Linear labels and use
the pull request as the feedback and approval surface.

## 1. Create the GitHub App

Create `justin-principal-engineer`, disable webhooks, and install it only on the
monorepo. Grant these repository permissions:

| Permission      | Access     |
| --------------- | ---------- |
| Metadata        | Read       |
| Contents        | Read/write |
| Pull requests   | Read/write |
| Issues          | Read/write |
| Checks          | Read       |
| Commit statuses | Read       |

Store its App ID, installation ID, and generated private key in 1Password. Do
not copy them into the repository or the runner configuration.

## 2. Create the Linear labels

Create the four team labels once:

```bash
toolkit linear label create --team SJ --name agent:ready --color '#5E6AD2' \
  --description 'Ready for the local coding queue'
toolkit linear label create --team SJ --name agent:codex --color '#059669' \
  --description 'Use the Codex SDK'
toolkit linear label create --team SJ --name agent:needs-human --color '#DC2626' \
  --description 'Parked until Jerred requeues it'
```

The runner accepts only `Todo` issues with `agent:ready` and exactly one
provider label. It chooses the highest priority, then the oldest issue.

## 3. Write the local configuration

From the stable checkout at `/Users/jerred/git/monorepo`:

```bash
mkdir -p "$HOME/Library/Application Support/justin-principal-engineer"
cp packages/justin-principal-engineer/config.example.json \
  "$HOME/Library/Application Support/justin-principal-engineer/config.json"
```

Edit only the `op://` references and any local path that differs. The Linear
and Buildkite API key references are consumed by `op run` each time launchd
invokes the reconciler; the secrets are never written into the plist. Set
`pinchtab.configPath` to the local PinchTab config path so visual captures can
reach the configured browser. The example pins
Jerred's GitHub login and numeric user ID so a lookalike account cannot
authorize a merge. It also selects `linux/amd64`, matching the pinned CI image
when Docker runs it under emulation on Apple Silicon.

The stable checkout must not be a Herdr worktree. Task clones and state live
under `~/Library/Application Support/justin-principal-engineer`.

## 4. Validate and install

```bash
bun packages/justin-principal-engineer/src/cli.ts doctor
bun packages/justin-principal-engineer/src/cli.ts daemon install
bun packages/justin-principal-engineer/src/cli.ts daemon status
```

`doctor` checks the required CLIs, Docker daemon, Linear labels, 1Password
references, pinned container image, and GitHub App repository access. Installing
from a temporary Herdr worktree is rejected.

## 5. Enqueue a small task

Write a bounded issue with an observable finish line. Add `agent:ready` and one
of `agent:codex`, then leave it in `Todo`.

The [Linear integration](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/integrations/linear.ts)
and [reconciler](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/reconcile.ts)
move it to `In Progress`, remove `agent:ready`, and create a draft PR. Visual
changes use [Docker capture](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/host/docker.ts)
and [host evidence upload](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/host/evidence.ts):
the host uploads only the resulting trusted PNG when the agent returns a known
`toolkit screenshot` target.

## 6. Steer and approve the pull request

Leave issue comments, review bodies, inline comments, or screenshots on the PR.
Only feedback from Jerred's pinned GitHub identity starts a repair turn.

Wait for the PR to become ready and all checks to pass. Approve the current
head with GitHub's native review control. The next reconcile rechecks CI and
that exact-head approval, then squash-merges and completes the Linear issue.

Any later push requires a new approval.

## 7. Recover a parked task

Inspect the reason in Linear or local status:

```bash
bun packages/justin-principal-engineer/src/cli.ts daemon status
```

Resolve the external problem or add the missing decision. In Linear, move the
issue to `Todo`, remove `agent:needs-human`, and add `agent:ready` while keeping
exactly one provider label.

The runner restores the phase recorded before parking and reuses the task clone.
Other ready issues can run while this task remains parked.

## Related

- [The local Linear agent queue](/explanation/linear-agent-queue/)
- [Run the PR fleet](/how-to/run-the-pr-fleet/)
