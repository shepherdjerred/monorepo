import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { MatchDeliveryModeSchema } from "@scout-for-lol/domain/match-processing/states.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type { ReceiptKind } from "@scout-for-lol/domain/match-processing/states.ts";
import {
  ScoutFanOutV2ResultSchema,
  ScoutMatchPipelineStateV2ResultSchema,
  ScoutPostMatchScanV2ResultSchema,
  type ScoutFanOutV2Result,
  type ScoutIntentSummaryV2,
  type ScoutMatchPipelineStateV2Result,
  type ScoutPostMatchScanV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import { SCOUT_V2_PAGE_MAX } from "@scout-for-lol/temporal/contracts-v2";
import { prisma } from "#src/database/index.ts";
import { listIntentsForMatch } from "#src/database/durable/intent-repository.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { getMatchPipelineState } from "#src/database/durable/match-pipeline-state.ts";
import { getObservation } from "#src/database/durable/observation-repository.ts";
import { listReceipts } from "#src/database/durable/receipt-repository.ts";
import { discoverPostMatchIntents } from "#src/league/tasks/postmatch/match-history-polling.ts";
import { SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND } from "@scout-for-lol/temporal/match-receipts-v2";

/**
 * The V2 core's reads: what to process, where a run can resume from, and what
 * the committed state calls for next.
 *
 * Every result is parsed through its frozen contract schema before it leaves.
 * These are the Activities whose results a Workflow makes decisions from, and
 * a page that quietly exceeded its budget or an intent key a Workflow ID
 * cannot carry would otherwise become a Workflow-side failure — or worse, a
 * silently truncated fan-out — rather than a named failure here.
 */

/**
 * Which intents a notification child can still drive.
 *
 * `pending` and `ready` are work not yet attempted. `sending` is an attempt
 * whose worker may have died: only the notification machine can resolve it,
 * and the child's ID collapses onto whichever execution already owns it.
 *
 * Every other state is deliberately excluded. `delivered`, `suppressed`,
 * `expired` and `permission-denied` are settled. `unknown-delivery` is the
 * domain's operator dead end — the request left, the response did not arrive,
 * and starting a child on it is precisely how a user gets told the same thing
 * twice.
 */
export const DRIVABLE_INTENT_STATES: ReadonlySet<string> = new Set([
  "pending",
  "ready",
  "sending",
]);

/**
 * Discover the completed matches tracked accounts played, as a bounded page.
 *
 * This is v1's discovery, unchanged: it force-polls the frozen accounts of
 * active Dares, orders what it finds by game end, and reports incompleteness
 * rather than guessing when a target or timestamp is unavailable. V2 narrows
 * the result to the identifiers — the per-match Workflow resolves everything
 * else from the match id, so nothing else needs to cross into a history —
 * plus the account whose history surfaced each match, which only this pass
 * knows and which the per-match core needs for v1's source precondition.
 *
 * `complete` folds two different incompletenesses together on purpose, because
 * the caller does the same thing with both: discovery could not see the whole
 * tail (v1's `evidenceComplete`), or this page hit the contract's budget. In
 * either case the next run rediscovers what is left.
 *
 * `skipped` is NOT a third incompleteness and is kept apart from both. It is
 * discovery refusing to run because a poll already holds the status — it
 * opened nothing, so the Workflow closes nothing — whereas an incomplete scan
 * opened a poll and owes the maintenance that closes it.
 *
 * The poll is claimed DURABLY here rather than held by the in-process flag v1
 * uses. A V2 poll spans a Workflow — this Activity, the children it awaits,
 * and the maintenance that closes it — and an in-process flag is released the
 * moment this Activity returns, which left a second discovery free to open a
 * poll of its own while the first was still awaiting children; the first run's
 * maintenance then marked the SECOND run's poll complete underneath it. The
 * claim's identity rides the result so the close can present it.
 */
export async function discoverPostMatchIdsV2(options?: {
  /**
   * The instant to claim the poll at. The Activity passes its FIRST-scheduled
   * timestamp, which is stable across its retries, so an attempt that claimed
   * the poll and then died leaves a claim its own retry re-acquires rather
   * than one the retry reads as another run's — which would leave the poll
   * standing with no run left to close it.
   */
  claimAt?: Date;
}): Promise<ScoutPostMatchScanV2Result> {
  const discovery = await discoverPostMatchIntents({
    ownership: "durable",
    ...(options?.claimAt === undefined ? {} : { startedAt: options.claimAt }),
  });
  if (discovery.outcome === "skipped") {
    return ScoutPostMatchScanV2ResultSchema.parse({ outcome: "skipped" });
  }
  if (discovery.pollOwner === undefined) {
    // A durable pass that polled holds a claim by construction. Reporting a
    // scan without one would hand the Workflow a poll nothing can close.
    throw new Error(
      "V2 discovery polled without a durable poll claim; refusing to report a scan whose poll has no owner to close it",
    );
  }
  const matches = discovery.matches
    .map((intent) => {
      if (intent.gameEndTimestamp === undefined) {
        throw new Error(
          `Current V2 discovery omitted the completion timestamp for ${intent.matchId}`,
        );
      }
      return {
        riotMatchId: RiotMatchIdSchema.parse(intent.matchId),
        sourcePuuid: LeaguePuuidSchema.parse(intent.sourcePuuid),
        // v1's own per-match call, carried rather than re-derived: a match it
        // surfaced while filling a gap announces nothing, and this pass is the
        // only place that knows which kind of pass found it.
        deliveryMode: MatchDeliveryModeSchema.parse(intent.delivery),
        gameEndTimestamp: intent.gameEndTimestamp,
      };
    })
    .slice(0, SCOUT_V2_PAGE_MAX);
  return ScoutPostMatchScanV2ResultSchema.parse({
    outcome: "scanned",
    riotMatchIds: matches.map((match) => match.riotMatchId),
    matches,
    complete:
      discovery.evidenceComplete &&
      discovery.matches.length <= SCOUT_V2_PAGE_MAX,
    // The claim this pass opened; maintenance closes exactly this poll.
    pollOwner: discovery.pollOwner.startedAt.toISOString(),
    // v1's own watermark, passed through unchanged: post-match maintenance
    // settles Dare deadlines against it, and only this pass can compute it.
    ...(discovery.evidenceWatermark === undefined
      ? {}
      : { evidenceWatermark: discovery.evidenceWatermark }),
  });
}

function intentSummaryV2(
  record: MatchNotificationIntentRecord,
): ScoutIntentSummaryV2 {
  const intent = record.intent;
  return {
    intentKey: intent.key,
    state: intent.state,
    attemptCount: intent.attemptCount,
    ...(intent.lastFailure === undefined
      ? {}
      : { lastFailure: intent.lastFailure }),
  };
}

/**
 * The resume point for one match.
 *
 * `receiptKinds` is deduplicated because a kind can be recorded once per
 * scope — a report-delivery receipt exists per guild — while the Workflow asks
 * a per-match question of it: did this phase happen. Insertion order is the
 * order the receipts were recorded in, which is what the result contract
 * promises.
 *
 * The tracked-account summary is counts only, and that is a narrowing this
 * boundary can afford: no Workflow decision turns on whether an association's
 * `accountId` is NULL or dangling, and the aggregate under it keeps both so
 * the distinction stays recoverable where it matters.
 */
export async function readMatchPipelineStateV2(input: {
  riotMatchId: string;
}): Promise<ScoutMatchPipelineStateV2Result> {
  const matchId = RiotMatchIdSchema.parse(input.riotMatchId);
  const aggregate = await getMatchPipelineState(prisma, { matchId });
  if (aggregate === null) {
    const receipts = await listReceipts(prisma, { matchId });
    const terminal = receipts.some(
      (record) =>
        record.receipt.kind === SCOUT_V2_CLIENT_MATCH_TERMINAL_RECEIPT_KIND,
    );
    return ScoutMatchPipelineStateV2ResultSchema.parse({
      kind: terminal ? "terminal" : "absent",
    });
  }
  const receiptKinds: ReceiptKind[] = [
    ...new Set(aggregate.processing.receipts.map((receipt) => receipt.kind)),
  ];
  return ScoutMatchPipelineStateV2ResultSchema.parse({
    kind: "present",
    state: {
      riotMatchId: aggregate.processing.matchId,
      owner: aggregate.processing.owner,
      policy: aggregate.processing.policy,
      // The committed mode. A resumed run reads delivery from here rather
      // than re-deciding it, which is how a silent backfill stays silent
      // across a restart that has no discovery pass behind it.
      deliveryMode: aggregate.deliveryMode,
      promoted: aggregate.processing.promotion !== null,
      receiptKinds,
      intents: aggregate.intents.map((record) => intentSummaryV2(record)),
      trackedAccounts: {
        total: aggregate.trackedAccounts.length,
        cursorAdvanced: aggregate.trackedAccounts.filter(
          (association) => association.cursorAdvancedAt !== null,
        ).length,
      },
    },
  });
}

/**
 * What to start once the domain commit stands.
 *
 * The intent keys are READ from the durable rows rather than derived per
 * channel: a Workflow that guessed a key per channel would miss intents
 * another producer minted and would re-mint keys for intents that already
 * exist.
 *
 * `lakeProjection` is true exactly when the observation carries the match
 * payload's artifact identity. The lake is a derived, rebuildable projection
 * of the canonical S3 object, so there is something to project precisely when
 * that object is known to exist — not when a match merely has rows.
 */
export async function planMatchFanOutV2(input: {
  riotMatchId: string;
}): Promise<ScoutFanOutV2Result> {
  const matchId = RiotMatchIdSchema.parse(input.riotMatchId);
  const [intents, observation] = await Promise.all([
    listIntentsForMatch(prisma, { matchId }),
    getObservation(prisma, { matchId }),
  ]);
  return ScoutFanOutV2ResultSchema.parse({
    // Every drivable intent for this match EXCEPT a prematch one.
    //
    // Kind is not a routing decision here: the notification child is started
    // from an intent key and the delivery arm selects its renderer from the
    // row's own `kind`, so excluding a kind does not send it differently — it
    // leaves it unstarted. That is why the announcement kinds are included.
    // They are minted inside the fenced settlement effect, which commits
    // before this Activity runs, so they are already standing here, and
    // dropping them would strand rows the operator backlog gauge counts.
    //
    // `prematch` is the one kind that must be left alone, and the reason is
    // this Activity's timing rather than its routing. A prematch intent
    // announces a game STARTING, and a post-match fan-out runs at the one
    // moment the pipeline knows the game ended. The freshness deadline does
    // not cover this: it is the game's own three-hour TTL, and a match
    // discovered minutes after it ended is still comfortably inside it, so a
    // prematch row left `pending` by a failed prematch child would pass
    // `beginSend` and post "game starting" after the result was already known.
    // A delivered one is settled and was never drivable; this is only about
    // the ones an outage left behind. The prematch lane's own fan-out drives
    // them while the game is live, which is the only time they are true.
    notificationIntentKeys: intents
      .filter(
        (record) =>
          record.intent.kind !== "prematch" &&
          DRIVABLE_INTENT_STATES.has(record.intent.state.kind),
      )
      .map((record) => record.intent.key),
    lakeProjection:
      observation !== null && observation.artifacts.match !== null,
  });
}
