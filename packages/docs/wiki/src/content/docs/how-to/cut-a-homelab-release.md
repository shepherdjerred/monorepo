---
title: Cut a homelab release
description: How a repository-backed homelab release is published and reconciled, and what to do when a stage fails.
sidebar:
  order: 8
---

The main Buildkite pipeline is the only writer for repository-backed homelab
releases. You do not run these steps by hand — merging to `main` runs them.

This page is for reading the pipeline while it works, and for knowing what a
failed stage means.

## The sequence

| Stage | What happens                                                              |
| ----- | ------------------------------------------------------------------------- |
| 1     | Suspend the current repository auto-sync on the root `apps` Application   |
| 2     | Publish the `2.0.0-build` chart set to ChartMuseum, immutably             |
| 3     | Stage exact child specs and root prerequisites, with children suspended   |
| 4     | Reconcile child workloads to their exact chart revisions                  |
| 5     | Restore and safely finalize the exact root revision with verified pruning |
| 6     | Require every release-scoped child to be `Synced` and `Healthy`           |

Stage 3 is deliberately separate from stage 5. New child-level safety settings
must exist before those children sync, but enabling floating auto-sync before
every chart is published could expose a partially published release.

Stage 3 also applies root-owned prerequisites such as admission policies, but
keeps every child Application's auto-sync disabled. This lets stage 4 explicitly own
child operations without racing ArgoCD. Stage 5 restores the exact auto-sync
policies and prunes only after reconciliation. Stage 6 is the single
authoritative scoped health gate.

The
[release policy](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/application-release-policy.ts)
stages repository-chart Applications with explicit auto-sync state. The
[artifact-level chart test](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/helm-template.test.ts)
requires every published automated policy to have a boolean `enabled`. If the
final root apply reports that `spec.syncPolicy.automated` became invalid
`null`, do not retry. Regenerate the chart with explicit state.

## If a child stays out of sync

Child reconciliation retries a failed operation recorded against the current
chart revision, **even when ArgoCD already reports the application Synced and
Healthy**. That is intentional: it clears a failed apply after a new
child-level safety setting made the same immutable chart revision safe to
retry.

So a stuck child usually clears on the next release rather than needing a hand
sync.

## If pruning looks wrong

Root pruning does not trust ArgoCD's cached `OutOfSync` or `requiresPruning`
flags. The selective manifest-override sync temporarily marks unselected
retained children as requiring prune, so those flags can describe the override
rather than the published tree.

The release script renders the exact `apps` revision and treats only live child
Applications **absent from that rendered set** as prune candidates. Each
candidate must also carry the `ci.sjer.red/application-lifecycle: cascade`
annotation and the Argo resources finalizer.

:::caution
Never classify prune candidates from `OutOfSync` or `requiresPruning` alone. That
is how you delete a retained application.
:::

## If the image did not rebuild

Application image selection uses the newest `main` commit whose `images` and
`version-commit-back` jobs both passed as its comparison base.

A later version-pin commit can cancel the rest of that build without
invalidating its completed image build, smoke test, and durable pin-handoff
evidence. Changes after that image-release commit still rebuild their affected
closures; an unchanged pin-only successor does not rebuild and repin the same
application forever.

If you expected a rebuild and got none, check whether your commit only moved a
pin.

## If the release will not start

A previous root operation stuck in `Running` blocks the next ordered release.
Stage 5 prevents that in the normal pipeline. One process submits the sync,
waits for its exact request ID and revision, verifies the complete applied
result, terminates the aggregate health wait, and waits for termination.
Completeness means every resource in the exact rendered root revision has a
successful result and every validated prune candidate has a `Pruned` result; a
fully applied early sync or prune wave is not enough.

Buildkite retries reuse the build UUID. The command adopts the operation only
when both UUID and revision match. An unrelated active operation remains a hard
failure. Each POST also receives an internal operation UUID; adoption requires
the live operation and its status to share that UUID before a stable applied
result can be finalized.

For manifest-override staging operations, inspect the
`ci.sjer.red/revision` operation-info entry. Argo does not retain
`operation.sync.revision` for that request shape, so CI persists the same exact
revision beside both UUIDs and rejects any disagreement when both forms exist.

A release blocked here means the current operation must be inspected before
retrying. If it is a fully applied operation from an interrupted older client,
recover it with both values from the live operation:

```bash
bun packages/homelab/scripts/argocd.ts finalize-async-sync apps \
  --revision <exact-revision> \
  --request-id <exact-request-id> \
  --timeout 300
```

The recovery command polls for that exact operation and discovers its internal
operation UUID from the live state. It terminates only when the completed status
has the same UUID. Missing state, a different identity, an apply failure, or an
incomplete result fails without termination.

An operation created by the retired split pipeline predates internal operation
UUIDs. The recovery command accepts that legacy shape only when both the live
operation and completed status have the exact request ID and revision and both
omit the internal UUID. New atomic operations always require their internal
UUID.

## Where it lives

The workflow is defined by the
[main release pipeline](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml)
and the
[Argo operator command](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/scripts/argocd.ts).

## Related

- [Why the release pipeline is shaped this way](/explanation/homelab/release-safety/)
