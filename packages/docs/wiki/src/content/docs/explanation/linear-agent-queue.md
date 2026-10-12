---
title: The local Linear agent queue
description: Why curated autonomous DevEx work and owner-approved work share a host-controlled delivery boundary.
sidebar:
  order: 5
---

The local Linear agent queue separates coding from delivery authority, with autonomous merge available for explicitly curated DevEx work.

Linear is only the intake queue. The MacBook owns durable task state, Docker
owns each bounded coding turn, and GitHub owns review and merge evidence.

```mermaid
stateDiagram-v2
  accTitle: Linear agent implementation lifecycle
  accDescr: An eligible Linear issue is claimed, implemented in a container, and published by the host. A failing delivery check starts a bounded repair turn.
  direction TB

  [*] --> Claimed: eligible issue
  Claimed --> Implementing: clone ready
  Implementing --> Publishing: changes ready
  Publishing --> AwaitingCI: PR published
  AwaitingCI --> Implementing: fix required
```

## Quiet periods are absence, not sleep

[The launchd reconciler](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/host/launchd.ts)
starts one reconcile process every 60 seconds. [The reconciler state
machine](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/reconcile.ts)
claims the local lock, advances one transition, writes state, and exits.

No model process or container remains alive while CI runs or approval is
pending. A fresh SDK turn starts only for initial implementation, owner
feedback, or a failing delivery gate.

This makes a Mac restart ordinary recovery. The next invocation reads the task
state and continues. The operating system owns the advisory lock, so it is
released atomically when the reconcile process exits or crashes.

## Authority is split at the container boundary

The [Docker runner](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/host/docker.ts)
mounts one writable task clone, overlays its `.git` directory read-only, and
supplies one provider credential. The coding agent has shell and network access
because useful repository work needs both.

The container does not receive the host home directory, Docker socket, GitHub
App identity, Linear identity, or CI credential. It cannot publish its
own changes.

The host computes changed paths, verifies the affected workspaces, stages them explicitly, and uses Git-Spice in
the [workspace publisher](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/host/git-workspace.ts)
to publish. It also gathers provider-specific findings and CI logs before asking
for a repair turn.

## Curation grants a narrow delivery authority

Autonomous work needs an explicit ticket label and host-resolved authorization.
The host checks the full branch before publication and merge, including edits
from earlier turns. That prevents a repair from expanding a small task into
infrastructure, dependency, credential, or delivery-policy changes.

Manifest filenames cannot distinguish test registration from dependency upgrades.
The host compares dependency declarations and resolution fields while permitting
package metadata and test registration. Required checks and review assess the
complete change.

The [reconciler](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/reconcile.ts)
persists each task's delivery mode. Existing active work therefore retains its
owner approval requirement when autonomous delivery becomes available.

The coding container cannot authorize its own merge. Git-Spice runs the host
readiness check, and the merge request names the validated head. GitHub merge
readback and base-branch ancestry are required before Linear completion.
The finish line is confirmed merge; deployment requires separate evidence.

```mermaid
stateDiagram-v2
  accTitle: Linear agent merge authorization
  accDescr: Green CI allows curated autonomous work to merge directly. Other work waits for owner approval. Both paths complete only after a confirmed merge.
  direction TB

  CI --> Merging: green, autonomous
  CI --> Approval: green, owner-approved
  Approval --> Merging: exact-head approval
  Merging --> Done: confirmed merge
  Done --> [*]
```

## Approval is bound to the current commit

Green CI includes the repository's automated Codex review gate. The
[GitHub integration](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/integrations/github.ts)
waits, for owner-approved work, for an `APPROVED` review from Jerred's pinned account ID and login
whose `commit_id` equals the current PR head.

A push invalidates that authorization in the reconciler even if GitHub still
displays an older approval. Merge performs the same gate and approval checks
again, closing the race between observation and mutation.

## Failure parks one task, not the queue

An implementation, checkout, or publishing failure gets one automatic retry.
Repeated failure adds `agent:needs-human` and parks the task. Observation
failures get five attempts to tolerate transient GitHub or CI outages;
the [reconciler](https://github.com/shepherdjerred/monorepo/blob/main/packages/justin-principal-engineer/src/reconcile.ts)
owns those transitions.

Autonomous work has a bounded repair budget that survives restarts. Temporary
external failures back off instead of spending coding turns on unavailable
services. Permanent blockers stop that task while allowing other work to run.

Base drift is restacked with Git-Spice. If that stops on conflicts, a fresh
agent turn resolves them and the host explicitly continues the interrupted
rebase before it republishes the branch.

Parked state does not hold the single active slot. A later eligible issue can
run. Requeuing the parked Linear issue restores its recorded phase and reuses
the existing checkout.

## Related

- [Run the Linear agent queue](/how-to/run-the-linear-agent-queue/)
- [The agent task security boundary](/explanation/temporal/agent-task-boundary/)
- [Run the PR fleet](/how-to/run-the-pr-fleet/)
