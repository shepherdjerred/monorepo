import { z } from "zod";
import {
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
  type RecoveryBatchId,
  type WorkflowStartRequestId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  MatchProcessingPolicySchema,
  type ReceiptKind,
} from "@scout-for-lol/domain/match-processing/states.ts";
import type {
  NotificationIntentKind,
  NotificationIntentState,
  NotificationTargetKind,
} from "@scout-for-lol/domain/notifications/intent.ts";
import type {
  RecoveryBatchState,
  RecoveryPolicy,
} from "@scout-for-lol/domain/recovery/batch.ts";
import { Prisma } from "#generated/prisma/client/index.js";
import type { Db } from "#src/database/index.ts";
import type { ScoutWorkflowStartRecord } from "@scout-for-lol/domain/recovery/workflow-start.ts";
import { scoutWorkflowStartRowToRecord } from "#src/database/durable/workflow-start-row.ts";
import {
  matchNotificationIntentRowToRecord,
  type MatchNotificationIntentRecord,
} from "#src/database/durable/intent-row.ts";

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
 * The families that ask "and NOT the other fact" are raw SQL, and that is the
 * point of them. `MatchObservation`, `MatchProcessingReceipt`,
 * `MatchTrackedAccount` and `MatchNotificationIntent` are joined by value with
 * no Prisma relation between them — deliberately, so ingestion can record
 * participants before or independently of any other table — so there is no
 * `none:` filter to reach for and the anti-join can only be said in SQL.
 * Fetching a window and filtering it in TypeScript would destroy the one
 * property the caller depends on: a page that came back short has to mean the
 * backlog is short, not that the window happened to be full of finished work.
 *
 * Receipt kinds arrive as arguments rather than being imported. The kinds this
 * sweep asks about belong to the workflows that emit them — `report-lake/` owns
 * the archive and staging vocabulary, the temporal package owns the V2 stage
 * kinds — and a repository that reached into either would stop being callable
 * from a migration script or a fixture without dragging that slice in behind
 * it.
 */

/**
 * What starting a notification child on an intent in this state actually DOES.
 *
 * The table classifies the OPERATION rather than mere eligibility, because two
 * of the drivable states drive in opposite directions and a reader who knows
 * only that both are "drivable" will reason wrongly about both:
 *
 * - `sends-the-message` — `pending` and `ready` are work not yet attempted, and
 *   driving one puts a message in front of a user.
 * - `resolves-a-prior-send` — `sending` is an attempt whose worker may have
 *   died. Driving it sends NOTHING: `beginSend` answers `already-sending`, and
 *   the child instead runs the unobserved-send recovery that moves the row to
 *   `unknown-delivery`, where a person can resolve it against the exact attempt
 *   nonce. It is the only route out of that ambiguity, so a filter that stops
 *   driving it strands the row permanently rather than delaying it.
 * - `settled` — `delivered`, `suppressed`, `expired` and `permission-denied`.
 * - `operator-dead-end` — `unknown-delivery`, where the request left and the
 *   response did not arrive. Starting a child on it is precisely how a user
 *   gets told the same thing twice, which is why it carries its own label
 *   rather than being lumped in with the settled states.
 *
 * Every set below is derived from this one table, so a state added to the
 * domain union cannot reach production until someone says what driving it
 * would do — which is the question that decides membership of all of them.
 *
 * `temporal/v2/match-reads.ts` spells the same drivable set for its per-match
 * fan-out. The duplication stands because the persistence layer is driven by
 * the application and must not import it; what keeps the two honest is that
 * this table is exhaustive over the domain union, so a state added there fails
 * to compile here until someone decides which row it belongs in.
 */
type IntentDriveEffect =
  | "sends-the-message"
  | "resolves-a-prior-send"
  | "settled"
  | "operator-dead-end";

const INTENT_DRIVABILITY = {
  pending: "sends-the-message",
  ready: "sends-the-message",
  sending: "resolves-a-prior-send",
  delivered: "settled",
  suppressed: "settled",
  expired: "settled",
  "permission-denied": "settled",
  "unknown-delivery": "operator-dead-end",
} satisfies Record<NotificationIntentState["kind"], IntentDriveEffect>;

/** The states whose drive does something rather than nothing. */
const DRIVING_EFFECTS: ReadonlySet<IntentDriveEffect> =
  new Set<IntentDriveEffect>(["sends-the-message", "resolves-a-prior-send"]);

function intentStatesWhere(
  matches: (effect: IntentDriveEffect) => boolean,
): readonly string[] {
  return Object.entries(INTENT_DRIVABILITY)
    .filter(([, effect]) => matches(effect))
    .map(([kind]) => kind);
}

const DRIVABLE_INTENT_STATES: readonly string[] = intentStatesWhere((effect) =>
  DRIVING_EFFECTS.has(effect),
);

/**
 * The drivable states whose drive puts a message in front of a user.
 *
 * This, and not the drivable set, is what a truth window can apply to. See
 * {@link listStalledNotificationIntents}.
 */
const MESSAGE_SENDING_INTENT_STATES: readonly string[] = intentStatesWhere(
  (effect) => effect === "sends-the-message",
);

const OPERATOR_DEAD_END_INTENT_STATES: readonly string[] = intentStatesWhere(
  (effect) => effect === "operator-dead-end",
);

/**
 * Every intent state, for the gauge that reports one series per state.
 *
 * Read off the classification table rather than typed out a second time, so
 * the exhaustiveness the `satisfies` above already enforces carries to the
 * metric: a state added to the domain union cannot reach production without a
 * series, and no series can exist for a state the domain does not have. A
 * gauge that quietly stopped covering a state would read as that state being
 * empty, which is the one answer an operator must never be handed by accident.
 */
export const NOTIFICATION_INTENT_STATE_KINDS: readonly string[] =
  Object.keys(INTENT_DRIVABILITY);

/**
 * Which intent kinds say something that the match's own result overtakes.
 *
 * `prematch` announces a game STARTING. It is the only kind whose message
 * stops being true the moment the result is known, and the freshness deadline
 * does not express that: the deadline is the game's own three-hour TTL, so a
 * prematch row a failed prematch child left `pending` is still comfortably
 * inside it forty minutes later — it would pass `beginSend`, render from the
 * archived spectator snapshot, and post "game starting" after the score was
 * already public.
 *
 * The other three are `after-result` and must keep being driven, which is why
 * this is a per-KIND table rather than a postmatch-only filter. `settlement`
 * and `dare-summary` are minted INSIDE the fenced settlement effect, so they
 * exist only once the result is known; a filter that kept just `postmatch`
 * would strand exactly the rows that effect has already committed.
 *
 * Exhaustive over the domain union for the same reason as
 * {@link INTENT_DRIVABILITY}: a fifth kind has to be classified here before
 * this file compiles, rather than defaulting into or out of the sweep.
 */
const INTENT_TRUTH_WINDOW = {
  prematch: "before-result",
  postmatch: "after-result",
  settlement: "after-result",
  "dare-summary": "after-result",
} satisfies Record<NotificationIntentKind, "before-result" | "after-result">;

const BEFORE_RESULT_INTENT_KINDS: readonly string[] = Object.entries(
  INTENT_TRUTH_WINDOW,
)
  .filter(([, window]) => window === "before-result")
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

/** Every batch state, for the same reason as `NOTIFICATION_INTENT_STATE_KINDS`. */
export const RECOVERY_BATCH_STATE_KINDS: readonly string[] = Object.keys(
  RECOVERY_BATCH_LIVENESS,
);

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
 * The recovery policies and target kind the stalled-notification read holds
 * on, in column vocabulary — which for both is the domain enum's own
 * spelling, taken from the schemas so a renamed value fails here.
 */
const HELD_EVERYTHING_POLICY: RecoveryPolicy = "no-external";
const HELD_CHANNELS_POLICY: RecoveryPolicy = "stale-private-only";
const CHANNEL_TARGET_COLUMN: NotificationTargetKind = "channel";

/**
 * Where a page stopped, in the vocabulary every read here already orders by.
 *
 * All six queues sort by a timestamp and break ties on an id, so one shape
 * describes a position in any of them. Paging is KEYSET rather than offset
 * because these queues drain while they are read: an offset would skip rows as
 * earlier ones were resolved, and a skipped row in an operator queue is work
 * nobody is told about.
 *
 * `after` is optional on every read, and absent means "from the front". The
 * reconciliation sweep never pages — it always wants the front — so its
 * queries keep exactly the shape and plan they had, with the keyset predicate
 * composed in only when a caller actually supplies a cursor.
 *
 * `Id` names WHICH key breaks the tie, because the queues do not all break it
 * on the same one: five are keyed by the row's natural id, and the
 * workflow-start queue by the request key — a workflow id can name many
 * requests, and only the request key orders them. A read whose tie-break is a
 * branded key takes a branded position, so a caller cannot hand it the other
 * column and have the comparison quietly skip every row past the boundary.
 */
export type ScanPosition<Id extends string = string> = {
  readonly at: Date;
  readonly id: Id;
};

/**
 * Each queue returns the value it is ORDERED by alongside the id.
 *
 * Without it a caller cannot build the next page's cursor, and an operator
 * cannot tell a match stranded for a minute from one stranded since Tuesday.
 * The reads already sort on these values; returning them is exposing evidence
 * the query held rather than computing anything new.
 */
export type StalledMatchProcessingRow = z.infer<
  typeof StalledMatchProcessingRowSchema
>;
const StalledMatchProcessingRowSchema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
  observedAt: z.date(),
});

export type UnprojectedLakeMatchRow = z.infer<
  typeof UnprojectedLakeMatchRowSchema
>;
const UnprojectedLakeMatchRowSchema = z.strictObject({
  riotMatchId: RiotMatchIdSchema,
  archivedAt: z.date(),
});

export type LiveRecoveryBatchRow = {
  readonly recoveryBatchId: RecoveryBatchId;
  readonly createdAt: Date;
};

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
 * The cursor half asks whether ANY association is still unadvanced, and the
 * quantifier is the whole point. `cursorAdvancedAt` is per ACCOUNT and the
 * advance walks the associations one at a time, so a run that died between
 * account A and account B leaves a match that is partly advanced. Asking
 * instead whether NO association had advanced would be satisfied by A alone,
 * the sweep would call the phase finished, and B's cursor would stay stuck
 * forever — the match silently re-pollable for one account and not the other.
 * Existence of an UNadvanced row is the condition; absence of an advanced one
 * is a different and much weaker claim.
 *
 * It also disposes of an edge the earlier spelling carried: a match with zero
 * association rows satisfied "no association has advanced" and would have sat
 * on the page permanently. Nothing is unadvanced when nothing is tracked, so
 * such a match is now correctly absent.
 *
 * Scoped to `temporal-v2` and `FULL`: an `ARCHIVE_ONLY` match has no
 * settlement, notification or cursor phase to be stalled short of, and a match
 * the legacy pipeline owns is v1's to reconcile. Both pipelines are live, and
 * driving a V2 child onto a v1-owned match is how the same match gets processed
 * twice.
 *
 * `contested` is a per-caller choice, and a required one. A match carrying a
 * stage-conflict marker is stalled — its phases stopped short — but it stopped
 * because a stage receipt is contested, and every execution the sweep started
 * would refuse at its resume point until an operator removes the marker. The
 * sweep therefore EXCLUDES such matches: driving one each tick is a failing
 * child per sweep reporting the same fact. Operator surfaces and the backlog
 * gauge INCLUDE them, because they are exactly what a person needs to see and
 * exactly what is still unfinished.
 *
 * Ordered oldest-observation first, so the longest-stranded match is driven
 * first, with the id breaking ties so two sweeps over one backlog agree on
 * which page they are looking at. The outer scan rides
 * `MatchObservation(processingPolicy, observedAt)` — equality on the leading
 * column, the ordering on the second — and each subquery rides its own table's
 * leading key: the receipt unique index on `(riotMatchId, kind, version,
 * scopeKey)` and the tracked-account primary key on `(riotMatchId, puuid)`.
 */
/**
 * Whether a stalled-match listing carries matches whose stage receipts are
 * contested. See {@link listStalledV2MatchProcessing}.
 */
export type ContestedMatchListing =
  | { readonly kind: "include" }
  | {
      readonly kind: "exclude";
      readonly stageConflictReceiptKind: ReceiptKind;
    };

export async function listStalledV2MatchProcessing(
  db: Db,
  args: {
    observationReceiptKind: ReceiptKind;
    contested: ContestedMatchListing;
    limit: number;
    after?: ScanPosition | undefined;
  },
): Promise<StalledMatchProcessingRow[]> {
  const contested =
    args.contested.kind === "include"
      ? Prisma.empty
      : Prisma.sql`AND NOT EXISTS (SELECT 1
                         FROM "MatchProcessingReceipt" AS c
                        WHERE c."riotMatchId" = o."riotMatchId"
                          AND c."kind" = ${args.contested.stageConflictReceiptKind})`;
  const keyset =
    args.after === undefined
      ? Prisma.empty
      : Prisma.sql`AND (o."observedAt", o."riotMatchId") > (${args.after.at}::timestamp, ${args.after.id}::text)`;
  const rows: unknown = await db.$queryRaw(Prisma.sql`
    SELECT o."riotMatchId" AS "riotMatchId", o."observedAt" AS "observedAt"
      FROM "MatchObservation" AS o
     WHERE o."processingPolicy" = ${FULL_POLICY_COLUMN}
       AND o."pipelineOwner" = ${TEMPORAL_V2_OWNER_COLUMN}
       ${contested}
       AND (NOT EXISTS (SELECT 1
                          FROM "MatchProcessingReceipt" AS r
                         WHERE r."riotMatchId" = o."riotMatchId"
                           AND r."kind" = ${args.observationReceiptKind})
            OR EXISTS (SELECT 1
                         FROM "MatchTrackedAccount" AS t
                        WHERE t."riotMatchId" = o."riotMatchId"
                          AND t."cursorAdvancedAt" IS NULL))
       ${keyset}
     ORDER BY o."observedAt" ASC, o."riotMatchId" ASC
     LIMIT ${args.limit}::int`);
  return z.array(StalledMatchProcessingRowSchema).parse(rows);
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
 * `overtakenByResult` is a per-caller choice, and a required one. An intent of
 * a `before-result` kind (see {@link INTENT_TRUTH_WINDOW}) whose match carries
 * a `MatchObservation` row is one the result has already overtaken: an
 * observation is written only by a pipeline that ingested a FINISHED match, so
 * its existence is the durable fact that the game ended. Such an intent is
 * still unfinished, but it is no longer sendable — the message would be false —
 * so the sweep EXCLUDES it while operator surfaces INCLUDE it, exactly as they
 * do for a contested match: the sweep must not drive it, and a person must
 * still be able to see that it is there.
 *
 * The window applies only to {@link MESSAGE_SENDING_INTENT_STATES}, and that
 * restriction is the whole correctness of it rather than an exception to it.
 * A truth window is a statement about a MESSAGE, so it can only govern a drive
 * that produces one. Driving a `sending` row produces none: it runs the
 * unobserved-send recovery that carries the row to `unknown-delivery` and the
 * operator queue that can resolve it. Excluding those would stop the only
 * process that ever resolves them, leaving the row ambiguous forever — and a
 * prematch row can reach `sending` after its match was observed, so this is an
 * ordinary interleaving rather than a rare one.
 *
 * The predicate is in this query rather than in the caller because the page's
 * shape is a promise. `complete` in the scan result is false exactly when a
 * family FILLED its page, so a caller that fetched a page and then dropped rows
 * from it would report a short backlog over a long one — and, worse, a cohort
 * of overtaken prematch intents sorts by deadline like any other, so it would
 * occupy the page every tick and starve the intents that can still be sent.
 *
 * Rides `MatchNotificationIntent(state, freshnessDeadline)`: the drivable
 * states select the index's leading ranges and the deadline both bounds and
 * orders inside them. The intent key breaks ties, because two intents minted
 * for one match share a deadline to the millisecond. The observation check is a
 * residual on the already-narrowed range and rides `MatchObservation`'s primary
 * key.
 */
/**
 * Whether a stalled-intent listing carries intents the match's own result has
 * overtaken. See {@link listStalledNotificationIntents}.
 */
export type OvertakenIntentListing = "include" | "exclude";

export async function listStalledNotificationIntents(
  db: Db,
  args: {
    freshAt: Date;
    overtakenByResult: OvertakenIntentListing;
    limit: number;
    after?: ScanPosition | undefined;
  },
): Promise<MatchNotificationIntentRecord[]> {
  const keyset =
    args.after === undefined
      ? Prisma.empty
      : Prisma.sql`AND (i."freshnessDeadline", i."intentKey") > (${args.after.at}::timestamp, ${args.after.id}::text)`;
  // Either classification going empty is a coherent answer, not corrupt input:
  // no kind whose message expires at the result, or no drive that sends a
  // message, both mean there is nothing for this window to exclude and the
  // faithful rendering of that is no clause at all. Guarded rather than left to
  // `Prisma.join`, which rejects an empty array by throwing as the query is
  // BUILT — so every sweep tick would fail on the same line, in production,
  // over a classification decision CI could not see. What keeps the guard from
  // being silent is the behavioural test: emptying either table makes the
  // overtaken prematch row reappear on the page and
  // `reconciliation-scan.integration.test.ts` fails on the row, which is the
  // fact a reader needs, rather than on an array length.
  const windowApplies =
    args.overtakenByResult === "exclude" &&
    BEFORE_RESULT_INTENT_KINDS.length > 0 &&
    MESSAGE_SENDING_INTENT_STATES.length > 0;
  const overtaken = windowApplies
    ? Prisma.sql`AND NOT (i."kind" IN (${Prisma.join([
        ...BEFORE_RESULT_INTENT_KINDS,
      ])})
                          AND i."state" IN (${Prisma.join([
                            ...MESSAGE_SENDING_INTENT_STATES,
                          ])})
                          AND EXISTS (SELECT 1
                                        FROM "MatchObservation" AS o
                                       WHERE o."riotMatchId" = i."riotMatchId"))`
    : Prisma.empty;
  // Held intents are not stalled: a recovery-born intent whose batch policy
  // forbids its target is deliberately not being driven, and a sweep that
  // started a child on it would find the gate closed every minute until the
  // batch is released. This predicate is `notificationDeliveryDecision`
  // (`@scout-for-lol/domain/recovery/delivery-policy.ts`) said in SQL, held
  // to it by `reconciliation-scan.integration.test.ts`: `no-external` holds
  // everything, `stale-private-only` holds channels. A live intent has no
  // batch and passes; a recovery intent whose batch row is missing also
  // passes, so the child that reads it fails loudly on the missing row.
  const rows: unknown = await db.$queryRaw(Prisma.sql`
    SELECT i.*
      FROM "MatchNotificationIntent" AS i
     WHERE i."state" IN (${Prisma.join([...DRIVABLE_INTENT_STATES])})
       AND i."freshnessDeadline" > ${args.freshAt}::timestamp
       AND NOT EXISTS (SELECT 1
                         FROM "MatchRecoveryBatch" AS b
                        WHERE b."recoveryBatchId" = i."recoveryBatchId"
                          AND (b."policy" = ${HELD_EVERYTHING_POLICY}
                               OR (b."policy" = ${HELD_CHANNELS_POLICY}
                                   AND i."targetKind" = ${CHANNEL_TARGET_COLUMN})))
       ${overtaken}
       ${keyset}
     ORDER BY i."freshnessDeadline" ASC, i."intentKey" ASC
     LIMIT ${args.limit}::int`);
  return z
    .array(z.unknown())
    .parse(rows)
    .map((row) => matchNotificationIntentRowToRecord(row));
}

/**
 * Intents parked at the domain's operator dead end, the oldest first.
 *
 * The companion of {@link listStalledNotificationIntents}: that read excludes
 * `unknown-delivery` because no sweep may start a child on one, and this is
 * where those rows go instead. The set comes from the same exhaustive
 * drivability table, so a state added to the domain has to be classified once
 * rather than silently falling out of both reads.
 *
 * Whole records rather than keys, and the reason is `attemptNonce`. Resolving
 * one of these means answering what happened to a SPECIFIC attempt, and the
 * domain refuses a resolution that names a different nonce than the one stored
 * — so an operator surface that returned only keys would be asking a human to
 * make a judgement it withheld the evidence for.
 */
export async function listUnknownDeliveryIntents(
  db: Db,
  args: { limit: number; after?: ScanPosition | undefined },
): Promise<MatchNotificationIntentRecord[]> {
  const after = args.after;
  const rows = await db.matchNotificationIntent.findMany({
    where: {
      state: { in: [...OPERATOR_DEAD_END_INTENT_STATES] },
      ...(after === undefined
        ? {}
        : {
            OR: [
              { unknownObservedAt: { gt: after.at } },
              {
                unknownObservedAt: after.at,
                intentKey: { gt: after.id },
              },
            ],
          }),
    },
    orderBy: [{ unknownObservedAt: "asc" }, { intentKey: "asc" }],
    take: args.limit,
  });
  return rows.map((row) => matchNotificationIntentRowToRecord(row));
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
    after?: ScanPosition | undefined;
  },
): Promise<UnprojectedLakeMatchRow[]> {
  // The keyset goes in HAVING rather than WHERE: the ordering value is the
  // aggregate MIN over the group, so it does not exist until the group does.
  const keyset =
    args.after === undefined
      ? Prisma.empty
      : Prisma.sql`HAVING (MIN(a."recordedAt"), a."riotMatchId") > (${args.after.at}::timestamp, ${args.after.id}::text)`;
  const rows: unknown = await db.$queryRaw(Prisma.sql`
    SELECT a."riotMatchId" AS "riotMatchId",
           MIN(a."recordedAt") AS "archivedAt"
      FROM "MatchProcessingReceipt" AS a
     WHERE a."kind" = ${args.archiveReceiptKind}
       AND NOT EXISTS (SELECT 1
                         FROM "MatchProcessingReceipt" AS s
                        WHERE s."riotMatchId" = a."riotMatchId"
                          AND s."kind" = ${args.stagingReceiptKind})
     GROUP BY a."riotMatchId"
     ${keyset}
     ORDER BY MIN(a."recordedAt") ASC, a."riotMatchId" ASC
     LIMIT ${args.limit}::int`);
  return z.array(UnprojectedLakeMatchRowSchema).parse(rows);
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
  args: { limit: number; after?: ScanPosition | undefined },
): Promise<LiveRecoveryBatchRow[]> {
  const after = args.after;
  const rows = await db.matchRecoveryBatch.findMany({
    where: {
      state: { in: [...LIVE_RECOVERY_BATCH_STATES] },
      ...(after === undefined
        ? {}
        : {
            OR: [
              { createdAt: { gt: after.at } },
              { createdAt: after.at, recoveryBatchId: { gt: after.id } },
            ],
          }),
    },
    orderBy: [{ createdAt: "asc" }, { recoveryBatchId: "asc" }],
    take: args.limit,
    select: { recoveryBatchId: true, createdAt: true },
  });
  return rows.map((row) => ({
    recoveryBatchId: RecoveryBatchIdSchema.parse(row.recoveryBatchId),
    createdAt: row.createdAt,
  }));
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
  args: {
    workflowTypes: readonly string[];
    limit: number;
    /** The tie-break is the REQUEST key; the position's type says so. */
    after?: ScanPosition<WorkflowStartRequestId> | undefined;
  },
): Promise<ScoutWorkflowStartRecord[]> {
  const after = args.after;
  // The keyset id is the REQUEST key, not the workflow id: a workflow id can
  // name many requests over its life, and only the request key is unique.
  const rows = await db.scoutWorkflowStart.findMany({
    where: {
      workflowType: { in: [...args.workflowTypes] },
      acceptedAt: null,
      ...(after === undefined
        ? {}
        : {
            OR: [
              { requestedAt: { gt: after.at } },
              { requestedAt: after.at, requestId: { gt: after.id } },
            ],
          }),
    },
    orderBy: [{ requestedAt: "asc" }, { requestId: "asc" }],
    take: args.limit,
  });
  return rows.map((row) => scoutWorkflowStartRowToRecord(row));
}
