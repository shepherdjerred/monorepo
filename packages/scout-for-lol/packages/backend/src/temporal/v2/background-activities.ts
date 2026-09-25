import type { ScoutV2BackgroundActivities } from "#src/temporal/v2/durable-activity-surface.ts";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";

/**
 * The V2 Activities that run on the background queue.
 *
 * What unites them is not a domain but a latency promise. Rendering a report,
 * paging a recovery batch and sweeping the pipeline are all work that must
 * never queue ahead of a live match, so `SCOUT_V2_ACTIVITY_QUEUE_CLASSES`
 * assigns every one of them to `background` — the same queue v1's slow jobs
 * already run on, which is why one worker registration serves both pipelines.
 *
 * Implementations stay dynamically imported: building the activity groups
 * happens during startup for every role that polls a queue, and a static import
 * chain would pull the report renderer, the Riot client and Prisma into a
 * process that may never run any of this.
 */
export function createScoutV2BackgroundActivities(): ScoutV2BackgroundActivities {
  return {
    renderNotificationArtifactV2: async (input) =>
      await heartbeatWhile(
        { intentKey: input.intentKey, phase: "rendering-notification-v2" },
        async () => {
          const { renderNotificationArtifactV2 } =
            await import("#src/temporal/v2/notification-render.ts");
          return await renderNotificationArtifactV2(input);
        },
      ),
    readRecoveryBatchV2: async (input) =>
      await heartbeatWhile(
        {
          recoveryBatchId: input.recoveryBatchId,
          phase: "reading-recovery-batch-v2",
        },
        async () => {
          const { readRecoveryBatchV2 } =
            await import("#src/temporal/v2/recovery.ts");
          return await readRecoveryBatchV2(input);
        },
      ),
    scanRecoveryPageV2: async (input) =>
      await heartbeatWhile(
        {
          recoveryBatchId: input.recoveryBatchId,
          phase: "scanning-recovery-page-v2",
        },
        async () => {
          const { scanRecoveryPageV2 } =
            await import("#src/temporal/v2/recovery.ts");
          return await scanRecoveryPageV2(input);
        },
      ),
    // The only page that spends an authoritative Riot read per item, which is
    // why it heartbeats like the long job it is rather than the short scan it
    // sits beside.
    processRecoveryPageV2: async (input) =>
      await heartbeatWhile(
        {
          recoveryBatchId: input.recoveryBatchId,
          phase: "processing-recovery-page-v2",
        },
        async () => {
          const { processRecoveryPageV2 } =
            await import("#src/temporal/v2/recovery.ts");
          return await processRecoveryPageV2(input);
        },
      ),
    digestRecoveryBatchV2: async (input) =>
      await heartbeatWhile(
        {
          recoveryBatchId: input.recoveryBatchId,
          phase: "digesting-recovery-batch-v2",
        },
        async () => {
          const { digestRecoveryBatchV2 } =
            await import("#src/temporal/v2/recovery.ts");
          return await digestRecoveryBatchV2(input);
        },
      ),
    closeRecoveryBatchV2: async (input) =>
      await heartbeatWhile(
        {
          recoveryBatchId: input.recoveryBatchId,
          phase: "closing-recovery-batch-v2",
        },
        async () => {
          const { closeRecoveryBatchV2 } =
            await import("#src/temporal/v2/recovery.ts");
          return await closeRecoveryBatchV2(input);
        },
      ),
    scanPipelineReconciliationPageV2: async (input) =>
      await heartbeatWhile(
        { trigger: input.trigger, phase: "scanning-reconciliation-page-v2" },
        async () => {
          const { scanPipelineReconciliationPageV2 } =
            await import("#src/temporal/v2/reconciliation-scan.ts");
          return await scanPipelineReconciliationPageV2(input);
        },
      ),
    // The operator's silent post-match backfill: the render and nothing
    // else, for a match the V2 core finished without minting its report.
    backfillSilentPostmatchArtifactV2: async (input) =>
      await heartbeatWhile(
        {
          riotMatchId: input.riotMatchId,
          phase: "silently-backfilling-postmatch-v2",
        },
        async () => {
          const { backfillSilentPostmatchArtifactV2 } =
            await import("#src/temporal/v2/notification/silent-postmatch-backfill.ts");
          return await backfillSilentPostmatchArtifactV2(input);
        },
      ),
  };
}
