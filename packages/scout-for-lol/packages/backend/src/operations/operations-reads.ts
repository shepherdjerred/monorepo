import {
  WorkflowStartRequestIdSchema,
  type RiotMatchId,
  type WorkflowStartRequestId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { NotificationIntentState } from "@scout-for-lol/domain/notifications/intent.ts";
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
  type ScanPosition,
} from "#src/database/durable/pipeline-scan.ts";
import {
  decodeKeyedQueueCursor,
  decodeQueueCursor,
  encodeQueueCursor,
  splitOverFetchedPage,
} from "#src/operations/queue-cursor.ts";
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
 * A queue item must be SUFFICIENT to act on. Each row an operator can answer
 * carries every field the corresponding intent payload structurally requires,
 * so an operator holding only this API can construct a valid confirmation
 * without reaching into the database for a value the queue saw and discarded.
 * The unknown-delivery row's `attemptNonce` is the case that bites: the
 * resolution names the attempt it answers, so a queue that omitted it would be
 * listing work this API could not then perform.
 *
 * A queue must also be REACHABLE past its first page. Every read is bounded, so
 * without a cursor the rows beyond the cap are invisible and the visible count
 * reads as the whole backlog — an operator hunting one intent would conclude it
 * does not exist. Each queue therefore reports `hasMore` and a keyset cursor
 * under `pages`, and the cap itself stays where it is: the fix for a bounded
 * read is paging through it, not raising the bound until the next backlog
 * outgrows that one too.
 *
 * `pages` is a SIBLING of the queues rather than a wrapper around each, so
 * every existing queue key still holds the array it always held.
 */

/** The page size any one queue may return to the console. */
export const OPERATIONS_QUEUE_MAX = 50;

export const OPERATIONS_QUEUE_NAMES = [
  "stalledMatchProcessing",
  "stalledNotifications",
  "unknownDeliveries",
  "unprojectedMatches",
  "liveRecoveryBatches",
  "unacceptedWorkflowStarts",
] as const;
export type OperationsQueueName = (typeof OPERATIONS_QUEUE_NAMES)[number];

/**
 * Whether more rows follow, and where to resume.
 *
 * `cursor` is `null` exactly when `hasMore` is false. Handing back a cursor for
 * a queue with nothing after it invites a request whose only possible answer is
 * an empty page, which a caller cannot tell apart from a queue that drained
 * between two reads.
 */
export type OperationsQueuePage = {
  readonly hasMore: boolean;
  readonly cursor: string | null;
};

export type OperationsQueueCursors = Partial<
  Record<OperationsQueueName, string>
>;

function pageOf<T, Id extends string>(
  rows: readonly T[],
  limit: number,
  positionOf: (row: T) => ScanPosition<Id>,
): { items: readonly T[]; page: OperationsQueuePage } {
  const { items, hasMore } = splitOverFetchedPage(rows, limit);
  const last = items.at(-1);
  return {
    items,
    page: {
      hasMore,
      cursor:
        hasMore && last !== undefined
          ? encodeQueueCursor(positionOf(last))
          : null,
    },
  };
}

/**
 * The instant an ambiguous attempt was observed.
 *
 * The read filters to `unknown-delivery`, so any other state is a broken
 * repository contract rather than a row to skip past.
 */
function unknownDeliveryState(
  state: NotificationIntentState,
  intentKey: string,
): Extract<NotificationIntentState, { kind: "unknown-delivery" }> {
  if (state.kind !== "unknown-delivery") {
    throw new Error(
      `listUnknownDeliveryIntents returned ${intentKey} in state ${state.kind}`,
    );
  }
  return state;
}

export async function readOperationsQueues(args: {
  limit: number;
  now: Date;
  after?: OperationsQueueCursors | undefined;
}): Promise<{
  stalledMatchProcessing: readonly RiotMatchId[];
  stalledNotifications: readonly {
    intentKey: string;
    matchId: string;
    state: string;
    freshnessDeadline: string;
    attemptCount: number;
  }[];
  unknownDeliveries: readonly {
    intentKey: string;
    matchId: string;
    attemptCount: number;
    attemptNonce: string;
    state: string;
  }[];
  unprojectedMatches: readonly RiotMatchId[];
  liveRecoveryBatches: readonly string[];
  unacceptedWorkflowStarts: readonly {
    requestId: WorkflowStartRequestId;
    requestedWorkflowId: string;
    workflowType: string;
    requestedAt: string;
    requestSource: string;
  }[];
  pages: Record<OperationsQueueName, OperationsQueuePage>;
}> {
  const after = args.after ?? {};
  // One more row than the caller asked for, so `hasMore` is observed rather
  // than inferred from a page that happened to come back exactly full.
  const limit = args.limit + 1;
  const cursorFor = (name: OperationsQueueName): ScanPosition | undefined => {
    const token = after[name];
    return token === undefined ? undefined : decodeQueueCursor(token);
  };
  // The workflow-start queue breaks ties on the REQUEST key, and its read's
  // position type says so; a token carrying a workflow id instead is refused
  // by the brand rather than compared against the wrong column.
  const startsCursor = after.unacceptedWorkflowStarts;
  const startsAfter =
    startsCursor === undefined
      ? undefined
      : decodeKeyedQueueCursor(startsCursor, (id) =>
          WorkflowStartRequestIdSchema.parse(id),
        );

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
      // The operator surface is where a contested match must be visible.
      contested: { kind: "include" },
      limit,
      after: cursorFor("stalledMatchProcessing"),
    }),
    listStalledNotificationIntents(prisma, {
      freshAt: args.now,
      // The operator surface is where an intent the result overtook must be
      // visible: the sweep will never drive it again, so this queue is the
      // only place a person can learn it is sitting there.
      overtakenByResult: "include",
      limit,
      after: cursorFor("stalledNotifications"),
    }),
    listUnknownDeliveryIntents(prisma, {
      limit,
      after: cursorFor("unknownDeliveries"),
    }),
    listUnprojectedLakeMatches(prisma, {
      archiveReceiptKind: rawArchiveReceiptKind("match"),
      stagingReceiptKind: lakeStagingReceiptKind("match"),
      limit,
      after: cursorFor("unprojectedMatches"),
    }),
    listLiveRecoveryBatches(prisma, {
      limit,
      after: cursorFor("liveRecoveryBatches"),
    }),
    listUnacceptedWorkflowStarts(prisma, {
      workflowTypes: SCOUT_V2_WORKFLOW_NAMES,
      limit,
      after: startsAfter,
    }),
  ]);

  const stalled = pageOf(stalledMatchProcessing, args.limit, (row) => ({
    at: row.observedAt,
    id: row.riotMatchId,
  }));
  const notifications = pageOf(stalledNotifications, args.limit, (record) => ({
    at: new Date(record.intent.freshnessDeadline),
    id: record.intent.key,
  }));
  const unknown = pageOf(unknownDeliveries, args.limit, (record) => ({
    at: new Date(
      unknownDeliveryState(record.intent.state, record.intent.key).observedAt,
    ),
    id: record.intent.key,
  }));
  const unprojected = pageOf(unprojectedMatches, args.limit, (row) => ({
    at: row.archivedAt,
    id: row.riotMatchId,
  }));
  const recovery = pageOf(liveRecoveryBatches, args.limit, (row) => ({
    at: row.createdAt,
    id: row.recoveryBatchId,
  }));
  const starts = pageOf(unacceptedStarts, args.limit, (record) => ({
    at: new Date(record.requestedAt),
    // The read orders ties by request key, so the cursor must carry it: a
    // workflow id here would be compared against request keys on the next
    // page and skip every row sharing the boundary millisecond.
    id: record.requestId,
  }));

  return {
    stalledMatchProcessing: stalled.items.map((row) => row.riotMatchId),
    // `state` and `freshnessDeadline` travel with the row because together they
    // decide which actions can succeed on it: a `sending` intent cannot be
    // re-driven, and a still-fresh one cannot be suppressed. A bare key would
    // have the console offering actions whose only outcome is a refusal. The
    // deadline is carried even though this read's own filter guarantees it is
    // in the future — with it, the ROW proves the suppress rule, instead of the
    // console depending on a query it does not own and cannot see change.
    stalledNotifications: notifications.items.map((record) => ({
      intentKey: record.intent.key,
      matchId: record.matchId,
      state: record.intent.state.kind,
      freshnessDeadline: record.intent.freshnessDeadline,
      attemptCount: record.intent.attemptCount,
    })),
    unknownDeliveries: unknown.items.map((record) => ({
      intentKey: record.intent.key,
      matchId: record.matchId,
      attemptCount: record.intent.attemptCount,
      // The nonce is not decoration: `ops_resolve_unknown_delivery` REQUIRES
      // the exact nonce of the attempt being answered, and the domain refuses
      // a mismatch as `stale-operator-view`.
      attemptNonce: unknownDeliveryState(record.intent.state, record.intent.key)
        .attemptNonce,
      state: record.intent.state.kind,
    })),
    unprojectedMatches: unprojected.items.map((row) => row.riotMatchId),
    liveRecoveryBatches: recovery.items.map((row) => row.recoveryBatchId),
    unacceptedWorkflowStarts: starts.items.map((start) => ({
      requestId: start.requestId,
      requestedWorkflowId: start.requestedWorkflowId,
      workflowType: start.workflowType,
      requestedAt: start.requestedAt,
      requestSource: start.requestSource,
    })),
    pages: {
      stalledMatchProcessing: stalled.page,
      stalledNotifications: notifications.page,
      unknownDeliveries: unknown.page,
      unprojectedMatches: unprojected.page,
      liveRecoveryBatches: recovery.page,
      unacceptedWorkflowStarts: starts.page,
    },
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
