---
title: Roll out Scout's Temporal workers
description: Transfer one Scout workload family to Temporal, prove every queue, soak beta, and roll back without creating two owners.
sidebar:
  order: 6
---

Use this procedure separately for realtime ingestion, background maintenance,
reports, and interactive LLM work. Never enable a legacy owner and its Temporal
replacement at the same time.

## Before the cutover

Confirm each layer independently:

1. The complete stack is green at its exact head in Buildkite.
2. That image is deployed to beta and the Scout HTTP and Discord processes are
   healthy. A green PR or built image is not deployment evidence.
3. Fixed Scout Schedules exist in the Temporal UI and remain paused.
4. On a pre-cleanup rollout revision, the four temporary
   `scout_temporal_*_enabled` flags are off.
5. Temporal Worker readiness, task schedule-to-start latency, Workflow and
   Activity failures, report outbox age, schedule drift, stale projections,
   interrupted provider attempts, and duplicate-effect claims are visible.

Replay retained beta histories against both candidate Workflow bundles before
promoting changed Workflow code:

```bash
cd packages/scout-for-lol/packages/temporal
TEMPORAL_ADDRESS=<beta-address> TEMPORAL_TLS=true TEMPORAL_NAMESPACE=beta \
  bun run replay:histories <scout-workflow-id>...

cd packages/temporal
TEMPORAL_ADDRESS=<beta-address> TEMPORAL_TLS=true TEMPORAL_NAMESPACE=beta \
  bun run replay:scout-histories <weekly-or-bryan-workflow-id>...
```

Do not remove a replay patch until no open execution needs it and the
namespace's 30-day retention period has elapsed.

## Prove every queue

Run the side-effect-free canary against the deployed Scout Workers:

```bash
cd packages/scout-for-lol/packages/temporal
bun run canary -- \
  --stage beta \
  --address <beta-address> \
  --namespace beta
```

The result must name `scout-beta-realtime`, `scout-beta-interactive`,
`scout-beta-background`, and `scout-beta-lake`. A missing result means that
Activity Worker is not polling its declared queue; do not start a cutover.

## Transfer one workload family

The temporary family flags exist only on the rollout revisions. Complete this
transfer and the production soak before deploying the final cleanup revision.

1. Enable that family's `scout_temporal_*_enabled` flag. This first stops the
   legacy owner and allows new durable starts.
2. Wait for already-running legacy work to finish. Check its effects, not only
   the process log.
3. Unpause that family's fixed Schedules in the Temporal UI.
4. Trigger each Schedule once. For reports, also create or update a beta report
   and confirm its outbox row is reconciled into one owned per-report Schedule.
5. Confirm deterministic duplicate HTTP starts return the existing execution,
   and that effect-claim duplicate counters remain zero.

Never automatically fall back to the legacy owner during a Temporal outage.
That creates two authorities as soon as Temporal recovers.

## Exercise restart and outage recovery

For each family in beta:

1. Start representative work, restart the Scout backend, and verify the same
   Workflow resumes on the same ID.
2. Stop or isolate the Worker while Temporal remains available. Confirm the
   server keeps creating eligible Schedule actions and the next valid action
   obeys overlap, catchup, and staleness rules when the Worker returns.
3. Interrupt Temporal server access. Confirm Scout HTTP and Discord remain up,
   durable starts reject clearly, and no legacy scheduler takes ownership.
4. Restore Temporal and rerun the queue canary.
5. Disconnect and reconnect Explore SSE. Confirm the client rebuilds from the
   persisted snapshot and terminal outcome.
6. Disconnect report AI after its provider-attempt marker is written. Confirm
   the run salvages or interrupts and the provider receives no second request.
7. Force a report Schedule cron and task-queue mismatch, reconcile it, and
   confirm the desired definition returns while an operator pause is preserved.

## Run the beta soak

Record the beta image digest, deployed commit, and soak start time. Keep all
four families enabled for at least 24 hours. The soak passes only when:

- every fixed and per-report Schedule has the expected ownership and policy;
- all four Activity queues retain pollers and acceptable schedule-to-start
  latency;
- the report outbox drains and no stale product projection remains;
- interrupted provider attempts are explained and no ambiguous attempt caused
  a second LLM call;
- duplicate-effect claim failures remain zero;
- raw S3 persistence continues to gate match cursor advancement; and
- manual daily and weekly triggers complete with their expected Discord and
  report-lake effects.

Record the end time and evidence before promoting the same image to production.
Repeat the queue canary and representative manual triggers after production is
deployed, using `--stage prod --namespace prod`.

During the namespace drain, verify that new beta starts appear only in `beta`
and new production starts appear only in `prod`. Existing `default` executions
must keep pollers until they close; do not cancel or replay them merely to
finish the migration.

## Retire the drain namespace

After the last `default` execution closes, wait the additional 30-day retention
window, then re-read live state immediately before cleanup.

Schedule parity is **not** verifiable at this point, and expecting it here is a
trap. `migrate:namespaces -- audit` compares each target against its source
byte for byte, but the gateway's first reconciliation after cutover adds
`Environment`, `Domain`, `Trigger`, and `ReleaseCommit` search attributes plus
static summaries to every target. The frozen sources never had those, so the
comparison reports `does not match source` for a migration that was correct.
Parity is checked once, immediately after `cutover --confirm` and **before**
the gateway is restarted; see `packages/temporal/README.md`.

What must still be confirmed before deleting anything is quiescence, and the
source inventory has to exist to confirm it — the command re-inventories its
sources on every invocation, so it is vacuous rather than passing once the
sources are gone:

- every source schedule is paused;
- no `default` workflow starts after the cutover timestamp; and
- no remaining `default` executions.

That paused check is the only guard in the system against deleting a live
schedule — `schedule delete` has none of its own — so run it immediately
before the deletions and let nothing pause or unpause in between.

Only after those checks pass, delete every paused source schedule from the
drain namespace. List the schedules first, then delete each exact ID; do not
use a wildcard or delete a target schedule in `prod` or `beta`:

```bash
toolkit temporal --namespace default schedule list
toolkit temporal --namespace default schedule delete --schedule-id <SCHED_ID>
```

Remove `TEMPORAL_LEGACY_NAMESPACE` from the worker and client deployment
configuration in the same reviewed GitOps change and restart the affected
deployments. Verify the target schedules directly in `prod` and `beta` after
that change; do not rerun the source-inventory audit after deleting the source
schedules. Keep the built-in `default` namespace present but guarded and empty;
this is the only post-drain operation that targets it.

## Roll back a family

1. Pause its Temporal Schedules.
2. Stop accepting new starts for the family.
3. Wait for in-flight Temporal executions and effects to settle or cancel them
   explicitly.
4. Disable the family flag to restore the legacy owner.

Do not reverse steps 3 and 4.

After the cleanup revision is deployed, the temporary flags and workload
owners no longer exist. The narrow weekly-parlay callback remains replay-only
until its retention gate is satisfied. Roll back by pausing the affected
Schedules, settling in-flight Temporal executions, and deploying the last
compatible pre-cleanup image. Do not restore a legacy owner while Temporal work
is still in flight.

## Remove compatibility code

After the production soak, close every pre-cutover weekly-parlay and Bryan
Bucks execution and wait for 30 days of namespace retention to elapse. Replay
the saved sanitized histories against the cleanup bundle one final time. Only then
remove the replay-only HTTP callback Activity, shared token, both directions of
the callback NetworkPolicy boundary, and the false branch of `patched()`.

The workload-owner cleanup may land before that gate because it retains the
compatibility branch. The callback-boundary deletion must not: removing the
false branch of `patched()` sooner would make a retained pre-cutover history
non-deterministic.

## Related

- [Why Scout embeds Temporal Workers](/explanation/temporal/scout-orchestration/)
- [Temporal schedule mechanics](/reference/temporal-schedules/)
- [Pause or debug a schedule](/how-to/pause-or-debug-a-schedule/)
