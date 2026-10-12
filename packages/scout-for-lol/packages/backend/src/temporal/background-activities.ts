import type { ScoutBackgroundActivities } from "#src/temporal/durable-activity-surface.ts";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";

/**
 * The pipeline Activities that run on the background queue.
 *
 * What unites them is not a domain but a latency promise. Rendering a report,
 * paging a recovery batch and sweeping the pipeline are all work that must
 * never queue ahead of a live match, so `SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES`
 * assigns every one of them to `background`, the queue Scout's other slow jobs
 * run on.
 *
 * Implementations stay dynamically imported: building the activity groups
 * happens during startup for every role that polls a queue, and a static import
 * chain would pull the report renderer, the Riot client and Prisma into a
 * process that may never run any of this.
 */
export function createScoutBackgroundActivities(): ScoutBackgroundActivities {
  return {
    renderNotificationArtifact: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "rendering-notification-v2" },
        async () => {
          const { renderNotificationArtifact } =
            await import("#src/temporal/notification-lane/notification-render.ts");
          return await renderNotificationArtifact(input);
        },
      ),
    readRecoveryBatch: async (input) =>
      await heartbeatWhile(
        {
          recoveryBatchId: input.recoveryBatchId,
          phase: "reading-recovery-batch-v2",
        },
        async () => {
          const { readRecoveryBatch } =
            await import("#src/temporal/recovery/recovery.ts");
          return await readRecoveryBatch(input);
        },
      ),
    scanRecoveryPage: async (input) =>
      await heartbeatWhile(
        {
          recoveryBatchId: input.recoveryBatchId,
          phase: "scanning-recovery-page-v2",
        },
        async () => {
          const { scanRecoveryPage } =
            await import("#src/temporal/recovery/recovery.ts");
          return await scanRecoveryPage(input);
        },
      ),
    // The only page that spends an authoritative Riot read per item, which is
    // why it heartbeats like the long job it is rather than the short scan it
    // sits beside.
    processRecoveryPage: async (input) =>
      await heartbeatWhile(
        {
          recoveryBatchId: input.recoveryBatchId,
          phase: "processing-recovery-page-v2",
        },
        async () => {
          const { processRecoveryPage } =
            await import("#src/temporal/recovery/recovery.ts");
          return await processRecoveryPage(input);
        },
      ),
    digestRecoveryBatch: async (input) =>
      await heartbeatWhile(
        {
          recoveryBatchId: input.recoveryBatchId,
          phase: "digesting-recovery-batch-v2",
        },
        async () => {
          const { digestRecoveryBatch } =
            await import("#src/temporal/recovery/recovery.ts");
          return await digestRecoveryBatch(input);
        },
      ),
    closeRecoveryBatch: async (input) =>
      await heartbeatWhile(
        {
          recoveryBatchId: input.recoveryBatchId,
          phase: "closing-recovery-batch-v2",
        },
        async () => {
          const { closeRecoveryBatch } =
            await import("#src/temporal/recovery/recovery.ts");
          return await closeRecoveryBatch(input);
        },
      ),
    scanPipelineReconciliationPage: async (input) =>
      await heartbeatWhile(
        { trigger: input.trigger, phase: "scanning-reconciliation-page-v2" },
        async () => {
          const { scanPipelineReconciliationPage } =
            await import("#src/temporal/recovery/reconciliation-scan.ts");
          return await scanPipelineReconciliationPage(input);
        },
      ),
    // The operator's silent post-match backfill: the render and nothing
    // else, for a match the V2 core finished without minting its report.
    backfillSilentPostmatchArtifact: async (input) =>
      await heartbeatWhile(
        {
          riotMatchId: input.riotMatchId,
          phase: "silently-backfilling-postmatch-v2",
        },
        async () => {
          const { backfillSilentPostmatchArtifact } =
            await import("#src/temporal/notification/silent-postmatch-backfill.ts");
          return await backfillSilentPostmatchArtifact(input);
        },
      ),
  };
}
