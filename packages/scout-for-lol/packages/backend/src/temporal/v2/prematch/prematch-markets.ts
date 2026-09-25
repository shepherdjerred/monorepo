import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import { resolveQueueTypeFromGame } from "@scout-for-lol/data";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/domain/identity/discord.ts";
import { ReceiptKindSchema } from "@scout-for-lol/domain/match-processing/states.ts";
import type { ScoutGuardedEffectV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import { awardClassicPrematchForGame } from "#src/betting/accounts/classic-prematch-earnings.ts";
import { isStandardLobby } from "#src/betting/eligibility/eligibility.ts";
import { openBettingPoolsStrict } from "#src/betting/markets/pool-open.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { listIntentsForMatch } from "#src/database/durable/intent-repository.ts";
import { prematchDeliveryKeyPrefix } from "#src/durable/match/delivery-intents.ts";
import { createLogger } from "#src/logger.ts";
import { runGuardedEffectV2 } from "#src/temporal/v2/effect-fence.ts";
import {
  readMatchReceiptEvidenceV2,
  recordMatchReceiptV2,
} from "#src/temporal/v2/match-commits.ts";
import type { ScoutV2PrematchContext } from "#src/temporal/v2/prematch/prematch-context.ts";
import { resumeArchivedPrematchContext } from "#src/temporal/v2/prematch/prematch-resume.ts";

const logger = createLogger("scout-v2-prematch-markets");

/**
 * The V2 prematch path's Bryan Bucks effect: the markets a live game opens,
 * or the one Classic reward it grants, run once per match behind the V2
 * effect fence.
 *
 * ## The semantics are v1's, and so are the writes
 *
 * v1's `prepareBucksPrematch` does exactly one of two things for a game, and
 * so does this. A standard Classic lobby earns each tracked, Bucks-enabled
 * player the participation point and opens no market — Classic has no
 * post-game payload to settle a market against. Any other game opens one pool
 * per Bucks-enabled guild it is announced in, when the queue and lobby are
 * bettable. Both call v1's own functions, so there is one implementation of
 * each rule:
 *
 * - {@link awardClassicPrematchForGame} is once-only per (match, guild) by
 *   its `BucksMatchEarning` marker: the marker's primary key is that pair and
 *   its `pending → processing → complete` claim is one guarded update, so a
 *   second caller — a retry, or v1 on the far side of an ownership flip —
 *   finds the marker complete and pays nothing.
 * - {@link openBettingPoolsStrict} is once-only per (match, guild) by
 *   `BucksMatchPool`'s `@@unique([matchId, serverId])`: a repeat create
 *   violates it and reports the standing pool instead of opening another.
 *
 * Those two constraints are what make the effect once-only ACROSS pipelines.
 * The fence and receipt below are what make it once-only within V2 and
 * reportable: a completed claim skips the effect outright, and the receipt
 * says which market the match got so a takeover can finish a dead attempt
 * from the fact rather than by re-running it.
 *
 * ## Why this runs before the notification children start
 *
 * The buttons ARE the market as far as a bettor is concerned, and v1 renders
 * them into the prematch message it sends — it opens the pools first and
 * builds the buttons from the guilds that got one. The V2 message is built by
 * the notification Workflow from durable state (`prematch-notification.ts`
 * reads the pool row for the channel's guild), so the pools have to stand
 * before any child reaches its send. The message refs that let the close
 * sweep and the settlement announcement find the message are recorded after
 * delivery, by `prematch-follow-up.ts`, exactly where v1 records them.
 *
 * ## Why a failure here does not stop the announcement
 *
 * The Workflow treats a failure of this Activity as "this game has no
 * market" and still starts its notification children, which is v1's promise
 * too: a betting bug must never take the loading screen down with it. The
 * difference is that here the failure is retried first, and stays visible as
 * a failed Activity in the history rather than a swallowed log line.
 */

export const PREMATCH_MARKETS_RECEIPT_KIND =
  ReceiptKindSchema.parse("prematch-markets");

/**
 * What market one game got.
 *
 * `guildIds` are sorted so a replay of the same effect produces byte-identical
 * evidence. For `betting-pools` they are the guilds holding a pool for the
 * match; for `classic-participation` the guilds holding a Classic
 * participation marker. Both are read from the rows the effect wrote, not
 * from this attempt's return value, so a resumption that finds the work done
 * attests to the same set the first attempt did.
 */
const PrematchMarketsEvidenceSchema = z.strictObject({
  market: z.enum(["classic-participation", "betting-pools", "none"]),
  guildIds: z.array(DiscordGuildIdSchema),
});
export type PrematchMarketsEvidence = z.infer<
  typeof PrematchMarketsEvidenceSchema
>;
export const prematchMarketsEvidenceCodec = defineVersionedCodec({
  kind: "prematch-markets-evidence",
  version: 1,
  schema: PrematchMarketsEvidenceSchema,
});

/**
 * The guild a delivered prematch channel belongs to, from the subscription
 * that routed the game there.
 *
 * The intent row names a channel and no guild. Reading the guild from the
 * subscription table rather than from Discord keeps it a durable fact every
 * role can read — a gatewayless role can legitimately resolve a channel with
 * no guild attached — and it is the same table the intent's channel came
 * from. A channel whose subscription has since been removed answers `null`.
 */
export async function prematchGuildOfChannel(
  channelId: string,
  database: ExtendedPrismaClient = prisma,
): Promise<DiscordGuildId | null> {
  const subscription = await database.subscription.findFirst({
    where: { channelId: DiscordChannelIdSchema.parse(channelId) },
    select: { serverId: true },
  });
  return subscription === null
    ? null
    : DiscordGuildIdSchema.parse(subscription.serverId);
}

/**
 * The guilds this game is being announced in: the guilds of the channels the
 * capture minted a prematch intent for.
 *
 * v1 derives the same set from the channels it is about to send to, and the
 * V2 capture minted exactly those channels by the same derivation, so reading
 * them back from the intent rows keeps "who gets a market" and "who hears
 * about the game" one answer.
 */
async function announcedGuilds(
  riotMatchId: RiotMatchId,
): Promise<DiscordGuildId[]> {
  const prefix = `${prematchDeliveryKeyPrefix(riotMatchId)}:`;
  const intents = await listIntentsForMatch(prisma, { matchId: riotMatchId });
  const channelIds = intents
    .filter((record) => record.intent.key.startsWith(prefix))
    .flatMap((record) =>
      record.intent.target.kind === "channel"
        ? [record.intent.target.channelId]
        : [],
    );
  if (channelIds.length === 0) return [];
  const subscriptions = await prisma.subscription.findMany({
    where: { channelId: { in: channelIds } },
    select: { serverId: true },
  });
  return [
    ...new Set(
      subscriptions.map((row) => DiscordGuildIdSchema.parse(row.serverId)),
    ),
  ].toSorted();
}

async function classicParticipationGuilds(
  riotMatchId: RiotMatchId,
): Promise<DiscordGuildId[]> {
  const markers = await prisma.bucksMatchEarning.findMany({
    where: { matchId: riotMatchId, phase: "prematch" },
    select: { serverId: true },
  });
  return markers
    .map((marker) => DiscordGuildIdSchema.parse(marker.serverId))
    .toSorted();
}

async function requireArchivedContext(
  riotMatchId: RiotMatchId,
): Promise<ScoutV2PrematchContext> {
  const context = await resumeArchivedPrematchContext(riotMatchId);
  if (context === null) {
    throw ApplicationFailure.nonRetryable(
      `No prematch snapshot was archived for ${riotMatchId}, so there is no game to open a market for`,
      "MissingDomainRecord",
    );
  }
  return context;
}

/**
 * Apply v1's one-of-two Bucks decision for this game, and say what it was.
 *
 * `detectedAt` is this attempt's clock. v1 stamps its own detection instant,
 * and the V2 equivalent is the capture that ran immediately before this
 * Activity; the pool's window is clamped to the game's own start regardless
 * (`computeClosesAt`), and a pool or marker is only ever written once, so a
 * retry's later clock never moves a window a bettor was shown.
 */
async function applyPrematchMarkets(
  context: ScoutV2PrematchContext,
  assertHeld: () => Promise<void>,
): Promise<PrematchMarketsEvidence> {
  const { gameInfo, riotMatchId } = context;
  const queueType = resolveQueueTypeFromGame(
    gameInfo.gameQueueConfigId,
    gameInfo.gameMode,
    gameInfo.gameType,
  );
  const trackedAliasByPuuid = new Map(
    context.trackedPlayers.map((player) => [
      player.league.leagueAccount.puuid,
      player.alias,
    ]),
  );
  const detectedAt = new Date();

  if (queueType === "classic" && isStandardLobby(gameInfo.participants)) {
    // Before any channel is consulted, as in v1: muted, filtered or missing
    // channels must not suppress the one supported Classic reward.
    await assertHeld();
    await awardClassicPrematchForGame({
      matchId: riotMatchId,
      gameInfo,
      trackedAliasByPuuid,
      detectedAt,
    });
    return {
      market: "classic-participation",
      guildIds: await classicParticipationGuilds(riotMatchId),
    };
  }

  const guildIds = await announcedGuilds(riotMatchId);
  if (guildIds.length === 0) return { market: "none", guildIds: [] };
  await assertHeld();
  const opened = await openBettingPoolsStrict({
    matchId: riotMatchId,
    gameInfo,
    queueType,
    guildIds,
    detectedAt,
    trackedAliasByPuuid,
  });
  return opened.size === 0
    ? { market: "none", guildIds: [] }
    : { market: "betting-pools", guildIds: [...opened].toSorted() };
}

/**
 * Open this game's markets, or grant its Classic reward, at most once.
 *
 * The claim key is V2's own, as every V2 guarded effect's is: sharing one
 * with v1 would let one pipeline's completion silently suppress the other's
 * work. Cross-pipeline once-only lives in the row constraints the module doc
 * names, which both pipelines write through.
 */
export async function openPrematchMarketsV2(input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutGuardedEffectV2Result> {
  return await runGuardedEffectV2({
    key: `v2-prematch-markets:${input.riotMatchId}`,
    kind: "v2-prematch-markets",
    alreadyApplied: async () => {
      const standing = await readMatchReceiptEvidenceV2(
        input.riotMatchId,
        PREMATCH_MARKETS_RECEIPT_KIND,
      );
      if (standing === null) return null;
      return {
        fact: { outcome: "already-applied" },
        effects: prematchMarketsEvidenceCodec.parse(standing).guildIds.length,
      };
    },
    apply: async (fence) => {
      const context = await requireArchivedContext(input.riotMatchId);
      const evidence = await applyPrematchMarkets(context, fence.assertHeld);
      logger.info(
        `🎲 Prematch markets for ${input.riotMatchId}: ${evidence.market} in ${String(evidence.guildIds.length)} guild(s)`,
      );
      await fence.assertHeld();
      return {
        fact: await recordMatchReceiptV2({
          matchId: input.riotMatchId,
          kind: PREMATCH_MARKETS_RECEIPT_KIND,
          evidence: prematchMarketsEvidenceCodec.serialize(evidence),
        }),
        effects: evidence.guildIds.length,
      };
    },
  });
}

/**
 * Whether the message to one channel carries its guild's betting buttons.
 *
 * True exactly when the channel's guild holds an OPEN pool for this match,
 * which is v1's rule stated against durable state: v1 attaches buttons for
 * every guild that got a pool when the game was announced. A pool already
 * closed by the time this message is built gets no buttons rather than dead
 * ones; the post-delivery refresh then shows its closed line.
 */
export async function prematchBetsOpenForChannel(
  riotMatchId: RiotMatchId,
  channelId: string,
): Promise<boolean> {
  const guildId = await prematchGuildOfChannel(channelId);
  if (guildId === null) return false;
  const pool = await prisma.bucksMatchPool.findUnique({
    where: { matchId_serverId: { matchId: riotMatchId, serverId: guildId } },
    select: { poolState: true },
  });
  return pool?.poolState === "open";
}
