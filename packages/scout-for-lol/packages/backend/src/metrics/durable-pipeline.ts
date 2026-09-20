import { Counter, Gauge } from "prom-client";
import { SCOUT_V2_MATCH_RECEIPT_KINDS } from "@scout-for-lol/temporal/match-receipts-v2";
import { SCOUT_V2_WORKFLOW_NAMES } from "@scout-for-lol/temporal/identifiers";
import type { Db } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { registry } from "#src/metrics/registry.ts";

const logger = createLogger("metrics-durable-pipeline");

/**
 * What the durable V2 pipeline is holding, and for how long.
 *
 * THIS IS THE SINGLE DEFINITION SITE for these metrics, for the same reason
 * `durable.ts` says so about the dual-write counters: prom-client throws at
 * import time when two modules register one name on the shared registry, so a
 * second declaration is a boot failure rather than a first-`inc()` failure.
 *
 * ## Why these five and not others
 *
 * The beta acceptance checklist asks five questions, and each family here is
 * exactly one of them:
 *
 * - *Are notifications draining, and is anything stuck at the operator dead
 *   end?* — `scout_durable_notification_intents`, which is also where the
 *   unknown-delivery count lives. It is one series per state rather than a
 *   separate unknown-delivery gauge because the interesting comparison is
 *   between states: drivable work piling up while settled work does not is a
 *   different failure from everything arriving at `unknown-delivery`.
 * - *Is recovery keeping up?* — `scout_durable_recovery_batches` for the
 *   distribution and the `live-recovery-batches` backlog family for the age.
 * - *Is anything stranded?* — `scout_durable_backlog_oldest_age_seconds`.
 * - *Is the lake behind?* — `scout_durable_lake_staging_lag_seconds`.
 * - *Are receipts being written, and is anything writing two different claims
 *   about one fact?* — `scout_durable_receipts_recorded_total`.
 *
 * ## Why every label here is bounded
 *
 * Each label draws from a closed vocabulary that a type already enforces, and
 * none of them can take a value from a match, a guild, an intent key, or
 * anything else that grows with traffic:
 *
 * - `state` on the intent gauge: the 8 kinds of the domain's
 *   `NotificationIntentState` union, enumerated from the exhaustive
 *   classification table in `pipeline-scan.ts`.
 * - `state` on the recovery gauge: the 6 kinds of `RecoveryBatchState`, from
 *   the exhaustive liveness table beside it.
 * - `family` on the age gauge: the three constants below, and there is no code
 *   path that derives one from data.
 * - `artifact_kind` on the lake gauge: `ArtifactKindSchema`'s three members.
 * - `receipt_kind` / `outcome` on the receipt counter: see the counter's own
 *   note — the kinds are source literals from four owner modules, and the
 *   outcomes are the repository's three-member result union.
 *
 * ## Why the gauges are zero-filled
 *
 * Every series is written on every sweep, including the ones whose answer is
 * zero. A state with no rows and a sweep that stopped running look identical
 * from a gauge that only writes what it found, and only one of them is good
 * news. Zero-filling makes the difference visible as present-and-zero versus
 * absent, which is what the `absent()` guard on the alerts keys on.
 */

/**
 * The backlogs whose age is the alertable signal.
 *
 * Only families whose ordering column is a true age are here. Stalled
 * notifications are deliberately absent: `listStalledNotificationIntents`
 * orders by `freshnessDeadline`, so its head is the intent closest to
 * EXPIRING, not the one waiting longest, and reporting that as an age would
 * invert the direction an operator reads. The notification backlog's depth is
 * on the intent gauge instead, where it is honest.
 */
export const DURABLE_BACKLOG_FAMILIES = [
  "stalled-match-processing",
  "live-recovery-batches",
  "unaccepted-workflow-starts",
] as const;
export type DurableBacklogFamily = (typeof DURABLE_BACKLOG_FAMILIES)[number];

export const scoutDurableNotificationIntents = new Gauge({
  name: "scout_durable_notification_intents",
  help: "Match notification intents held in each state of the domain's intent machine.",
  labelNames: ["state"] as const,
  registers: [registry],
});

export const scoutDurableRecoveryBatches = new Gauge({
  name: "scout_durable_recovery_batches",
  help: "Match recovery batches held in each state of the domain's batch machine.",
  labelNames: ["state"] as const,
  registers: [registry],
});

export const scoutDurableBacklogOldestAge = new Gauge({
  name: "scout_durable_backlog_oldest_age_seconds",
  help: "Age of the oldest row in each durable backlog family, or zero when the family is empty.",
  labelNames: ["family"] as const,
  registers: [registry],
});

export const scoutDurableLakeStagingLag = new Gauge({
  name: "scout_durable_lake_staging_lag_seconds",
  help: "How long the longest-unprojected archived artifact has waited for its lake staging receipt, by artifact kind, or zero when none is waiting.",
  labelNames: ["artifact_kind"] as const,
  registers: [registry],
});

/**
 * Receipt writes by kind and repository answer.
 *
 * `receipt_kind` is bounded by construction rather than by a type. The domain
 * models a kind as a branded kebab-case string on purpose — the owning
 * workflow of a later wave defines its own, so the domain must not enumerate
 * them — but every value that ever reaches this label is a literal in one of
 * the four owner modules (`durable-receipts.ts`, `match-receipts-v2.ts`,
 * `receipt-evidence.ts`, and the V2 notification and recovery receipt
 * modules). No request, match, guild, or user input can put a value here, so
 * the series count is the number of kinds the source declares.
 *
 * `outcome` is `recordReceipt`'s three-member result union. `conflict` is kept
 * apart from `applied` because it is the one value that means something was
 * recorded twice with two different claims about it — the duplicate signal the
 * acceptance checklist asks about — and folding it into a failure count would
 * lose that.
 */
export const scoutDurableReceiptsRecorded = new Counter({
  name: "scout_durable_receipts_recorded_total",
  help: "Match processing receipt writes, by receipt kind and repository outcome.",
  labelNames: ["receipt_kind", "outcome"] as const,
  registers: [registry],
});

/**
 * Workflow-start acceptances by the answer the durable handoff gave.
 *
 * This exists to measure ONE of its three series. `answered-by-another-run` is
 * reached when a request had two drivers, the recorded run closed in the gap
 * between one adopting and the other starting, and the second start therefore
 * began a genuinely new execution under the family's reuse policy. Both runs
 * are real, the request keeps the first as evidence because evidence is never
 * overwritten, and the table consequently names one run where two existed.
 *
 * That is an observability gap rather than a correctness one: once Temporal
 * has begun an execution it is durable in Temporal and completes on its own,
 * and the adoption exists for a starter that died before recording, not to
 * keep a running Workflow alive. The branch only became reachable when
 * reconciliation moved to `ALLOW_DUPLICATE` and it needs a narrow
 * interleaving, so nobody has yet seen it taken. The counter is how the beta
 * soak answers whether it happens at all, before anyone builds the
 * append-only record of the additional runs that closing it would need.
 *
 * ## Why all three outcomes and not just the interesting one
 *
 * A counter that only counted the rare answer would make zero ambiguous
 * between "it never happened" and "nothing is wired up" — and zero is the
 * reading this soak is most likely to produce and most needs to trust.
 * Counting the ordinary answers too means `applied` climbing is standing proof
 * the instrument is live, so a flat `answered-by-another-run` beside it is
 * evidence rather than silence. It is the counter's version of why the gauges
 * above are zero-filled.
 *
 * ## This is deliberately not alertable
 *
 * There is no operator action for a single occurrence — the extra run is
 * already running and will finish — so a rule that paged on it would be worse
 * than the gap it reports. It carries no alert rule in
 * `scout-durable-rules.ts` on purpose, and a threshold is not a substitute:
 * a threshold is still a rule someone can lower. This is a measurement
 * feeding a decision after the soak, and if it reads non-zero the answer is
 * the durable record, not a page.
 *
 * Both labels are closed. `outcome` is the three members of
 * `RecordWorkflowStartAcceptedResult`, and the repository's throws are
 * deliberately uncounted for the reason receipts give: a broken invariant is
 * not one of the answers the table can legitimately return.
 */
export const scoutDurableWorkflowStartAcceptances = new Counter({
  name: "scout_durable_workflow_start_acceptances_total",
  help: "Workflow start acceptances, by the answer the durable handoff gave. `answered-by-another-run` means the request records one run where two executions existed.",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

function ageSeconds(oldest: Date | null, now: number): number {
  return oldest === null ? 0 : Math.max(0, (now - oldest.getTime()) / 1000);
}

/**
 * Fill the four swept families from the durable tables.
 *
 * Runs only where `databaseMetricSweepsEnabled()` is true, so exactly one role
 * pays for it and one set of series describes the deployment — see
 * `sweep-policy.ts` for why that is a deployment fact rather than a process
 * one. The lake family is not here: its receipt-kind vocabulary belongs to
 * `report-lake/`, which `metrics/` may not import, so that half registers
 * itself through `sweep-registry.ts`.
 *
 * Nothing is left at its last value on failure. A stale gauge reads as a
 * healthy pipeline that simply is not moving, which is indistinguishable from
 * one that really drained. The age gauges take -1, which cannot be mistaken
 * for an age; the distribution gauges are cleared instead, because "the sweep
 * could not answer" is not a count and -1 intents in `pending` would be a
 * stranger claim than no series at all. Their alert guards on `absent()`.
 */
export async function collectDurablePipelineMetrics(db: Db): Promise<void> {
  try {
    const { NOTIFICATION_INTENT_STATE_KINDS, RECOVERY_BATCH_STATE_KINDS } =
      await import("#src/database/durable/pipeline-scan.ts");
    const {
      countNotificationIntentsByState,
      countRecoveryBatchesByState,
      oldestLiveRecoveryBatchAt,
      oldestStalledMatchProcessingAt,
      oldestUnacceptedWorkflowStartAt,
    } = await import("#src/database/durable/pipeline-backlog.ts");

    const now = Date.now();
    const [intents, batches, stalledMatchAt, recoveryAt, workflowStartAt] =
      await Promise.all([
        countNotificationIntentsByState(db),
        countRecoveryBatchesByState(db),
        oldestStalledMatchProcessingAt(db, {
          observationReceiptKind: SCOUT_V2_MATCH_RECEIPT_KINDS.observation,
        }),
        oldestLiveRecoveryBatchAt(db),
        oldestUnacceptedWorkflowStartAt(db, {
          workflowTypes: SCOUT_V2_WORKFLOW_NAMES,
        }),
      ]);

    for (const state of NOTIFICATION_INTENT_STATE_KINDS) {
      scoutDurableNotificationIntents.set({ state }, intents.get(state) ?? 0);
    }
    for (const state of RECOVERY_BATCH_STATE_KINDS) {
      scoutDurableRecoveryBatches.set({ state }, batches.get(state) ?? 0);
    }
    scoutDurableBacklogOldestAge.set(
      { family: "stalled-match-processing" },
      ageSeconds(stalledMatchAt, now),
    );
    scoutDurableBacklogOldestAge.set(
      { family: "live-recovery-batches" },
      ageSeconds(recoveryAt, now),
    );
    scoutDurableBacklogOldestAge.set(
      { family: "unaccepted-workflow-starts" },
      ageSeconds(workflowStartAt, now),
    );
  } catch (error) {
    for (const family of DURABLE_BACKLOG_FAMILIES) {
      scoutDurableBacklogOldestAge.set({ family }, -1);
    }
    scoutDurableNotificationIntents.reset();
    scoutDurableRecoveryBatches.reset();
    logger.error("Failed to update durable pipeline metrics", { error });
  }
}

/**
 * Run the sweep against the process's own database.
 *
 * The client is a parameter on `collectDurablePipelineMetrics` rather than
 * something it reaches for, so the six queries below can be executed against a
 * real test database. Without that seam the only thing that would ever run them
 * is a deployed pod, and "it typechecks" is not evidence that a `groupBy` or a
 * three-table anti-join returns what the gauges claim.
 */
export async function updateDurablePipelineMetrics(): Promise<void> {
  const { prisma } = await import("#src/database/index.ts");
  await collectDurablePipelineMetrics(prisma);
}
