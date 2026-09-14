import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { SCOUT_V2_MATCH_RECEIPT_KINDS } from "@scout-for-lol/temporal/match-receipts-v2";
import { SCOUT_V2_WORKFLOW_NAMES } from "@scout-for-lol/temporal/identifiers";
import { prisma } from "#src/database/index.ts";
import {
  getMatchPipelineState,
  type MatchPipelineState,
} from "#src/database/durable/match-pipeline-state.ts";
import {
  listLiveRecoveryBatches,
  listStalledNotificationIntents,
  listStalledV2MatchProcessing,
  listUnacceptedWorkflowStarts,
  listUnknownDeliveryIntents,
  listUnprojectedLakeMatches,
} from "#src/database/durable/pipeline-scan.ts";
import {
  lakeStagingReceiptKind,
  rawArchiveReceiptKind,
} from "#src/report-lake/durable-receipts.ts";

/**
 * What the operations console reads.
 *
 * These are the same durable reads the reconciliation sweep runs, assembled
 * for a human instead of for a fan-out — with one deliberate difference in the
 * workflow-start family. The sweep asks only about the start types it can
 * re-drive; an operator needs to see every V2 start that was requested and
 * never accepted, INCLUDING pipeline reconciliation, which the sweep refuses to
 * fold precisely because nothing may re-drive it automatically. A queue nobody
 * sweeps is exactly the queue an operator has to be shown.
 *
 * Every read is bounded by the caller's budget and deterministically ordered,
 * so a short page means a short backlog rather than a full window of finished
 * work.
 */

/** The page size any one queue may return to the console. */
export const OPERATIONS_QUEUE_MAX = 50;

export type OperationsQueues = Awaited<ReturnType<typeof readOperationsQueues>>;

export async function readOperationsQueues(args: {
  limit: number;
  now: Date;
}): Promise<{
  stalledMatchProcessing: readonly RiotMatchId[];
  stalledNotifications: readonly string[];
  unknownDeliveries: readonly {
    intentKey: string;
    matchId: string;
    attemptCount: number;
    state: string;
  }[];
  unprojectedMatches: readonly RiotMatchId[];
  liveRecoveryBatches: readonly string[];
  unacceptedWorkflowStarts: readonly {
    requestedWorkflowId: string;
    workflowType: string;
    requestedAt: string;
    requestSource: string;
  }[];
}> {
  const [
    stalledMatchProcessing,
    stalledNotifications,
    unknownDeliveries,
    unprojectedMatches,
    liveRecoveryBatches,
    unacceptedStarts,
  ] = await Promise.all([
    listStalledV2MatchProcessing(prisma, {
      observationReceiptKind: SCOUT_V2_MATCH_RECEIPT_KINDS.observation,
      limit: args.limit,
    }),
    listStalledNotificationIntents(prisma, {
      freshAt: args.now,
      limit: args.limit,
    }),
    listUnknownDeliveryIntents(prisma, { limit: args.limit }),
    listUnprojectedLakeMatches(prisma, {
      archiveReceiptKind: rawArchiveReceiptKind("match"),
      stagingReceiptKind: lakeStagingReceiptKind("match"),
      limit: args.limit,
    }),
    listLiveRecoveryBatches(prisma, { limit: args.limit }),
    listUnacceptedWorkflowStarts(prisma, {
      workflowTypes: SCOUT_V2_WORKFLOW_NAMES,
      limit: args.limit,
    }),
  ]);

  return {
    stalledMatchProcessing,
    stalledNotifications,
    unknownDeliveries: unknownDeliveries.map((record) => ({
      intentKey: record.intent.key,
      matchId: record.matchId,
      attemptCount: record.intent.attemptCount,
      state: record.intent.state.kind,
    })),
    unprojectedMatches,
    liveRecoveryBatches: liveRecoveryBatches.map((id) => id),
    unacceptedWorkflowStarts: unacceptedStarts.map((start) => ({
      requestedWorkflowId: start.requestedWorkflowId,
      workflowType: start.workflowType,
      requestedAt: start.requestedAt,
      requestSource: start.requestSource,
    })),
  };
}

/**
 * One match's whole durable picture, or `null` when nothing has observed it.
 *
 * Absence here is a genuine not-found rather than an empty view: a match with
 * no observation is a match this pipeline has never seen, and there is no
 * state for an operator to act on.
 */
export async function readMatchPipeline(args: {
  matchId: RiotMatchId;
}): Promise<MatchPipelineState | null> {
  return await getMatchPipelineState(prisma, args);
}
