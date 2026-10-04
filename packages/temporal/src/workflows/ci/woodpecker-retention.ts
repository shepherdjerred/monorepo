import { proxyActivities } from "@temporalio/workflow";
import type { WoodpeckerRetentionActivities } from "#activities/maintenance/woodpecker-retention.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  RETENTION_BATCH_LIMIT,
  RETENTION_RUN_LIMIT,
  RetentionRunInputSchema,
  type RetentionRunInput,
  type RetentionRunResult,
  type RetentionCursor,
} from "#shared/woodpecker-retention.ts";

const activities = proxyActivities<WoodpeckerRetentionActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "20 minutes",
  scheduleToCloseTimeout: "65 minutes",
  heartbeatTimeout: "90 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30 seconds",
    maximumInterval: "2 minutes",
  },
});

export async function runWoodpeckerLogRetention(
  input: RetentionRunInput = {},
): Promise<RetentionRunResult> {
  const parsed = RetentionRunInputSchema.parse(input);
  const initial = await activities.initializeWoodpeckerRetention(
    parsed.resumeScheduled,
  );
  const result: RetentionRunResult = {
    manifest: parsed.reviewedPlan ?? { cutoff: initial.cutoff, candidates: [] },
    receipts: [],
    continuation: null,
    scanned: 0,
    protectAllMain: false,
    protectionReasons: [],
    dryRun: parsed.dryRun || !initial.enabled,
  };
  if (parsed.reviewedPlan === undefined) {
    let cursor: RetentionCursor | null = initial.cursor;
    while (cursor !== null && result.scanned < RETENTION_RUN_LIMIT) {
      const batch: Awaited<
        ReturnType<
          WoodpeckerRetentionActivities["planWoodpeckerRetentionBatch"]
        >
      > = await activities.planWoodpeckerRetentionBatch({
        repos: initial.repos,
        cursor,
        cutoff: initial.cutoff,
        remaining: RETENTION_RUN_LIMIT - result.scanned,
      });
      result.scanned += batch.scanned;
      result.manifest.candidates.push(...batch.candidates);
      result.protectAllMain ||= batch.protectAllMain;
      result.protectionReasons = [
        ...new Set([...result.protectionReasons, ...batch.protectionReasons]),
      ].slice(0, 100);
      cursor = batch.cursor;
    }
    result.continuation =
      cursor === null
        ? null
        : { repos: initial.repos, cursor, cutoff: initial.cutoff };
  }
  for (
    let offset = 0;
    offset < result.manifest.candidates.length;
    offset += RETENTION_BATCH_LIMIT
  ) {
    result.receipts.push(
      ...(await activities.applyWoodpeckerRetentionBatch({
        candidates: result.manifest.candidates.slice(
          offset,
          offset + RETENTION_BATCH_LIMIT,
        ),
        cutoff: result.manifest.cutoff,
        dryRun: result.dryRun,
      })),
    );
  }
  return result;
}
