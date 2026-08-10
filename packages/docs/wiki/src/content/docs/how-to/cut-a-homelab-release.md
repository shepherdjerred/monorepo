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

| Stage | What happens                                                            |
| ----- | ----------------------------------------------------------------------- |
| 1     | Suspend the current repository auto-sync on the root `apps` Application |
| 2     | Publish the `2.0.0-build` chart set to ChartMuseum, immutably           |
| 3     | Apply the exact child Application specs, still suspended                |
| 4     | Reconcile child workloads to their exact chart revisions                |
| 5     | Sync the exact root revision with verified pruning                      |
| 6     | Finalize the applied async operation                                    |
| 7     | Require every child `Synced` and `Healthy`                              |

Stage 3 is deliberately separate from stage 5. New child-level safety settings
must exist before those children sync, but enabling floating auto-sync before
every chart is published could expose a partially published release.

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
Stage 6 exists to prevent that: `finalize-async-sync` refuses failed or
mismatched operations and terminates the health wait once the requested sync
result is fully applied.

A release blocked here usually means that finalize did not run or rejected the
operation — check the root Application's operation state before retrying.

## Where it lives

`.buildkite/pipeline.yml` and `packages/homelab/scripts/argocd.ts`.

## Related

- [Why the release pipeline is shaped this way](/explanation/homelab/release-safety/)
