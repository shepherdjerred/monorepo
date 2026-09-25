import { resolveQueueTypeFromGame } from "@scout-for-lol/data";
import {
  NotificationIntentKeySchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { prisma, type Db } from "#src/database/index.ts";
import { getChannelsSubscribedToPlayers } from "#src/database/subscribed-channels.ts";
import {
  getIntent,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import {
  deliveryIntentKey,
  prematchDeliveryKeyPrefix,
} from "#src/durable/match/delivery-intents.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { toIsoInstant } from "#src/durable/match/match-identity.ts";
import { channelsPassingQueueFilter } from "#src/league/tasks/notification-filters.ts";
import { ACTIVE_GAME_TTL_MS } from "#src/league/tasks/prematch/active-game-queries.ts";
import { createLogger } from "#src/logger.ts";
import { durableCommitV2 } from "#src/temporal/v2/match-commits.ts";
import type { ScoutV2PrematchContext } from "#src/temporal/v2/prematch/prematch-context.ts";

const logger = createLogger("scout-v2-prematch-intents");

/**
 * The V2 per-game core's notification intents: one durable row per channel
 * that should hear this game started.
 *
 * ## Why this sits inside the capture Activity
 *
 * `planPrematchFanOutV2` READS intents, it does not mint them — that is the
 * discipline the frozen fan-out contract states, and it is also all that
 * Activity can do: it receives a match reference, and the channels owed a
 * notification are derived from the tracked accounts in the game, which only
 * the spectator roster names. The capture Activity is the one place in the V2
 * prematch path that holds that roster, so it is where the intents are minted
 * and where `planPrematchFanOutV2` reads them back from.
 *
 * ## Why the write is strict
 *
 * v1 mints through `createChannelDeliveryRecorder`, behind `recordDurableWrite`,
 * which swallows: a recorder outage must never block v1's send. V2 has no send
 * to protect — the intent row IS the instruction to send, and a notification
 * child is started from the row or not at all. A swallowed failure here would
 * be a silently unannounced game, so every write goes to the repository
 * directly and a failure fails the Activity for Temporal to retry.
 *
 * The rows are minted `pending`, not `ready`. v1 marks ready immediately
 * because it has already rendered by the time it records; in V2 the render is
 * the notification Workflow's own phase, and `markNotificationReadyV2` is the
 * transition that opens it.
 */

/** What one attempt did to one channel's intent row. */
export type PrematchIntentMint = "minted" | "existing" | "conflict";

/**
 * Ensure one pending intent exists for one channel, at most once.
 *
 * The replay gate is a read, for the same reason the capture's is:
 * `upsertIntent` compares the whole stored row, and `createdAt` and
 * `freshnessDeadline` are stamped from the clock — so a second attempt that
 * wrote again would be answered `intent-differs` and look like two producers
 * disagreeing about one decision to notify. Reading first means a retry finds
 * the first attempt's row and writes nothing.
 *
 * A conflict that survives the read is reported rather than thrown, and that
 * is the opposite call from the one `receiptedCommitV2` makes on a receipt
 * conflict — deliberately, because the two mean different things.
 *
 * A receipt evidence mismatch is two producers disagreeing about a FACT: which
 * bytes are this snapshot's canonical ones. Only one answer can be true, so it
 * fails the Activity. `intent-differs` here is two producers both minting the
 * SAME instruction — announce this game in this channel — during the window
 * where v1 and V2 are both live, differing only in the clock each stamped it
 * with. The stored row is a valid, drivable instruction whoever wrote it, and
 * nothing was lost: the losing write invented nothing and suppressed nothing.
 *
 * Failing here would turn a benign dual-run race into a flapping child, since
 * the replacement run would re-race and could conflict again. It stays a
 * distinct outcome all the way out to {@link PrematchIntentsV2Summary} rather
 * than folding into `existing`, so a rate that climbs after v1 is retired —
 * when this race should no longer be possible — is visible rather than
 * indistinguishable from ordinary replay.
 */
export async function mintPrematchIntent(
  db: Db,
  args: {
    matchId: RiotMatchId;
    channelId: string;
    createdAt: Date;
    freshnessDeadline: Date;
  },
): Promise<PrematchIntentMint> {
  const key = NotificationIntentKeySchema.parse(
    deliveryIntentKey(prematchDeliveryKeyPrefix(args.matchId), args.channelId),
  );
  const standing = await getIntent(db, { intentKey: key });
  if (standing !== null) {
    requireIntentMatches(standing, args.matchId, args.channelId);
    return "existing";
  }

  const commit = durableCommitV2(
    await upsertIntent(db, {
      matchId: args.matchId,
      intent: {
        key,
        kind: "prematch",
        origin: { kind: "live" },
        target: {
          kind: "channel",
          channelId: DiscordChannelIdSchema.parse(args.channelId),
        },
        freshnessDeadline: toIsoInstant(args.freshnessDeadline),
        createdAt: toIsoInstant(args.createdAt),
        attemptCount: 0,
        state: { kind: "pending" },
      },
    }),
  );
  if (commit.outcome !== "conflict") return "minted";
  logger.warn(
    `⚠️  Prematch intent ${key} was minted by another producer between this run's read and its write (${commit.reason}); the stored row stands`,
  );
  return "conflict";
}

/**
 * Refuse to treat a standing row as this run's replay unless it IS this
 * instruction.
 *
 * The key is derived from the match and the channel, so a row under it should
 * carry exactly those — but the row's own columns are what every reader uses:
 * `listIntentsForMatch` selects by the match column, and the notification
 * child sends to the target column. A row under this key that named a
 * different match would be accepted here as "already minted" and then never
 * be found by the fan-out for this game, so the channel would silently never
 * hear about it. That is a broken internal contract, not a state to reconcile,
 * and it fails loudly. State progression is deliberately NOT checked: a row
 * already `ready`, `sending` or `delivered` is this instruction further along.
 */
function requireIntentMatches(
  standing: MatchNotificationIntentRecord,
  matchId: RiotMatchId,
  channelId: string,
): void {
  const target = standing.intent.target;
  const sameTarget =
    target.kind === "channel" && target.channelId === channelId;
  if (sameTarget && standing.matchId === matchId) return;
  throw new Error(
    `Prematch intent ${standing.intent.key} stands for ${standing.matchId} → ${target.kind === "channel" ? target.channelId : target.kind}, not for ${matchId} → ${channelId}; refusing to treat it as this game's instruction`,
  );
}

/**
 * What one capture attempt did to this game's intent rows.
 *
 * `existing` (this run's own replay found the row) and `conflicts` (another
 * producer minted it in the write window) are counted apart because they say
 * different things about the system, and collapsing them would make the second
 * unobservable.
 */
export type PrematchIntentsV2Summary = {
  minted: number;
  existing: number;
  conflicts: number;
};

/** Ensure every channel subscribed to a tracked player in this game is owed one. */
export async function recordPrematchDeliveryIntentsV2(
  context: ScoutV2PrematchContext,
  observedAt: Date,
): Promise<PrematchIntentsV2Summary> {
  const queueType = resolveQueueTypeFromGame(
    context.gameInfo.gameQueueConfigId,
    context.gameInfo.gameMode,
    context.gameInfo.gameType,
  );
  const channels = channelsPassingQueueFilter(
    await getChannelsSubscribedToPlayers(
      context.trackedPlayers.map((player) => player.league.leagueAccount.puuid),
    ),
    queueType,
  );

  // The ActiveGame row's own lifetime, which is v1's answer to the same
  // question: past it the game is no longer tracked, so a pre-match send would
  // be about a game already over.
  const freshnessDeadline = new Date(observedAt.getTime() + ACTIVE_GAME_TTL_MS);
  const summary: PrematchIntentsV2Summary = {
    minted: 0,
    existing: 0,
    conflicts: 0,
  };
  for (const subscribed of channels) {
    const mint = await mintPrematchIntent(prisma, {
      matchId: context.riotMatchId,
      channelId: subscribed.channel,
      createdAt: observedAt,
      freshnessDeadline,
    });
    if (mint === "minted") summary.minted += 1;
    else if (mint === "conflict") summary.conflicts += 1;
    else summary.existing += 1;
  }
  return summary;
}
