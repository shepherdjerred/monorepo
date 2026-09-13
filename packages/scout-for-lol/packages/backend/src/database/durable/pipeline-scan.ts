import { z } from "zod";
import {
  NotificationIntentKeySchema,
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
  type NotificationIntentKey,
  type RecoveryBatchId,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  MatchProcessingPolicySchema,
  type ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import type { NotificationIntentState } from "@scout-for-lol/domain/notifications/intent.ts";
import type { RecoveryBatchState } from "@scout-for-lol/domain/recovery/batch.ts";
import type { Db } from "#src/database/index.ts";
import {
  scoutWorkflowStartRowToRecord,
  type ScoutWorkflowStartRecord,
} from "#src/database/durable/workflow-start-row.ts";

/**
 * The reconciliation sweep's reads: what the durable tables say nothing is
 * driving.
 *
 * Every query is bounded by an explicit budget and ordered deterministically,
 * because each row that comes back becomes a child Workflow the sweep starts.
 * An unbounded scan over the observation or receipt tables would grow with the
 * pipeline's whole history rather than with its backlog, and an ambiguously
 * ordered one hands two consecutive sweeps different halves of the same work
 * while claiming both are the front of the queue.
 *
 * The two families that ask "and NOT the other fact" are raw SQL, and that is
 * the point of them. `MatchObservation`, `MatchProcessingReceipt` and
 * `MatchTrackedAccount` are joined by value with no Prisma relation between
 * them — deliberately, so ingestion can record participants before or
 * independently of any other table — so there is no `none:` filter to reach
 * for and the anti-join can only be said in SQL. Fetching a window and
 * filtering it in TypeScript would destroy the one property the caller depends
 * on: a page that came back short has to mean the backlog is short, not that
 * the window happened to be full of finished work.
 *
 * Receipt kinds arrive as arguments rather than being imported. The kinds this
 * sweep asks about belong to the workflows that emit them — `report-lake/` owns
 * the archive and staging vocabulary, the temporal package owns the V2 stage
 * kinds — and a repository that reached into either would stop being callable
 * from a migration script or a fixture without dragging that slice in behind
 * it.
 */

/**
 * Which intent states a notification child can still drive, and why nothing
 * else qualifies.
 *
 * `pending` and `ready` are work not yet attempted. `sending` is an attempt
 * whose worker may have died: only the notification machine can resolve it,
 * and the child's deterministic ID collapses onto whichever execution already
 * owns it. `delivered`, `suppressed`, `expired` and `permission-denied` are
 * settled. `unknown-delivery` is the domain's operator dead end — the request
 * left, the response did not arrive — and starting a child on it is precisely
 * how a user gets told the same thing twice, which is why it carries its own
 * label here rather than being lumped in with the settled states.
 *
 * `temporal/v2/match-reads.ts` spells the same drivable set for its per-match
 * fan-out. The duplication stands because the persistence layer is driven by
 * the application and must not import it; what keeps the two honest is that
 * this table is exhaustive over the domain union, so a state added there fails
 * to compile here until someone decides which column it belongs in.
 */
const INTENT_DRIVABILITY = {
  pending: "drivable",
  ready: "drivable",
  sending: "drivable",
  delivered: "settled",
  suppressed: "settled",
  expired: "settled",
  "permission-denied": "settled",
  "unknown-delivery": "operator-dead-end",
} satisfies Record<
  NotificationIntentState["kind"],
  "drivable" | "settled" | "operator-dead-end"
>;

const DRIVABLE_INTENT_STATES: readonly string[] = Object.entries(
  INTENT_DRIVABILITY,
)
  .filter(([, drivability]) => drivability === "drivable")
  .map(([kind]) => kind);

/**
 * Which batch states still have a run's work left inside them.
 *
 * `complete` and `abandoned` are the two ends of the machine and nothing
 * reopens them. Every other state is a batch whose driver may have died
 * mid-flight, and the row is the only thing that remembers where it got to —
 * the batch input carries no cursor precisely so that this row stays the single
 * source of truth. Exhaustive over the domain union for the same reason as the
 * intent table: a new state has to be classified rather than defaulting into or
 * out of the sweep.
 */
const RECOVERY_BATCH_LIVENESS = {
  planned: "live",
  scanning: "live",
  processing: "live",
  digesting: "live",
  complete: "terminal",
  abandoned: "terminal",
} satisfies Record<RecoveryBatchState["kind"], "live" | "terminal">;

const LIVE_RECOVERY_BATCH_STATES: readonly string[] = Object.entries(
  RECOVERY_BATCH_LIVENESS,
)
  .filter(([, liveness]) => liveness === "live")
  .map(([kind]) => kind);

/**
 * The two observation columns this sweep's first family is keyed by, in the
 * COLUMN vocabulary rather than the domain's.
 *
 * A SQL predicate cannot go through the row codec, which only ever translates a
 * whole row, so the owner's stored spelling is named a second time here;
 * `ownerToColumn` in `observation-row.ts` is the other place it appears and
 * remains the authority. The policy needs no such translation — the domain enum
 * IS the column vocabulary — so it is taken from the schema rather than typed
 * out, which is one fewer string that can drift into matching nothing.
 */
const TEMPORAL_V2_OWNER_COLUMN = "TEMPORAL_V2";
const FULL_POLICY_COLUMN = MatchProcessingPolicySchema.parse("FULL");

/**
 * The one column every anti-join projects. Parsed rather than read off the
 * driver's row object: `$queryRaw` returns whatever the adapter made of the
 * result set, and a match id is about to become part of a Workflow ID.
 *
 * The `LIMIT` in each of those queries is cast explicitly. A bound parameter
 * there reaches Postgres with no inferred type, and `LIMIT` accepts only
 * bigint, so the cast is what keeps the budget a parameter instead of forcing
 * it to be interpolated into the statement text.
 */
const MatchIdRowSchema = z.strictObject({ riotMatchId: RiotMatchIdSchema });

/**
 * Matches the V2 core owns whose pipeline never reached its end.
 *
 * Two facts finish a V2 match and they are checked separately because they fail
 * separately. The `v2-match-observation` stage receipt is what a resumed
 * Workflow reads to know the domain commit stands. The cursor advance has no
 * stage receipt at all — `MatchTrackedAccount.cursorAdvancedAt` is per account
 * and monotonic, so it answers "did this happen" more precisely than one
 * match-wide receipt could (see `match-receipts-v2.ts`) — so the second half of
 * the question has to be asked of that column. A run that committed the
 * observation and died before the cursors moved is exactly the state this
 * family exists to find, and either check alone would miss half of it.
 *
 * Scoped to `temporal-v2` and `FULL`: an `ARCHIVE_ONLY` match has no
 * settlement, notification or cursor phase to be stalled short of, and a match
 * the legacy pipeline owns is v1's to reconcile. Both pipelines are live, and
 * driving a V2 child onto a v1-owned match is how the same match gets processed
 * twice.
 *
 * Ordered oldest-observation first, so the longest-stranded match is driven
 * first, with the id breaking ties so two sweeps over one backlog agree on
 * which page they are looking at. The outer scan rides
 * `MatchObservation(processingPolicy, observedAt)` — equality on the leading
 * column, the ordering on the second — and each anti-join rides its own table's
 * leading key: the receipt unique index on `(riotMatchId, kind, version,
 * scopeKey)` and the tracked-account primary key on `(riotMatchId, puuid)`.
 */
export async function listStalledV2MatchProcessing(
  db: Db,
  args: { observationReceiptKind: ReceiptKind; limit: number },
): Promise<RiotMatchId[]> {
  const rows = await db.$queryRaw`
    SELECT o."riotMatchId" AS "riotMatchId"
      FROM "MatchObservation" AS o
     WHERE o."processingPolicy" = ${FULL_POLICY_COLUMN}
       AND o."pipelineOwner" = ${TEMPORAL_V2_OWNER_COLUMN}
       AND (NOT EXISTS (SELECT 1
                          FROM "MatchProcessingReceipt" AS r
                         WHERE r."riotMatchId" = o."riotMatchId"
                           AND r."kind" = ${args.observationReceiptKind})
            OR NOT EXISTS (SELECT 1
                             FROM "MatchTrackedAccount" AS t
                            WHERE t."riotMatchId" = o."riotMatchId"
                              AND t."cursorAdvancedAt" IS NOT NULL))
     ORDER BY o."observedAt" ASC, o."riotMatchId" ASC
     LIMIT ${args.limit}::int`;
  return z
    .array(MatchIdRowSchema)
    .parse(rows)
    .map((row) => row.riotMatchId);
}

/**
 * Intents stalled short of delivery, the most urgent first.
 *
 * An intent whose freshness deadline has already passed is not stalled, it is
 * STALE, and the difference decides whether a child should exist at all: the
 * machine expires such an intent rather than sending it, so a sweep that
 * started one would be asking for news the user has already had by other means.
 * The deadline is the sort key for the same reason it is the filter — the page
 * should be the work closest to running out of time, not whatever the index
 * happened to hold first.
 *
 * Rides `MatchNotificationIntent(state, freshnessDeadline)`: the drivable
 * states select the index's leading ranges and the deadline both bounds and
 * orders inside them. The intent key breaks ties, because two intents minted
 * for one match share a deadline to the millisecond.
 */
export async function listStalledNotificationIntents(
  db: Db,
  args: { freshAt: Date; limit: number },
): Promise<NotificationIntentKey[]> {
  const rows = await db.matchNotificationIntent.findMany({
    where: {
      state: { in: [...DRIVABLE_INTENT_STATES] },
      freshnessDeadline: { gt: args.freshAt },
    },
    orderBy: [{ freshnessDeadline: "asc" }, { intentKey: "asc" }],
    take: args.limit,
    select: { intentKey: true },
  });
  return rows.map((row) => NotificationIntentKeySchema.parse(row.intentKey));
}

/**
 * Matches whose canonical bytes are archived but whose lake projection never
 * landed.
 *
 * The archive receipt is the precondition rather than the observation row,
 * because the lake is a derived and rebuildable projection of the S3 object:
 * there is something to project exactly when those bytes are known to exist,
 * which is what the archive receipt attests and what a bare observation does
 * not. Both kinds are per ARTIFACT, and this asks only about the match payload;
 * the timeline and prematch projections are separate facts with separate
 * receipts, and a match missing only its timeline staging is not a match whose
 * projection never ran.
 *
 * `GROUP BY` rather than a plain select because receipt identity includes the
 * version and the scope, so one match may legitimately carry more than one
 * `raw-archive-match` row, and a page slot must not be spent twice on the same
 * match. Ordering by the earliest of those recordings puts the
 * longest-unprojected match first.
 *
 * Rides `MatchProcessingReceipt(kind, recordedAt)` for the outer scan and the
 * `(riotMatchId, kind, version, scopeKey)` unique index for the anti-join.
 */
export async function listUnprojectedLakeMatches(
  db: Db,
  args: {
    archiveReceiptKind: ReceiptKind;
    stagingReceiptKind: ReceiptKind;
    limit: number;
  },
): Promise<RiotMatchId[]> {
  const rows = await db.$queryRaw`
    SELECT a."riotMatchId" AS "riotMatchId"
      FROM "MatchProcessingReceipt" AS a
     WHERE a."kind" = ${args.archiveReceiptKind}
       AND NOT EXISTS (SELECT 1
                         FROM "MatchProcessingReceipt" AS s
                        WHERE s."riotMatchId" = a."riotMatchId"
                          AND s."kind" = ${args.stagingReceiptKind})
     GROUP BY a."riotMatchId"
     ORDER BY MIN(a."recordedAt") ASC, a."riotMatchId" ASC
     LIMIT ${args.limit}::int`;
  return z
    .array(MatchIdRowSchema)
    .parse(rows)
    .map((row) => row.riotMatchId);
}

/**
 * Batches that are still somewhere in the middle of their machine.
 *
 * Liveness is the whole predicate: a batch row past `processing` has already
 * lost its counts to the flattening, so there is nothing a second driver could
 * add to it, while a batch short of that point holds the only record of where
 * its scan got to. Oldest first, because a recovery batch that has been sitting
 * in `scanning` since yesterday is the one an operator is waiting on.
 *
 * Rides `MatchRecoveryBatch(state, createdAt)`.
 */
export async function listLiveRecoveryBatches(
  db: Db,
  args: { limit: number },
): Promise<RecoveryBatchId[]> {
  const rows = await db.matchRecoveryBatch.findMany({
    where: { state: { in: [...LIVE_RECOVERY_BATCH_STATES] } },
    orderBy: [{ createdAt: "asc" }, { recoveryBatchId: "asc" }],
    take: args.limit,
    select: { recoveryBatchId: true },
  });
  return rows.map((row) => RecoveryBatchIdSchema.parse(row.recoveryBatchId));
}

/**
 * Starts that were requested and never acknowledged.
 *
 * The request row is written BEFORE the start call, which is the entire reason
 * the table exists: a requester that crashed between the two leaves `acceptedAt`
 * NULL over work Temporal may never have heard about. That is a different
 * failure from every family above, and the only evidence of it — the durable
 * state can show nothing pending at all, because the work never began.
 *
 * Filtered to the caller's workflow types rather than to every unaccepted
 * start. v1's requesters write to this same table, and a stranded v1 request is
 * v1's to recover; adopting one here would start a V2 child for work a v1
 * execution is already keyed to.
 *
 * Rides `ScoutWorkflowStart(workflowType, requestedAt)`, with `acceptedAt IS
 * NULL` as the residual — which is the right way round, since an unacknowledged
 * start is the rare row and the type is the selective one. Rows come back
 * through the row codec, so a payload column that is not even a versioned
 * envelope fails here rather than reaching the caller's decode.
 */
export async function listUnacceptedWorkflowStarts(
  db: Db,
  args: { workflowTypes: readonly string[]; limit: number },
): Promise<ScoutWorkflowStartRecord[]> {
  const rows = await db.scoutWorkflowStart.findMany({
    where: { workflowType: { in: [...args.workflowTypes] }, acceptedAt: null },
    orderBy: [{ requestedAt: "asc" }, { requestedWorkflowId: "asc" }],
    take: args.limit,
  });
  return rows.map((row) => scoutWorkflowStartRowToRecord(row));
}
