---
title: Roll out Scout's Temporal workers
description: Replay histories, canary every queue, soak beta, and promote Workflow Deployments to production.
sidebar:
  order: 6
---

Scout runs in separate `beta` and `prod` Temporal namespaces. Roll out changed
Workflow code to beta first, preserve existing histories through replay
compatibility, and promote the same accepted image to production.

## Before the rollout

Confirm each layer independently:

1. The complete stack is green at its exact head in CI.
2. The candidate image digest and baked Git SHA match the commit under review.
3. Argo reports the Temporal and Scout applications `Synced` and `Healthy`.
4. Scout HTTP and Discord processes are healthy in beta.
5. Workflow and Activity pollers, task schedule-to-start latency, Workflow
   failures, nondeterminism, report outbox age, and duplicate-effect claims are
   visible.

Replay retained beta histories against both candidate Workflow bundles before
changing Worker Deployment routing:

```bash
cd packages/scout-for-lol/packages/temporal
TEMPORAL_ADDRESS=<beta-address> TEMPORAL_TLS=true TEMPORAL_NAMESPACE=beta \
  bun run replay:histories <scout-workflow-id>...

cd packages/temporal
TEMPORAL_ADDRESS=<beta-address> TEMPORAL_TLS=true TEMPORAL_NAMESPACE=beta \
  bun run replay:scout-histories <weekly-or-bryan-workflow-id>...
```

Do not remove a replay patch until no open execution needs it and the
namespace's retention period has elapsed.

## Prove every beta queue

Run the side-effect-free queue canary against the deployed Scout workers:

```bash
cd packages/scout-for-lol/packages/temporal
bun run canary \
  --stage beta \
  --address <beta-address> \
  --namespace beta
```

The result must name `scout-beta-realtime`, `scout-beta-interactive`,
`scout-beta-background`, and `scout-beta-lake`. A missing result means that
Activity Worker is not polling its declared queue; stop the rollout.

## Verify hosted queue ownership

1. Confirm the application runs the `application` role, and the dedicated
   gateway and activity worker each have one ready pod. Read the exact
   deployed image digests and chart revision.
2. Confirm the application owns `interactive` and `lake`, and the activity
   worker owns `realtime`, `background`, and competition Activities.
   Production retains its embedded Workflow poller. Beta Workflow tasks
   follow the current Worker Deployment build and any nonzero ramp.
3. Run the queue canary and inspect representative persisted effects.
   `ScoutTemporalWorkerMissing` requires fresh evidence from each declared
   owner. `ScoutTemporalWorkflowRoutingUnknown` means the beta routing lookup
   is unavailable; a healthy candidate alone cannot establish current routing.
4. For rollback, release the previous accepted image that retains these split
   roles. Keep the stage claim shared and the existing sync order. Use
   `release-root` for the exact chart revision; do not return to combined
   hosted ownership or scale workloads manually.

The [hosted chart](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/cdk8s-charts/scout.ts)
and [worker ownership rules](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/scout-temporal-rules.ts)
define these roles and monitoring requirements.

## Verify durable Schedules

1. After the central Schedule owner reconciles, inspect every declared beta
   fixed Schedule. Confirm it is active unless an explicit operator or
   credential pause applies. The
   [pause reference](/reference/temporal-schedules/#pause-behaviour) identifies
   the two retired migration notes reconciliation clears.
2. Confirm `clash-snapshot` and `custom-nights-expiry` complete through their
   background Activity owner. An empty upstream snapshot or no eligible nights
   is a valid result; inspect the result and Activity history.
3. Inspect report Schedule ownership, outbox drain, and drift. Keep production's
   legacy progression delivery Schedule while its producers remain active.
   Reconciliation never backfills every missed occurrence.

## Start the beta Workflow Deployment ramp

For Activity-only changes, keep the accepted Workflow Deployment pins and
routing. Check queue canaries and the changed effects after the backend release.
A new Workflow ramp is needed when the Workflow bundle changes.

Pin a workflow-capable candidate image through the catalog and release path.
Retain the accepted stable image and inspect current routing before starting
another ramp.

Configure the private Temporal endpoint for every rollout command in this
shell:

```bash
export TEMPORAL_ADDRESS=<beta-address>
export TEMPORAL_TLS=true
```

Inspect the current routing and candidate registration before mutating it:

```bash
cd packages/temporal
TEMPORAL_NAMESPACE=beta bun run worker-deployment inspect \
  --target scout-beta \
  --build-id <candidate-image-git-sha>
```

For the first ramp, provide the accepted stable build explicitly. Later ramps
can use the routing already recorded by Temporal:

```bash
TEMPORAL_NAMESPACE=beta bun run worker-deployment start \
  --target scout-beta \
  --build-id <candidate-image-git-sha> \
  --stable-build-id <stable-image-git-sha>
```

`start` replays the candidate histories, runs an exact-version canary, and then
opens the initial 10% ramp. Do not manually change Worker Deployment routing in
the Temporal UI while this command owns the rollout.

## Exercise restart and outage recovery

While the beta ramp is active:

1. Start representative work, restart the Scout backend and Workflow Worker,
   and verify the same Workflow resumes on the same ID.
2. Stop or isolate an Activity Worker while Temporal remains available. Confirm
   eligible Schedule actions wait and complete under their catchup and overlap
   policies when the Worker returns.
3. Interrupt Temporal access. Confirm Scout HTTP and Discord remain up and
   durable starts reject clearly.
4. Restore access and rerun the queue canary.
5. Disconnect and reconnect Explore SSE. Confirm the client rebuilds from the
   persisted snapshot and terminal outcome.
6. Disconnect report AI after its provider-attempt marker is written. Confirm
   the run salvages or interrupts without a second provider request.
7. Force a report Schedule cron and task-queue mismatch, reconcile it, and
   confirm the desired definition returns while an operator pause is preserved.

## Advance and accept beta

Use the rollout command to advance only after its alert and health windows are
clean:

```bash
TEMPORAL_NAMESPACE=beta bun run worker-deployment status \
  --target scout-beta \
  --build-id <candidate-image-git-sha>

TEMPORAL_NAMESPACE=beta bun run worker-deployment advance \
  --target scout-beta \
  --build-id <candidate-image-git-sha>
```

Record the beta image digest, deployed commit, and routing state. Observe the
candidate at 100% traffic. Promote when:

- every fixed and per-report Schedule has the expected ownership and policy;
- all four Activity queues retain pollers and acceptable schedule-to-start
  latency;
- Workflow Task failures and nondeterminism remain zero;
- the report outbox drains and no stale product projection remains;
- interrupted provider attempts are explained and no ambiguous attempt caused
  a second LLM call;
- duplicate-effect claim failures remain zero; and
- representative daily and weekly triggers complete with their expected
  Discord and report-lake effects.

The promotion command verifies the two-hour health window again:

```bash
TEMPORAL_NAMESPACE=beta bun run worker-deployment promote \
  --target scout-beta \
  --build-id <candidate-image-git-sha>
```

## Accept the beta application release

1. Confirm ArgoCD reconciled the intended revision and all ordinary roles run
   the published image digest. Preserve the accepted Workflow pins and routing
   when the Workflow bundle did not change.
2. Verify fixed Schedules and queue ownership using the checks above. Inspect
   match, prematch, progression, Explore, report, and competition receipts for
   one external-effect owner each.
3. Exercise changed effects and inspect their persisted results. Use focused
   fixtures for infrequent features and record unavailable live evidence.
   Keep healthy dispatchers and entity Workflows running.

## Resolve an uncertain report delivery

1. Open **Operations → Match operations** and inspect the report delivery row.
   Check its channel, frozen content, chunk index, and attempt nonce against
   Discord. Do not infer a non-send from a missing local response.
2. Choose **Answer delivery**. Confirm the observed message ID and delivery
   time, or confirm a verified non-send. A sending attempt is refused until
   its Activity timeout and grace period have passed.
3. Review and confirm the prepared operation. A stale nonce is refused.
   A non-send answer releases only that chunk; the ingestion reconciler sends
   the archived output with a fresh nonce. Completed chunks are never resent.
4. Refresh the report's run history and verify the delivery result. Retain the
   operation's audit record and Discord evidence for the investigated attempt.

## Repeat in production

Deploy the same accepted image to production, replay retained production
histories, and repeat `inspect`, `start`, canaries, `advance`, the observation
window, and `promote` with `TEMPORAL_NAMESPACE=prod` and `--target scout-prod`.
Set `TEMPORAL_ADDRESS` to the production endpoint before those commands. The
production queue canary uses `--stage prod --namespace prod`.

Do not infer production acceptance from beta. Reconfirm Argo health, queue
pollers, Schedules, representative effects, and alert history in production.

## Roll back a candidate

If replay, canaries, alerts, or runtime evidence fail, stop routing new Workflow
tasks to the candidate:

```bash
TEMPORAL_NAMESPACE=<beta-or-prod> bun run worker-deployment rollback \
  --target <scout-beta-or-scout-prod> \
  --build-id <candidate-image-git-sha>
```

The command removes the exact active ramp without cancelling Workflow
executions or replaying effects. After candidate-bound histories drain, rerun
`rollback` with no active ramp to reset the candidate pin to the stable image,
then commit the catalog and rollout-state changes through the normal pull
request flow.

## Related

- [Why Scout embeds Temporal Workers](/explanation/temporal/scout-orchestration/)
- [Temporal schedule mechanics](/reference/temporal-schedules/)
- [Pause or debug a schedule](/how-to/pause-or-debug-a-schedule/)
