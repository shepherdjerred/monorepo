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

1. The complete stack is green at its exact head in Buildkite.
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
bun run canary -- \
  --stage beta \
  --address <beta-address> \
  --namespace beta
```

The result must name `scout-beta-realtime`, `scout-beta-interactive`,
`scout-beta-background`, and `scout-beta-lake`. A missing result means that
Activity Worker is not polling its declared queue; stop the rollout.

## Start the beta Workflow Deployment ramp

Configure the private Temporal endpoint for every rollout command in this
shell:

```bash
export TEMPORAL_ADDRESS=<beta-address>
export TEMPORAL_TLS=true
```

Inspect the current routing and candidate registration before mutating it:

```bash
cd packages/temporal
TEMPORAL_NAMESPACE=beta bun run worker-deployment inspect -- \
  --target scout-beta \
  --build-id <candidate-image-git-sha>
```

For the first ramp, provide the accepted stable build explicitly. Later ramps
can use the routing already recorded by Temporal:

```bash
TEMPORAL_NAMESPACE=beta bun run worker-deployment start -- \
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

## Advance and soak beta

Use the rollout command to advance only after its alert and health windows are
clean:

```bash
TEMPORAL_NAMESPACE=beta bun run worker-deployment status -- \
  --target scout-beta \
  --build-id <candidate-image-git-sha>

TEMPORAL_NAMESPACE=beta bun run worker-deployment advance -- \
  --target scout-beta \
  --build-id <candidate-image-git-sha>
```

Record the beta image digest, deployed commit, routing state, and soak start
time. Observe the candidate for at least 24 hours. The soak passes only when:

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

Promote only after the command verifies the full observation window:

```bash
TEMPORAL_NAMESPACE=beta bun run worker-deployment promote -- \
  --target scout-beta \
  --build-id <candidate-image-git-sha>
```

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
TEMPORAL_NAMESPACE=<beta-or-prod> bun run worker-deployment rollback -- \
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
