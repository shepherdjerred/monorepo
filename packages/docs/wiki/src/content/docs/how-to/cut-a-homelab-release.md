---
title: Cut a homelab release
description: How a repository-backed homelab release is published and reconciled, and what to do when a stage fails.
sidebar:
  order: 8
---

The main Buildkite pipeline is the only writer for repository-backed homelab
releases. You do not run these steps by hand — merging to `main` runs one
`release-root` command that owns the complete sequence.

This page is for reading the pipeline while it works, and for knowing what a
failed stage means.

## The sequence

| Stage | What happens                                                              |
| ----- | ------------------------------------------------------------------------- |
| 1     | Admit only a build whose commit is the current `main`                     |
| 2     | Suspend the current repository auto-sync on the root `apps` Application   |
| 3     | Publish the `2.0.0-build` chart set to ChartMuseum, immutably             |
| 4     | Stage exact child specs and root prerequisites, with children suspended   |
| 5     | Reconcile every desired child in root sync-wave order                     |
| 6     | Restore and safely finalize the exact root revision with verified pruning |
| 7     | Require every release-scoped child to be `Synced` and `Healthy`           |

If the admission step finds a newer `main` commit, the homelab mutation lanes
stop before suspending auto-sync or applying OpenTofu. Once admitted, a release
continues with its bound build UUID and revision even if `main` moves later.

Stage 4 is deliberately separate from stage 6. New child-level safety settings
must exist before those children sync, but enabling floating auto-sync before
every chart is published could expose a partially published release.

Stage 4 also applies root-owned prerequisites such as admission policies from
the exact chart source. Only Applications whose auto-sync policy must stay
disabled use local manifest overrides, so stage 4 owns child operations without
racing ArgoCD while unchanged cluster-scoped resources still follow Argo's
normal source-apply path. In stage 6, the
[root finalizer](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/scripts/argocd.ts)
reapplies every exact sync wave before running the verified prune. Unchanged
resources use source-selective syncs. The self-managed root Application alone
uses a local override to keep auto-sync disabled between batches; the final
prune restores that one policy. Stage 7 is the single authoritative scoped
health gate.

The platform-account apply runs alongside the infrastructure release after
verification. It applies the `openai`, `anthropic`, `discord`, and `openrouter`
stacks before ArgoCD sync, so generated credentials and their 1Password
handoffs exist before workloads consume them. The step is serialized separately
from the other OpenTofu applies and has no automatic retry because a provider
may return a new secret only once.

If the platform-account step fails, inspect the encrypted stack state and the
corresponding 1Password handoff before resuming. Do not blindly retry a
partial credential create.

Stage 5 renders the same exact root revision and walks its child Applications
in numeric sync-wave order. Repository-published children take their immutable
revision from the release inventory. External children, such as cert-manager,
take the complete source pinned in the root manifest, including chart or Git
revision and Helm values. This matters because stage 4 disabled their auto-sync
too: waiting until stage 6 to restore
that policy would let a repository child run against an older external
controller. A release-inventory child missing from the exact root, or a
repository child missing from the release inventory, is a hard failure.

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

It also checks the most recent deployment history. Immediately after stage 4,
ArgoCD can compare a newly pinned external source and report the new revision
as `Synced` before that source has been deployed. The comparison revision alone
is not release evidence; stage 5 syncs again unless the latest history entry's
source is semantically identical to the complete rendered source. Comparing
only the target revision would miss a Helm-values change at the same chart
version. External applications already deployed from that exact source are
left to their restored auto-sync policy instead of pulling unrelated
same-source drift into this release.

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

If the image push finishes but candidate classification reports that no managed
pin exists, do not retry the push. The comparison digest and commit-back key
come from `packages/version-catalog/src/catalog.json`; verify that the
real bake target has an exact image entry there and that the publisher is
reading that structured catalog rather than the generated runtime projection.

## If GHCR rejects a workload pull

The
[image publication flow](https://github.com/shepherdjerred/monorepo/blob/6891646ef4bfbe67a3b5bea615c0e100e99c6145/.buildkite/scripts/bake-images.ts)
resolves every pushed candidate to a digest. The
[anonymous GHCR probe](https://github.com/shepherdjerred/monorepo/blob/ecfd92e182858588dc98c9ed85fcefe768fb0680/.buildkite/scripts/ghcr-public-access.ts)
then fetches that immutable digest before the job records any pin candidate. A
`401` from the anonymous token request means the package is still private. A
manifest `404` after a successful token request can be brief registry
propagation and is retried within the job. The flow also inspects the effective
OCI configuration at that digest and rejects a missing or incorrect monorepo
source label.

For a newly named application image:

1. Confirm its runtime Dockerfile has the exact monorepo
   `org.opencontainers.image.source` label in the published stage or its
   ancestry.
2. Publish the first candidate to create the GHCR package. GitHub creates it
   private, and CI cannot change that: the Packages REST API exposes only
   get, list, delete, and restore, and the web UI gates a visibility change
   behind a typed confirmation.
3. Open the package's **Package settings**, and under "Danger Zone" use
   **Change visibility** to make it public. This is a one-time step per new
   package, not a workaround — no token scope makes it automatable. The
   anonymous probe names this step and the exact settings URL when it fails.
4. Verify the anonymous token request and exact digest fetch before continuing
   the release.

Do not distribute the publisher's broad GHCR credential to application
namespaces to conceal a visibility mistake.

## If the release will not start

A previous root operation stuck in `Running` blocks the next ordered release.
Stage 6 prevents that in the normal pipeline. One process owns every desired
wave and the final prune. It waits for the exact request ID, revision, and
per-operation UUID; verifies each selected batch; terminates its aggregate
health wait; and waits for termination before starting the next operation.
After every resource in the exact rendered revision has a successful batch
result, except for the intentionally suspended root auto-sync policy, the
full-source operation must report the restored root Application as `Synced` and
every validated prune candidate as `Pruned`. A fully applied early batch or
prune wave is not enough.

Buildkite retries reuse the build UUID. `release-root` adopts an operation only
when the UUID and revision match and its selected resources are exactly one
desired batch, or when it is the unselected final prune. An unrelated active
operation or an unexpected selection remains a hard failure. The operation must
also carry an explicit `stage`, `batch`, `prune`, or `child` marker; prune
adoption
requires Argo's prune flag. This prevents an interrupted legacy full-source sync
from impersonating the post-batch prune. Each POST also receives an internal
operation UUID; adoption requires the live operation and its status to share
that UUID before a stable applied result can be finalized.

For a rewritten Application's manifest-override operation, inspect the
`ci.sjer.red/revision` operation-info entry. Argo does not retain
`operation.sync.revision` for that request shape, so CI persists the same exact
revision beside both UUIDs and rejects any disagreement when both forms exist.
Unchanged resources use source-selective operations and retain the revision in
Argo's ordinary sync request as well as the identity metadata.

A release blocked here means the current operation must be inspected before
retrying. Confirm the operation's request ID, revision, selected resources,
phase marker, and prune flag in ArgoCD. Do not terminate it based on revision
alone. Once the observed operation belongs to the same Buildkite build, retry
the failed Buildkite job; the same command and build UUID adopt only that exact
operation and continue the release.

```bash
argocd app get apps --show-operation
```

## If the root operation says it was terminated

After the exact root operation reports all selected resources applied, the
release process deliberately terminates its aggregate wait. This leaves an
ArgoCD terminal message that does not describe release failure.

Use the `homelab-release-result.json` artifact and the Buildkite
`homelab-release-result` annotation as the receipt. `applied-verified` means
the request ID, revision, selected resource results, and final child health
all passed. No receipt means the release did not complete.

## If you start a global sync manually

An ordinary global sync of `apps` is supported. Use ArgoCD's normal sync action;
do not copy child sync options into the request by hand. Admission merges each
managed child Application's declared options into the manual operation, and
the declared value wins if the request contains the same option key.

The global sync follows the chart's deterministic waves. Only the recursive
`apps` Application ignores health; degraded child Applications remain visible
and block progression where their wave is a dependency boundary. If a global
sync reports an immutable-field or mutually-exclusive-probe-handler failure,
stop and inspect that resource. The automated `release-root` path runs its
read-only preflight before submitting child operations, but a manual ArgoCD UI
sync does not run that client-side check.

## Where it lives

The workflow is defined by the
[main release pipeline](https://github.com/shepherdjerred/monorepo/blob/main/.buildkite/pipeline.yml)
and the
[Argo operator command](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/scripts/argocd.ts).

## Related

- [Why the release pipeline is shaped this way](/explanation/homelab/release-safety/)
