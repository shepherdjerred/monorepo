import { z } from "zod";
import {
  MatchDeliveryModeSchema,
  type ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import type {
  NotificationIntentKind,
  NotificationIntentState,
} from "@scout-for-lol/domain/notifications/intent.ts";
import { Prisma } from "#generated/prisma/client/index.js";
import type { Db } from "#src/database/index.ts";
import {
  FULL_POLICY_COLUMN,
  INTENT_NOT_HELD_BY_RECOVERY_POLICY,
  TEMPORAL_V2_OWNER_COLUMN,
} from "#src/database/durable/pipeline-scan.ts";

/**
 * The three silences a 28-hour prod outage fell through, as scrape-time reads.
 *
 * `pipeline-backlog.ts` measures work the pipeline KNOWS it owes: a stalled
 * match, a live batch, an unaccepted start. Each of these asks about work it
 * does not know it owes, which is why none of the existing families saw that
 * outage. V2 match processing completed every phase, minted no post-match
 * intent, and so left nothing behind that any backlog could count — the
 * absence of a row is not a row.
 *
 * - {@link countUnmintedLivePostmatchMatches}: a finished live match that
 *   should have produced a report instruction and did not.
 * - {@link oldestReadyNotificationIntentAt}: an instruction that is ready to
 *   send and is not being sent.
 * - {@link observationLag}: matches are being found, but late.
 *
 * Every read is bounded by a time window or by a state's population and rides
 * an index that already exists; each function names the one it uses.
 */

const READY_STATE: NotificationIntentState["kind"] = "ready";
const POSTMATCH_KIND: NotificationIntentKind = "postmatch";
const LIVE_DELIVERY_COLUMN = MatchDeliveryModeSchema.parse("live");

/**
 * The one row an ungrouped aggregate always returns. Anything else is a
 * broken query rather than an empty table, so it throws instead of defaulting.
 */
function singleRow<T>(schema: z.ZodType<T>, rows: unknown): T {
  const [row] = z.array(schema).length(1).parse(rows);
  if (row === undefined) throw new Error("Aggregate returned no row");
  return row;
}

/**
 * When the longest-waiting `ready` intent was minted, or null when none is.
 *
 * Ordered by `createdAt`, which IS an age — unlike the stalled-notification
 * read, whose head is the intent closest to expiring (see the note on
 * `DURABLE_BACKLOG_FAMILIES`). `ready` is "rendered and nothing has started
 * sending it", so an old one is a sender that is not draining.
 *
 * Intents a recovery batch deliberately holds are excluded by the same
 * predicate the reconciliation sweep uses: they are waiting on an operator by
 * design, and counting them would page on a hold somebody chose.
 *
 * Rides `MatchNotificationIntent(state, freshnessDeadline)` on its leading
 * column. The `MIN` then reads every ready row, so the cost is the ready
 * population — a handful when healthy, and bounded by the outage's size when
 * not.
 */
export async function oldestReadyNotificationIntentAt(
  db: Db,
): Promise<Date | null> {
  const rows: unknown = await db.$queryRaw(Prisma.sql`
    SELECT MIN(i."createdAt") AS "oldest"
      FROM "MatchNotificationIntent" AS i
     WHERE i."state" = ${READY_STATE}
       AND ${INTENT_NOT_HELD_BY_RECOVERY_POLICY}`);
  return singleRow(z.strictObject({ oldest: z.date().nullable() }), rows)
    .oldest;
}

/**
 * Live V2 matches whose core finished without minting a post-match intent.
 *
 * "Finished" is every tracked-account cursor advanced. The Workflow mints the
 * post-match intents immediately BEFORE it advances the cursors (see
 * `match-v2.ts`), so a match whose cursors have all moved has been past the
 * mint, and one with no postmatch intent row either had nowhere to send or
 * minted nothing when it should have. `settledBefore` is a grace on the last
 * advance so a scrape racing the Activity cannot count a match mid-commit.
 *
 * "Should have" is decided without the queue filter, and that is the
 * trade-off that keeps this cheap. The real audience is
 * `resolvePostmatchDeliveryChannels`: unmuted subscriptions for the tracked
 * players that pass their queue filter, and the queue type is only in the raw
 * match JSON. A subscription with `filters IS NULL` passes every queue
 * (`filtersPass(null, …)` is true), so requiring one gives a predicate that
 * never counts a match the real resolver would have skipped. The cost is an
 * under-count: a match whose only subscriptions are queue-filtered is not
 * counted even when it was owed a report. That is the right way round for a
 * rule that pages at one — a systemic mint failure misses unfiltered matches
 * too, and it cannot fire on a correct deployment. The subscription and its
 * account must predate the last cursor advance, so a subscription added later
 * does not retroactively make an old match look owed.
 *
 * Silent-backfill and ARCHIVE_ONLY observations mint nothing by design and are
 * excluded, as is anything another pipeline owns. A match carrying the
 * post-match render receipt is excluded as well: that is what the operator's
 * silent backfill (`silent-postmatch-backfill.ts`) leaves behind, and without
 * it an incident that had been remediated would keep paging until its matches
 * aged out of the window. A match needs NEITHER fact to count: the backfill
 * deliberately mints no intent, so the receipt is its only trace.
 *
 * The window bounds the scan to observations since `observedSince`, riding
 * `MatchObservation(processingPolicy, observedAt)`. The residuals ride
 * `MatchTrackedAccount`'s primary key, `MatchNotificationIntent(riotMatchId)`,
 * the receipt unique index, and `Account(puuid)`. `Subscription` has no
 * `playerId` index; it is a small per-guild configuration table and the same
 * lookup already runs unindexed on every v1 and V2 delivery, so this adds no
 * new access pattern worth an index.
 */
export async function countUnmintedLivePostmatchMatches(
  db: Db,
  args: {
    renderReceiptKind: ReceiptKind;
    observedSince: Date;
    settledBefore: Date;
  },
): Promise<number> {
  const rows: unknown = await db.$queryRaw(Prisma.sql`
    SELECT COUNT(*)::int AS "count"
      FROM (SELECT o."riotMatchId" AS "riotMatchId",
                   MAX(t."cursorAdvancedAt") AS "completedAt"
              FROM "MatchObservation" AS o
              JOIN "MatchTrackedAccount" AS t
                ON t."riotMatchId" = o."riotMatchId"
             WHERE o."processingPolicy" = ${FULL_POLICY_COLUMN}
               AND o."observedAt" > ${args.observedSince}::timestamp
               AND o."pipelineOwner" = ${TEMPORAL_V2_OWNER_COLUMN}
               AND o."deliveryMode" = ${LIVE_DELIVERY_COLUMN}
               AND NOT EXISTS (SELECT 1
                                 FROM "MatchNotificationIntent" AS i
                                WHERE i."riotMatchId" = o."riotMatchId"
                                  AND i."kind" = ${POSTMATCH_KIND})
               AND NOT EXISTS (SELECT 1
                                 FROM "MatchProcessingReceipt" AS r
                                WHERE r."riotMatchId" = o."riotMatchId"
                                  AND r."kind" = ${args.renderReceiptKind})
             GROUP BY o."riotMatchId"
            HAVING COUNT(*) = COUNT(t."cursorAdvancedAt")
               AND MAX(t."cursorAdvancedAt") <= ${args.settledBefore}::timestamp) AS m
     WHERE EXISTS (SELECT 1
                     FROM "MatchTrackedAccount" AS ta
                     JOIN "Account" AS a ON a."puuid" = ta."puuid"
                     JOIN "Subscription" AS s ON s."playerId" = a."playerId"
                    WHERE ta."riotMatchId" = m."riotMatchId"
                      AND s."isMuted" = false
                      AND s."filters" IS NULL
                      AND a."createdTime" <= m."completedAt"
                      AND s."createdTime" <= m."completedAt")`);
  return singleRow(z.strictObject({ count: z.number().int() }), rows).count;
}

export type ObservationLag = {
  /** Observations in the window; zero means the statistics below are zero by definition, not measured. */
  readonly observations: number;
  readonly p90Seconds: number;
  readonly maxSeconds: number;
};

/**
 * How late recent live matches were observed, measured from game START.
 *
 * The observation row stores `gameCreatedAt` and not the game's end, so this
 * lag includes the game's own length (p90 about 39 minutes on beta). A
 * threshold has to be read with that in mind: healthy p90 here is roughly the
 * game length plus a few minutes of discovery.
 *
 * Only FULL, `live` observations: a silent backfill is late on purpose, and
 * ARCHIVE_ONLY observations are never reported, so neither says anything about
 * whether reports are late. Owner is not filtered, because discovery lag is a
 * property of discovery, whichever pipeline then processes the match.
 *
 * An empty window reads zero. That cannot distinguish "no games" from "no
 * discovery at all", and this gauge does not try to: a quiet night is normal,
 * so zero observations is not by itself alertable. Discovery that has stopped
 * outright is therefore NOT covered here; it reads as a quiet window.
 *
 * Rides `MatchObservation(processingPolicy, observedAt)`, bounded to
 * `observedSince`.
 */
export async function observationLag(
  db: Db,
  args: { observedSince: Date },
): Promise<ObservationLag> {
  const rows: unknown = await db.$queryRaw(Prisma.sql`
    SELECT COUNT(*)::int AS "observations",
           COALESCE(percentile_cont(0.9) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (o."observedAt" - o."gameCreatedAt"))), 0)::float8 AS "p90Seconds",
           COALESCE(MAX(EXTRACT(EPOCH FROM (o."observedAt" - o."gameCreatedAt"))), 0)::float8 AS "maxSeconds"
      FROM "MatchObservation" AS o
     WHERE o."processingPolicy" = ${FULL_POLICY_COLUMN}
       AND o."observedAt" > ${args.observedSince}::timestamp
       AND o."deliveryMode" = ${LIVE_DELIVERY_COLUMN}`);
  const row = singleRow(
    z.strictObject({
      observations: z.number().int(),
      p90Seconds: z.number(),
      maxSeconds: z.number(),
    }),
    rows,
  );
  return {
    observations: row.observations,
    // A clock-skewed row can observe "before" creation; an age is never negative.
    p90Seconds: Math.max(0, row.p90Seconds),
    maxSeconds: Math.max(0, row.maxSeconds),
  };
}
