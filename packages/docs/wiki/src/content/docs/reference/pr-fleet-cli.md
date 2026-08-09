---
title: PR fleet CLI
description: Commands, flags, and in-session controls for the PR fleet controller.
sidebar:
  order: 5
---

Commands for the PR fleet controller. Package:
[`packages/pr-fleet-controller/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/pr-fleet-controller).

## Commands

| Command                    | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `bun run pr:fleet`         | start the controller in the foreground           |
| `bun run pr:fleet:watch`   | open the dashboard for any run, live or finished |
| `bun run pr:fleet:inspect` | body-masked view of a captured run               |
| `bun run pr:fleet:replay`  | offline deterministic audit of a captured run    |

## `pr:fleet`

| Flag                      | Value                                                  |
| ------------------------- | ------------------------------------------------------ |
| `--model <provider>/<id>` | required; powers both the master and every worker      |
| `--author <login>`        | include that login's drafts; excludes bot-authored PRs |
| `--state-dir <path>`      | override the run-bundle location                       |
| `--no-ui`                 | do not build or spawn the web dashboard                |
| `--ui-port <port>`        | pin the dashboard port                                 |
| `--no-open`               | start the dashboard without opening a browser          |

One selected API model powers both the conversational master and every bounded
worker, so the controller is provider-neutral.

## In-session controls

| Input                         | Effect                       |
| ----------------------------- | ---------------------------- |
| `/status`                     | current fleet state          |
| `/tick`                       | force a scheduling pass      |
| `/questions`                  | list open operator questions |
| `/answer <request-id> <text>` | answer a specific question   |
| `/help`                       | list controls                |
| `/stop`                       | shut the run down            |
| free text                     | conversational steering      |

## `pr:fleet:watch`

| Flag                | Value                                   |
| ------------------- | --------------------------------------- |
| `--run <id \| dir>` | run to open; defaults to the newest run |

Standalone and historical dashboards are read-only. A live dashboard's only
mutation is answering an active, head-bound question inside that PR's detail
view.

## `pr:fleet:inspect`

| Flag                | Value                               |
| ------------------- | ----------------------------------- |
| `--run <id \| dir>` | required                            |
| `--show-bodies`     | reveal payload bodies; local opt-in |
| `--json`            | machine-readable output             |

Bodies are hidden by default.

## `pr:fleet:replay`

| Flag                | Value                   |
| ------------------- | ----------------------- |
| `--run <id \| dir>` | required                |
| `--json`            | machine-readable output |

Replay audits event integrity, lifecycle correlations, question PR and head
binding, single-answer lifecycle, tick snapshots, aggregate counts, and final
state. It never contacts a model or network, runs a command, or writes to a
checkout.

## Validation sandbox

Worker validation commands run under macOS `sandbox-exec`, deny-by-default.

| Aspect      | Policy                                                              |
| ----------- | ------------------------------------------------------------------- |
| Reads       | the assigned worktree, specific toolchain directories, own temp dir |
| Writes      | the worktree and temp dirs                                          |
| Network     | denied                                                              |
| Environment | credential-bearing variables stripped                               |
| Executables | fixed allowlist — `bun`, `cargo`, `go`, `helm`, `tofu`, `rg`, …     |

Command forms that would execute an arbitrary nested program are rejected.
`~/.aws`, `~/.ssh`, the broader `/private` tree, and home caches are unreadable.

## Related

- [Run bundle reference](/reference/pr-fleet-run-bundle/)
- [How to run the fleet](/how-to/run-the-pr-fleet/)
- [The fleet's authority boundary](/explanation/pr-fleet-authority-boundary/)
