---
title: Roll out a Temporal Worker Deployment
description: Canary, ramp, promote, or roll back central or Scout Workflow bundles while stable and candidate pollers remain available.
sidebar:
  order: 7
---

Run this procedure from `packages/temporal`. The commands change live Temporal
routing. They do not deploy images or commit the promoted pin.

Choose a target and keep it on every command. Omit `--target` only for central:

| Target     | Flag                       | Deployment                   |
| ---------- | -------------------------- | ---------------------------- |
| central    | none or `--target central` | `monorepo-central-workflows` |
| Scout beta | `--target scout-beta`      | `scout-beta-workflows`       |
| Scout prod | `--target scout-prod`      | `scout-prod-workflows`       |

Complete Scout beta acceptance before starting Scout production.

Scout's initial extraction requires two workflow-capable image releases. The
checked-in pre-entrypoint pin creates no pod. After the prerequisite code lands,
copy the first capable candidate pin to stable through a reviewed pin PR; this
creates only the stable pod. Let the next image release advance candidate to a
distinct Build ID; that creates the ramp target. The embedded backend poller
drains old histories but is not the versioned stable fallback. Repeat the same
sequence for production only after beta acceptance.

## Before starting

Confirm that the candidate image pin is deployed and copy the exact 40-character
Git SHA baked into that image. Keep the [stable and candidate Kubernetes
Deployments](https://github.com/shepherdjerred/monorepo/blob/95a219ec8fca805e0cfccf6a2ebd0dcfebc3e63a/packages/homelab/src/cdk8s/src/resources/temporal/workflow-worker.ts)
healthy. Do not remove legacy queue pollers while visibility still shows open
executions on those queues; the [rollout preflight](https://github.com/shepherdjerred/monorepo/blob/95a219ec8fca805e0cfccf6a2ebd0dcfebc3e63a/packages/temporal/src/lib/worker-deployment-proofs.ts)
checks the candidate poller before changing routing.

Set `TEMPORAL_ADDRESS` (and `TEMPORAL_TLS=true` for the private TLS endpoint) in
the operator shell. The package command uses the existing `toolkit temporal`
passthrough and never falls back to Kubernetes-only service DNS.

During Scout bootstrap, verify that stable and candidate are both capable,
distinct images and both exact versions have registered pollers. Pass the
stable image SHA with `--stable-build-id` on the first `start` command.

Inspect the candidate without changing routing:

```bash
TEMPORAL_NAMESPACE=prod bun run worker-deployment status --build-id <candidate-image-git-sha>
```

The command fails when the Build ID is stale, the candidate has not registered
the target-selected Workflow queue (`monorepo-workflows` for central,
`scout-beta` for Scout beta, or `scout-prod` for Scout prod), the
version-specific poller metric is zero, or a native diagnostic returns invalid
data.

## Start the ramp

```bash
TEMPORAL_NAMESPACE=prod bun run worker-deployment start --build-id <candidate-image-git-sha>
```

`start` refuses an existing ramp or firing `Temporal.*` alert. It verifies that
the checkout SHA equals the candidate Build ID, requires a clean tracked
checkout, replays the real Workflow suite and the retained IDs listed in
`TEMPORAL_REPLAY_WORKFLOW_IDS`, starts a canary pinned to the candidate version,
and waits for that Workflow to
complete. For an empty Worker Deployment, pass the already registered stable
Build ID so the deployment has a rollback target before candidate traffic:

```bash
TEMPORAL_NAMESPACE=prod bun run worker-deployment start \
  --build-id <candidate-image-git-sha> \
  --stable-build-id <stable-image-git-sha>
```

The command makes that stable version current, then opens the 10% candidate
ramp. Later releases need only `--build-id`.

## Advance to 50% and 100%

After at least 30 clean minutes at 10%:

```bash
TEMPORAL_NAMESPACE=prod bun run worker-deployment advance --build-id <candidate-image-git-sha>
```

After at least two clean hours at 50%, run the same command again. It advances
to 100%. Each transition rechecks candidate pollers, currently firing alerts,
and Prometheus alert history over the entire required window. An alert that
fired and resolved during the window still blocks the transition. An early,
repeated, or out-of-order command fails without changing routing.

## Promote after the soak

After at least 24 clean hours at 100%:

```bash
TEMPORAL_NAMESPACE=prod bun run worker-deployment promote --build-id <candidate-image-git-sha>
```

Promotion verifies that the candidate catalog image contains the requested
Build ID as its baked `GIT_SHA`, copies that exact value into the stable pin,
makes the candidate current, and removes the ramp. Catalog-first ordering makes
an interrupted promotion safe to retry. Review and commit both the catalog and
`scripts/pin-candidates-state.json` changes through the normal pull-request
flow. Do not claim
promotion complete until GitOps has deployed the resulting stable pin and both
poller tracks are healthy.

## Roll back a ramp

```bash
TEMPORAL_NAMESPACE=prod bun run worker-deployment rollback --build-id <candidate-image-git-sha>
```

Rollback removes only an active ramp for that exact candidate, including when a
newer candidate registered after the ramp began. The prior
current version remains current. Keep the rejected candidate available while
any executions pinned to it drain. Only after that drain is verified, rerun the
command with the same Build ID to reset a divergent rejected candidate pin to
the stable catalog value; it refuses to reset a candidate that is already
current.

After rollback, verify schedule health, Workflow task failures, queue latency,
and representative executions. Keep the rejected candidate pod available until
executions pinned by the canary or operator override have closed. Then copy the
stable catalog value back to candidate by rerunning `rollback` with the same
Build ID while no ramp is active, then review and commit both the resulting
catalog and `scripts/pin-candidates-state.json` changes through the normal
pull-request flow.
Image commit-back retains a Workflow candidate whenever stable and candidate
differ, so a new build cannot replace an in-flight candidate and will not
advance the track again until this post-rollback reset lands.

## Native diagnostics

Use the existing passthroughs for deeper inspection; there is no rollout
toolkit subcommand:

```bash
toolkit temporal --namespace prod worker deployment describe --name monorepo-central-workflows
toolkit temporal --namespace prod worker deployment describe-version \
  --deployment-name monorepo-central-workflows \
  --build-id <candidate-image-git-sha> \
  --report-task-queue-stats
toolkit prom query 'ALERTS{alertstate="firing",alertname=~"Temporal.*"}'
toolkit loki query '{service_name="temporal-central-workflows"}' --since 1h --limit 50
toolkit tempo --help
```

Record the deployed digest, execution IDs, soak times, and live screenshots in
the pull request or Linear. Do not create a repository rollout journal.
