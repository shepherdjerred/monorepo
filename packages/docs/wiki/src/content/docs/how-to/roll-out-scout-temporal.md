---
title: Roll out Scout's Temporal workers
description: Replay histories, canary every queue, accept beta, and promote Workflow Deployments to production.
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

Protect every open Scout execution regardless of age. A patch can be retired
as soon as every execution that could take its old branch has closed and the
open executions replay against the candidate. There is no waiting period after
the last close. Inspect closed Scout histories with an archived compatible
bundle; do not reset them onto a bundle that has retired their types or patch
branches.

Retire a drained patch in two releases. First replace `patched` with
`deprecatePatch` at the same call site and keep only the new branch, so a
rollback to the previous bundle still reads the marker. Remove the
`deprecatePatch` call in a later release.

For compatibility removal, enumerate executions with their run IDs and replay
each protected run explicitly. A Workflow ID alone selects its latest run and
does not verify earlier runs in a continue-as-new chain. Both history replay
commands accept repeated `--run <workflow-id> <run-id>` arguments:

```bash
bun run replay:histories \
  --run <scout-workflow-id> <first-run-id> \
  --run <scout-workflow-id> <second-run-id>
```

## Prove every beta queue

Run the side-effect-free queue canary against the deployed Scout workers:

```bash
cd packages/scout-for-lol/packages/temporal
bun run canary \
  --stage beta \
  --address <beta-address> \
  --namespace beta --gateway
```

The result must name `scout-beta-realtime`, `scout-beta-interactive`,
`scout-beta-background`, `scout-beta-lake`, and `scout-beta-gateway`. A missing result means that
Activity Worker is not polling its declared queue; stop the rollout.

## Verify hosted queue ownership

1. Confirm the application runs the `application` role, and the dedicated
   gateway and activity worker each have one ready pod. Read the exact
   deployed image digests and chart revision.
2. Confirm the application owns `interactive` and `lake`, and the activity
   worker owns `realtime`, `background`, and competition Activities.
   Production retains its embedded Workflow poller. Beta Workflow tasks
   follow the current Worker Deployment build and any nonzero ramp.
   Confirm the gateway's Activity queue starts only after Discord is ready.
3. Run the queue canary and inspect representative persisted effects.
   `ScoutTemporalWorkerMissing` requires fresh evidence from each declared
   owner. `ScoutTemporalWorkflowRoutingUnknown` means the beta routing lookup
   is unavailable; a healthy candidate alone cannot establish current routing.
4. For rollback, choose the previous accepted selection that retains these
   split roles from the environment's
   [rollback candidates](/how-to/cut-a-homelab-release/#roll-back-an-environment).
   Keep the stage claim shared. Do not return to combined hosted ownership or
   scale workloads manually.

The [hosted chart](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/cdk8s-charts/scout.ts)
and [worker ownership rules](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/scout-temporal-rules.ts)
define these roles and monitoring requirements.

## Verify durable Schedules

1. After the central Schedule owner reconciles, inspect every declared beta
   fixed Schedule. Confirm it is active unless an explicit operator or
   credential pause applies. The
   [pause reference](/reference/temporal-schedules/#pause-behaviour) identifies
   the two retired migration notes reconciliation clears.
2. Confirm `clash-snapshot` completes through its background Activity owner.
   An empty upstream snapshot is a valid result; inspect the result and
   Activity history.
3. Inspect report Schedule ownership, outbox drain, and drift. Keep production's
   legacy progression delivery Schedule while its producers remain active.
   Reconciliation never backfills every missed occurrence.

## Protect long-lived signal receivers

Before ramping a producer with new signal fields, prepare its existing receivers.
Compare the [signal contracts](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/temporal/src/workflow-contracts.ts)
and [discovery producer](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/temporal/src/workflows/shared-match-dispatch.ts).
An optional field in the new contract can still fail an old strict reader.

1. Deploy the compatible candidate without changing Current. Replay each
   protected receiver run and pass the exact-version queue canary.
2. For production, first verify that beta accepted this exact build as Current
   with no ramp. Coordinate the receiver change with the rollout owner.
3. Describe the receiver's exact Workflow ID and Run ID. Inspect its existing
   override and version transition before changing either.
4. For a receiver without an in-progress transition, forward-pin that exact run
   to the verified candidate using
   [`workflow update-options`](https://docs.temporal.io/cli/command-reference/workflow#update-options):

   ```bash
   temporal workflow update-options \
     --namespace <beta-or-prod> \
     --workflow-id <receiver-workflow-id> --run-id <receiver-run-id> \
     --versioning-override-behavior pinned \
     --versioning-override-deployment-name <stage-deployment-name> \
     --versioning-override-build-id <candidate-image-git-sha>
   ```

5. Read back the override before starting the producer ramp. If a transition
   was already pending, do not treat a stored override as successful recovery.
   Verify the actual task receiver through the supported forward rollout;
   do not reset executions or edit their histories.
6. Keep the native ramp and health gates below. Verify pending receiver work
   completes on the candidate. For an idle receiver, retain replay and canary
   evidence; do not fabricate matches or product signals to make it run.
7. After the candidate is accepted as Current with no ramp, clear only this
   rollout's temporary override using behavior `unspecified`. Inspect the latest
   canonical run first: a natural Continue-As-New can inherit the override.

## Start the beta Workflow Deployment ramp

Inspect the retained hosts and qualified release, then request the exact beta
version set if automatic release has not already queued it:

```bash
toolkit deploy workers list scout-for-lol/beta --json
toolkit deploy versions scout-for-lol --json
toolkit deploy start scout-for-lol/beta VERSION_SET --json
toolkit deploy status DEPLOYMENT_ID --json
```

Delivery freezes the backend, retained Workflow pool and both frontend flavors
under one application lock. It replays candidate histories and runs the
exact-version canary before opening the initial ramp. Use the recorded stage
and routing evidence; do not separately mutate routing in the Temporal UI.

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

Delivery promotes directly once replay, the pinned canaries and pollers pass.
It has no timed observation windows. Follow the same request:

```bash
toolkit deploy wait DEPLOYMENT_ID --timeout 86400 --json
```

Record the beta image digest, deployed commit, and routing state. Promote as
soon as these checks pass:

- every fixed and per-report Schedule has the expected ownership and policy;
- all five Activity queues retain pollers and acceptable schedule-to-start
  latency;
- Workflow Task failures and nondeterminism remain zero;
- the report outbox drains and no stale product projection remains;
- interrupted provider attempts are explained and no ambiguous attempt caused
  a second LLM call;
- duplicate-effect claim failures remain zero; and
- representative triggers complete with their expected Discord and
  report-lake effects. Start a Schedule's action manually rather than waiting
  for its next occurrence.

A successful candidate retains older hosts until native execution visibility
proves they are drained.

## Accept the beta application release

1. Confirm ArgoCD reconciled the intended revision and all ordinary roles run
   the published image digest. Confirm the exact retained Workflow pool and native routing match the
   frozen release.
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

## Activate durable product producers

1. Release compatible Workflow registrations, Activity workers, and the
   database migration before changing the producer flag. Keep
   `scout_durable_orchestration_enabled` false during this release.
2. Verify the five-queue canary above against the deployed bundle. Check the
   announcement follow-up gauge. A missing gauge or a negative value fails
   this check.
3. Record the pause state and note for competition refresh, competition
   scheduled updates, weekly Bucks, and outreach Schedules.
   Pause active affected Schedules and wait for their old Activities to finish.
   Preserve Schedules already paused by an operator.
4. Enable the producer flag for beta through the existing Flipt management
   path. Activation waits for requests already using the legacy path. Resume
   only Schedules paused by this procedure, restoring their recorded state.
5. Exercise nonempty competition, weekly, and outreach cases in the existing
   beta guild.
   Interrupt an Activity after a persisted checkpoint and verify resumption.
   Confirm frozen content, stable IDs, S3 attachments, and delivery bookkeeping.
6. Once the beta checks pass, repeat them and the cutover in production.
   Preserve production's existing feature availability. A migration flag does
   not enable betting, Dares, or other beta features in production.
7. Retire compatibility code only after old-name starts have stopped, affected
   open executions have drained, and open-run replay passes. Roll an
   idle dispatcher with its rollover Signal; let its active child finish.
   Record the last affected close time and exact deployed builds in the PR.

If cutover fails, disable the producer flag and inspect committed work. After
activation, flag rollback pauses new production; it does not restore direct
sends. Keep compatible consumers running so committed work can complete.

## Repeat in production

Promote the accepted beta version set to `scout-for-lol/prod` through Delivery
and approve its exact frozen request as a signed-in human. Production replays
its retained histories, runs its own canary and verifies pollers and routing.
The production queue canary uses `--stage prod --namespace prod --gateway`.

Do not infer production acceptance from beta. Reconfirm Argo health, queue
pollers, Schedules, representative effects, and alert history in production.

## Roll back a candidate

If replay, canaries, alerts or runtime evidence fail, inspect the deployment,
list the environment's rollback candidates, and roll back to the deployment
whose selection you want restored:

```bash
toolkit deploy status DEPLOYMENT_ID --json
toolkit deploy candidates scout-for-lol/beta
toolkit deploy rollback scout-for-lol/beta ACCEPTED_DEPLOYMENT_ID --json
```

Use `scout-for-lol/prod` for production. Delivery preserves hosts serving pinned
executions, proves the routing change and records the selected artifacts in
PostgreSQL. If the failed request retains its lock, use the independent worker
recovery procedure before requesting another release. Do not reset image pins
or routing through a Git commit.

## Related

- [Why Scout embeds Temporal Workers](/explanation/temporal/scout-orchestration/)
- [Temporal schedule mechanics](/reference/temporal-schedules/)
- [Pause or debug a schedule](/how-to/pause-or-debug-a-schedule/)
