import {
  resolveQueueTypeFromGame,
  type LoadingScreenData,
} from "@scout-for-lol/data";
import type { ScoutNotificationFollowUpV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import { recordCoreOutputsDelivered } from "#src/analytics/guild-lifecycle.ts";
import { appendPoolMessageRef } from "#src/betting/markets/pool-open.ts";
import { refreshBucksMessages } from "#src/betting/notify/message-refresh.ts";
import { startParlayGeneration } from "#src/betting/parlays/parlay-generate.ts";
import { prisma } from "#src/database/index.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { UnsupportedLoadingScreenQueueError } from "#src/league/tasks/prematch/loading-screen-errors.ts";
import { createLogger } from "#src/logger.ts";
import { parlayTemporalWorkId } from "#src/temporal/work-store.ts";
import { readNotificationArtifactV2 } from "#src/temporal/v2/notification-receipts.ts";
import {
  buildPrematchLoadingScreenDataV2,
  prematchContentBaseV2,
  requireArchivedPrematchContext,
} from "#src/temporal/v2/notification/prematch-notification.ts";
import type { ScoutV2PrematchContext } from "#src/temporal/v2/prematch/prematch-context.ts";
import { prematchGuildOfChannel } from "#src/temporal/v2/prematch/prematch-markets.ts";

const logger = createLogger("scout-v2-prematch-follow-up");

/**
 * What v1's `recordPrematchOutputs` does after a prematch send, for one
 * delivered V2 prematch intent.
 *
 * v1 runs it once per game, after every channel's send, with every message it
 * produced. V2 delivers each channel from its own notification run, so this
 * runs once per delivered CHANNEL and does that channel's share of the same
 * work:
 *
 * 1. Record the message on its guild's pool — the ref the close sweep greys
 *    out and the ONLY record the settlement announcement has of where the
 *    pool's bettors are watching. It is an append, never an overwrite, since
 *    sibling channels of one guild record concurrently
 *    (`appendPoolMessageRef`), and it THROWS on failure so the Activity's
 *    retry repairs a lost write instead of the settlement silently having
 *    nowhere to go.
 * 2. Refresh the pool's messages from the persisted pool, as v1 does, which
 *    writes the authoritative close time into the live-market line. A pool
 *    the close sweep already closed has its components removed, because its
 *    sweep ran before this ref existed and could not edit this message.
 * 3. Enqueue the parlay for a game that got a pool, as v1 does once per
 *    game. Its detached-work row is keyed by the match, so the first channel
 *    to get here enqueues it and the rest find it standing. It runs AFTER the
 *    ref because parlay generation refuses a match whose pools carry no refs.
 * 4. Count the core-output analytics for the channel's guild, last, so a
 *    retried Activity cannot count one delivery twice.
 *
 * Steps 2 and 3 are best-effort, exactly as in v1: a refresh or a parlay that
 * fails does not undo a delivered announcement, and is logged rather than
 * retried into a second parlay request.
 *
 * ## What v1 did here that V2 does not
 *
 * v1 decorates the message with a feature tip before sending and confirms the
 * tip's claim after. The V2 message is rebuilt from durable state on every
 * send attempt, and a tip is a mutable claim rather than a fact of the game —
 * decorating would make the attested message depend on which attempt ran.
 * The V2 post-match send makes the same call. For a betting guild the
 * difference is also invisible for long: v1's own refresh rewrites the
 * content from `prematchContentBase`, which never contained the tip.
 */
export async function afterPrematchDeliveredV2(
  record: MatchNotificationIntentRecord,
): Promise<ScoutNotificationFollowUpV2Result> {
  const state = record.intent.state;
  const target = record.intent.target;
  if (
    state.kind !== "delivered" ||
    state.messageId === undefined ||
    target.kind !== "channel"
  ) {
    return { outcome: "skipped" };
  }
  const guildId = await prematchGuildOfChannel(target.channelId);
  if (guildId === null) {
    logger.warn(
      `Prematch intent ${record.intent.key} was delivered to channel ${target.channelId}, which no subscription names any more; nothing to record against a guild`,
    );
    return { outcome: "skipped" };
  }

  const pool = await prisma.bucksMatchPool.findUnique({
    where: {
      matchId_serverId: { matchId: record.matchId, serverId: guildId },
    },
    select: { id: true },
  });
  if (pool !== null) {
    const context = await requireArchivedPrematchContext(record.matchId);
    await recordPoolMessage(record, context, guildId, {
      channelId: target.channelId,
      messageId: state.messageId,
    });
    await enqueueParlayOnce(context);
  }

  await recordCoreOutputsDelivered([guildId], "prematch");
  return { outcome: "completed" };
}

async function recordPoolMessage(
  record: MatchNotificationIntentRecord,
  context: ScoutV2PrematchContext,
  guildId: DiscordGuildId,
  ref: { channelId: string; messageId: string },
): Promise<void> {
  const rendered = await readNotificationArtifactV2(record.matchId, "prematch");
  if (rendered === null || rendered.artifact === "report") {
    throw new Error(
      `Prematch intent ${record.intent.key} was delivered, but no prematch render receipt stands for ${record.matchId} to say what its message carried`,
    );
  }
  await appendPoolMessageRef({
    matchId: record.matchId,
    serverId: guildId,
    ref,
    prematchContentBase: await prematchContentBaseV2(
      context,
      rendered.artifact,
    ),
  });
  const standing = await prisma.bucksMatchPool.findUnique({
    where: {
      matchId_serverId: { matchId: record.matchId, serverId: guildId },
    },
    select: { poolState: true },
  });
  // `refreshBucksMessages` never throws: it reports its own failures.
  await refreshBucksMessages({
    matchId: record.matchId,
    serverId: guildId,
    removeComponents: standing?.poolState !== "open",
  });
}

async function loadingScreenDataFor(
  context: ScoutV2PrematchContext,
): Promise<LoadingScreenData | undefined> {
  try {
    return await buildPrematchLoadingScreenDataV2(context);
  } catch (error) {
    // A queue with no loading screen has no parlay context, which is what v1
    // hands its parlay for the same game: generation then stops on
    // `no_context` rather than guessing at a screen nobody saw.
    if (error instanceof UnsupportedLoadingScreenQueueError) return undefined;
    throw error;
  }
}

async function enqueueParlayOnce(
  context: ScoutV2PrematchContext,
): Promise<void> {
  try {
    const standing = await prisma.scoutTemporalWork.findUnique({
      where: { id: parlayTemporalWorkId(context.riotMatchId) },
      select: { id: true },
    });
    if (standing !== null) return;
    const gameInfo = context.gameInfo;
    await startParlayGeneration({
      gameInfo,
      trackedPlayers: context.trackedPlayers,
      queueType: resolveQueueTypeFromGame(
        gameInfo.gameQueueConfigId,
        gameInfo.gameMode,
        gameInfo.gameType,
      ),
      loadingScreenData: await loadingScreenDataFor(context),
    });
  } catch (error) {
    logger.error(
      `Could not enqueue the parlay for ${context.riotMatchId} after its prematch delivery; the delivery and its pool refs stand`,
      error,
    );
  }
}
