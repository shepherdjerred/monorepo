import { ApplicationFailure } from "@temporalio/common";
import { MatchIdSchema, resolveQueueTypeFromGame } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutMatchRefV2 } from "@scout-for-lol/temporal/contracts-v2";
import { SCOUT_V2_MATCH_RECEIPT_KINDS } from "@scout-for-lol/temporal/match-receipts-v2";
import {
  ScoutSilentPostmatchBackfillV2ResultSchema,
  type ScoutSilentBackfillSkipReasonV2,
  type ScoutSilentPostmatchBackfillV2Result,
} from "@scout-for-lol/temporal/silent-postmatch-backfill-v2";
import { prisma } from "#src/database/index.ts";
import {
  getMatchPipelineState,
  type MatchPipelineState,
} from "#src/database/durable/match-pipeline-state.ts";
import { getRecordedRankChangesForMatch } from "#src/league/model/rank-history.ts";
import { resolvePostmatchDeliveryChannels } from "#src/league/tasks/notification-filters.ts";
import { createLogger } from "#src/logger.ts";
import { resolveScoutV2ObservedMatchContext } from "#src/temporal/v2/match-context.ts";
import { renderMatchNotificationArtifactV2 } from "#src/temporal/v2/notification-render.ts";
import { scoutV2NotificationRenderReceiptKind } from "#src/temporal/v2/notification-receipts.ts";
import type { PostmatchRankChanges } from "#src/betting/dares/lifecycle/dare-rank-capture-v3.ts";

const logger = createLogger("scout-v2-silent-postmatch-backfill");

/**
 * The silent post-match backfill, one match at a time.
 *
 * Renders and attests the match's post-match report exactly as the live
 * notification lane would — the same fenced render, the same object names,
 * the same `v2-notification-render-postmatch` receipt — and does nothing
 * else. See `@scout-for-lol/temporal/silent-postmatch-backfill-v2` for why
 * the gap exists.
 *
 * ## Why this cannot announce anything
 *
 * An announcement needs an intent row or a Discord call, and this module has
 * the means to make neither: it imports no minter and no delivery, and the
 * render it calls commits bytes and a receipt and returns. A render receipt is
 * not a promise to anyone. The live lane reads it only for an intent that
 * already exists, and every match this renders for was refused if one did.
 *
 * ## What it refuses, before any effect
 *
 * Everything is read from the durable pipeline state, the same aggregate the
 * per-match core resumes from, so a refusal is the fact that decided it and a
 * rerun decides it identically.
 *
 * - A match with no observation is not something this backfill can reason
 *   about; the caller named a match the pipeline never saw, and that fails
 *   non-retryably rather than being skipped quietly.
 * - A match whose render receipt stands is done.
 * - A match another pipeline owns is that pipeline's (the ownership guard):
 *   V2 renders only what V2 processed.
 * - ARCHIVE_ONLY runs no downstream effect, and a `silent-backfill`
 *   observation mints no report intent, so a normal run renders nothing for
 *   either and neither does this.
 * - A match whose core has not attested every phase, or whose cursors have
 *   not all advanced, is still the core's; rendering under it would race the
 *   run that owns it.
 * - A match with a postmatch intent is the live lane's to render.
 * - A match with no deliverable channel would have minted no intent, so a
 *   normal run rendered nothing for it; rendering it here would persist more
 *   than a normal run did.
 */

const CORE_RECEIPT_KINDS = [
  SCOUT_V2_MATCH_RECEIPT_KINDS.archive,
  SCOUT_V2_MATCH_RECEIPT_KINDS.observation,
  SCOUT_V2_MATCH_RECEIPT_KINDS.settlement,
  SCOUT_V2_MATCH_RECEIPT_KINDS.progression,
  SCOUT_V2_MATCH_RECEIPT_KINDS.tournament,
];

/** The first durable fact that rules this match out, or `null`. */
export function silentBackfillRefusalV2(
  state: MatchPipelineState,
): ScoutSilentBackfillSkipReasonV2 | null {
  const kinds = new Set(
    state.processing.receipts.map((receipt) => receipt.kind),
  );
  if (kinds.has(scoutV2NotificationRenderReceiptKind("postmatch"))) {
    return "already-rendered";
  }
  if (state.processing.owner.kind !== "temporal-v2") return "not-v2-owned";
  if (state.processing.policy !== "FULL") return "archive-only";
  if (state.deliveryMode !== "live") return "observed-silent";
  const coreAttested = CORE_RECEIPT_KINDS.every((kind) => kinds.has(kind));
  const cursorsAdvanced = state.trackedAccounts.every(
    (account) => account.cursorAdvancedAt !== null,
  );
  if (!coreAttested || !cursorsAdvanced) return "core-incomplete";
  const liveIntentStands = state.intents.some(
    (record) => record.intent.kind === "postmatch",
  );
  return liveIntentStands ? "postmatch-intent-standing" : null;
}

async function requirePipelineState(
  riotMatchId: RiotMatchId,
): Promise<MatchPipelineState> {
  const state = await getMatchPipelineState(prisma, { matchId: riotMatchId });
  if (state === null) {
    throw ApplicationFailure.nonRetryable(
      `Refusing to backfill ${riotMatchId}: no observation stands for it, so the pipeline never processed it`,
      "MissingDomainRecord",
    );
  }
  return state;
}

/**
 * The rank changes the settlement-time capture recorded for this game, for a
 * render that must not capture its own; empty for an unranked queue.
 */
async function recordedRankChanges(
  riotMatchId: RiotMatchId,
  queueType: ReturnType<typeof resolveQueueTypeFromGame>,
): Promise<PostmatchRankChanges> {
  const ranked =
    queueType === "solo" || queueType === "flex" || queueType === "ranked 5s";
  return ranked
    ? await getRecordedRankChangesForMatch(
        MatchIdSchema.parse(riotMatchId),
        queueType,
        prisma,
      )
    : new Map();
}

function skipped(
  riotMatchId: RiotMatchId,
  reason: ScoutSilentBackfillSkipReasonV2,
): ScoutSilentPostmatchBackfillV2Result {
  logger.info(`🤫 Silent backfill skipped ${riotMatchId}: ${reason}`);
  return ScoutSilentPostmatchBackfillV2ResultSchema.parse({
    outcome: "skipped",
    reason,
  });
}

export async function backfillSilentPostmatchArtifactV2(
  input: ScoutMatchRefV2,
): Promise<ScoutSilentPostmatchBackfillV2Result> {
  const { riotMatchId } = input;
  const refusal = silentBackfillRefusalV2(
    await requirePipelineState(riotMatchId),
  );
  if (refusal !== null) return skipped(riotMatchId, refusal);

  // The audience the mint would have resolved: the PUUIDs the observation
  // recorded, against the subscriptions and queue filters standing now.
  const context = await resolveScoutV2ObservedMatchContext(riotMatchId);
  const queueType = resolveQueueTypeFromGame(
    context.matchData.info.queueId,
    context.matchData.info.gameMode,
    context.matchData.info.gameType,
  );
  const { deliverable } = await resolvePostmatchDeliveryChannels({
    puuids: context.observedPuuids,
    queueType,
  });
  if (deliverable.length === 0) {
    return skipped(riotMatchId, "no-deliverable-channel");
  }

  const outcome = await renderMatchNotificationArtifactV2({
    riotMatchId,
    kind: "postmatch",
    postmatchMode: {
      kind: "historical",
      rankChanges: await recordedRankChanges(riotMatchId, queueType),
    },
  });
  logger.info(
    `🤫 Silent backfill ${outcome} the post-match report for ${riotMatchId}; no intent minted, nothing delivered`,
  );
  return ScoutSilentPostmatchBackfillV2ResultSchema.parse({ outcome });
}
