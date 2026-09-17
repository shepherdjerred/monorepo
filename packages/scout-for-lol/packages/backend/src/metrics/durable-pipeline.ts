import { Counter, Gauge } from "prom-client";
import { SCOUT_V2_MATCH_RECEIPT_KINDS } from "@scout-for-lol/temporal/match-receipts-v2";
import { SCOUT_V2_WORKFLOW_NAMES } from "@scout-for-lol/temporal/identifiers";
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
export async function updateDurablePipelineMetrics(): Promise<void> {
  try {
    const { prisma } = await import("#src/database/index.ts");
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
        countNotificationIntentsByState(prisma),
        countRecoveryBatchesByState(prisma),
        oldestStalledMatchProcessingAt(prisma, {
          observationReceiptKind: SCOUT_V2_MATCH_RECEIPT_KINDS.observation,
        }),
        oldestLiveRecoveryBatchAt(prisma),
        oldestUnacceptedWorkflowStartAt(prisma, {
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
