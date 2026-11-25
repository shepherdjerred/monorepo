import { continueAsNew, proxyActivities } from "@temporalio/workflow";
import type {
  LlmArchiveIndexActivities,
  SyncLlmArchiveIndexCursor,
  SyncLlmArchiveIndexResult,
} from "#activities/ops/llm-archive/llm-archive-index.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export const MAX_LLM_ARCHIVE_CHUNKS_PER_EXECUTION = 5;

export type LlmArchiveIndexWorkflowInput = {
  lookbackDays?: number | undefined;
  maxObjectsPerRun?: number | undefined;
  cursor?: SyncLlmArchiveIndexCursor | undefined;
  accumulated?:
    | {
        scannedObjects: number;
        upsertedSpans: number;
        prunedSpans: number;
      }
    | undefined;
};

const { syncLlmArchiveIndex } = proxyActivities<LlmArchiveIndexActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
  },
});

export async function runLlmArchiveIndex(
  input: LlmArchiveIndexWorkflowInput = {},
): Promise<SyncLlmArchiveIndexResult> {
  let scannedObjects = input.accumulated?.scannedObjects ?? 0;
  let upsertedSpans = input.accumulated?.upsertedSpans ?? 0;
  let prunedSpans = input.accumulated?.prunedSpans ?? 0;
  let cursor = input.cursor;

  for (
    let chunk = 0;
    chunk < MAX_LLM_ARCHIVE_CHUNKS_PER_EXECUTION;
    chunk += 1
  ) {
    const result = await syncLlmArchiveIndex({
      ...(input.lookbackDays === undefined
        ? {}
        : { lookbackDays: input.lookbackDays }),
      ...(input.maxObjectsPerRun === undefined
        ? {}
        : { maxObjectsPerRun: input.maxObjectsPerRun }),
      ...(cursor === undefined ? {} : { cursor }),
    });

    scannedObjects += result.scannedObjects;
    upsertedSpans += result.upsertedSpans;
    prunedSpans += result.prunedSpans;

    if (!result.hasMore) {
      return {
        scannedObjects,
        upsertedSpans,
        prunedSpans,
        hasMore: false,
      };
    }

    cursor = result.nextCursor;
  }

  return await continueAsNew<typeof runLlmArchiveIndex>({
    ...(input.lookbackDays === undefined
      ? {}
      : { lookbackDays: input.lookbackDays }),
    ...(input.maxObjectsPerRun === undefined
      ? {}
      : { maxObjectsPerRun: input.maxObjectsPerRun }),
    ...(cursor === undefined ? {} : { cursor }),
    accumulated: {
      scannedObjects,
      upsertedSpans,
      prunedSpans,
    },
  });
}
