import * as Sentry from "@sentry/bun";
import type { MessageCreateOptions } from "discord.js";
import {
  BucksMessageRefsSchema,
  BucksPredictionSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type BucksPrediction,
  type DiscordChannelId,
  type DiscordGuildId,
  type RiotTeamId,
} from "@scout-for-lol/data";
import type { EarnedAward } from "#src/betting/earnings.ts";
import { HOUSE_CUT_PLACEMENT_NOTE } from "#src/betting/house-cut.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import type { ClosedPool } from "#src/betting/sweep.ts";
import { shouldDisplayPrediction } from "#src/betting/prediction.ts";
import { teamName } from "#src/betting/team.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { splitMessageIntoChunks } from "#src/discord/utils/message.ts";
import {
  ChannelSendError,
  send as sendChannelMessage,
} from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

const logger = createLogger("betting-announce");
const MAX_SETTLEMENT_CHUNK_SEND_ATTEMPTS = 3;
const SETTLEMENT_CHUNK_RETRY_BASE_DELAY_MS = 500;

/**
 * Telling the channel what happened.
 *
 * Sent as its **own message**, not appended to the match report, for three
 * reasons: the report's `content` is already the AI review's surface and two
 * variable-length appendages competing for 2000 characters is a latent
 * truncation bug; the report is built once and delivered to every guild, while
 * settlement is per guild, so appending would leak one guild's bettors into
 * another's channel; and a settlement failure must not take the report down
 * with it.
 */

/** Beyond this the message stops being readable, so the tail is summarised. */
const MAX_BET_ROWS = 15;

function formatPrediction(raw: string | null): string | undefined {
  if (raw === null) {
    return undefined;
  }
  const parsed = BucksPredictionSchema.safeParse(JSON.parse(raw));
  return parsed.success && shouldDisplayPrediction(parsed.data.winProbability)
    ? parsed.data.sentence
    : undefined;
}

/** The neutral midpoint used to decide which side of a prediction won. */
const COIN_FLIP = 0.5;

/**
 * Score the stored prediction against the result, or return nothing.
 *
 * Near-even calls are declined, not counted as calls the subject loses or
 * wins. Reading them with `> 0.5` alone would turn an uninteresting forecast
 * into a retroactive directional claim.
 */
export function predictionVerdict(
  prediction: BucksPrediction | undefined,
  winningTeamId: number | undefined,
): string | undefined {
  if (
    winningTeamId === undefined ||
    prediction === undefined ||
    !shouldDisplayPrediction(prediction.winProbability)
  ) {
    return undefined;
  }
  const predictedWin = prediction.winProbability > COIN_FLIP;
  const subjectWon = prediction.subjectTeamId === winningTeamId;
  return predictedWin === subjectWon ? "Scout called it." : "Scout was wrong.";
}

export function formatBetPlacementAnnouncement(input: {
  discordId: string;
  teamId: RiotTeamId;
  stake: number;
  totalStake: number;
}): string {
  return `🎲 <@${input.discordId}> staked **${input.stake.toString()} BB** on **${teamName(input.teamId)} to win** (position: **${input.totalStake.toString()} BB**). ${HOUSE_CUT_PLACEMENT_NOTE}`;
}

/**
 * Announce a successful placement in the channels carrying this pool's
 * prematch message. This is deliberately best-effort: the stake is already
 * committed, and a missing public receipt must not turn a successful bet into
 * an interaction error.
 */
export async function announceBetPlacement(
  input: {
    matchId: string;
    serverId: ReturnType<typeof DiscordGuildIdSchema.parse>;
    discordId: string;
    teamId: RiotTeamId;
    stake: number;
    totalStake: number;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  try {
    const pool = await prismaClient.bucksMatchPool.findUnique({
      where: {
        matchId_serverId: {
          matchId: input.matchId,
          serverId: input.serverId,
        },
      },
      select: { messageRefs: true },
    });
    if (pool === null) {
      return;
    }

    const refs = BucksMessageRefsSchema.parse(JSON.parse(pool.messageRefs));
    const content = formatBetPlacementAnnouncement(input);
    for (const ref of refs) {
      try {
        await sendChannelMessage(
          {
            content,
            allowedMentions: { users: [input.discordId] },
          },
          DiscordChannelIdSchema.parse(ref.channelId),
          input.serverId,
        );
      } catch (error) {
        logger.warn(
          `⚠️ Could not announce Bryan Bucks placement for ${input.matchId} in channel ${ref.channelId}:`,
          error,
        );
      }
    }
  } catch (error) {
    logger.error(
      `❌ Could not prepare Bryan Bucks placement announcement for ${input.matchId}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "betting-placement-announce", matchId: input.matchId },
      extra: { serverId: input.serverId },
    });
  }
}

export function formatSettlementBody(input: {
  summary: SettlementSummary;
  earnings: readonly EarnedAward[];
  predictionSentence: string | undefined;
  predictionVerdictLine: string | undefined;
}): string {
  const { summary } = input;
  const lines: string[] = [];
  const pool = summary.bets.reduce((total, bet) => total + bet.stake, 0);

  if (summary.voidReason === undefined) {
    lines.push(
      `💰 **Bryan Bucks** — Pool **${pool.toString()} BB** · house cut **${summary.houseCut.toString()} BB** (winners ${summary.winnersPool.toString()} / losers ${summary.losersPool.toString()})`,
    );
  } else {
    const reason =
      summary.voidReason === "remake"
        ? "Remake — every bet refunded."
        : summary.voidReason === "no_counterparty"
          ? "No takers on the other side — every bet refunded."
          : summary.voidReason === "house_unavailable"
            ? "The Bryan Bucks house reserve was unavailable — every bet refunded."
            : summary.voidReason === "expired"
              ? "This game never resolved — every bet refunded."
              : "Unsupported game mode — every bet refunded.";
    lines.push(
      `💰 **Bryan Bucks** — Pool **${pool.toString()} BB** · house cut **0 BB**. ${reason}`,
    );
  }

  if (input.predictionSentence !== undefined) {
    const verdict =
      input.predictionVerdictLine === undefined
        ? ""
        : ` ${input.predictionVerdictLine}`;
    lines.push(`${input.predictionSentence}${verdict}`);
  }

  const humanBets = summary.bets.filter((bet) => !bet.isHouse);
  const houseBets = summary.bets.filter((bet) => bet.isHouse);

  if (houseBets.length > 0) {
    const houseStake = houseBets.reduce((total, bet) => total + bet.stake, 0);
    lines.push("");
    lines.push(
      "🏦 Bryan Bucks house matched " +
        houseStake.toString() +
        " BB on the other side.",
    );
  }

  if (humanBets.length > 0) {
    lines.push("");
    lines.push("**Bets**");
    for (const bet of humanBets.slice(0, MAX_BET_ROWS)) {
      const result = bet.refunded
        ? `refunded ${bet.payout.toString()} BB (no house cut)`
        : bet.won
          ? `gross ${bet.grossPayout.toString()} BB − ${bet.houseCut.toString()} BB house cut = ${bet.payout.toString()} BB received (+${bet.winnings.toString()} BB net winnings)`
          : "received 0 BB";
      lines.push(
        `• <@${bet.discordId}> staked ${bet.stake.toString()} BB → ${result}`,
      );
    }
    if (humanBets.length > MAX_BET_ROWS) {
      lines.push(
        `…and ${(humanBets.length - MAX_BET_ROWS).toString()} more — see \`/bb history\``,
      );
    }
  }

  const guildEarnings = input.earnings.filter(
    (award) => award.serverId === summary.serverId,
  );
  if (guildEarnings.length > 0) {
    lines.push("");
    for (const award of guildEarnings) {
      lines.push(
        `🪙 **${award.alias}** +${award.total.toString()} BB (${award.reasons.join(", ")})`,
      );
    }
  }

  return lines.join("\n");
}

/** Split a complete settlement without dropping any gross-cut-net detail. */
export function splitSettlementBody(body: string): string[] {
  const chunks = splitMessageIntoChunks(body);
  if (chunks.length === 0) {
    throw new Error("A Bryan Bucks settlement produced no Discord content");
  }
  return chunks;
}

export type SettlementDeliveryDependencies = {
  sendMessage: (
    options: MessageCreateOptions,
    channelId: DiscordChannelId,
    guildId: DiscordGuildId,
  ) => Promise<unknown>;
  sleep: (milliseconds: number) => Promise<void>;
};

const defaultSettlementDeliveryDependencies: SettlementDeliveryDependencies = {
  sendMessage: async (options, channelId, guildId) =>
    await sendChannelMessage(options, channelId, guildId),
  sleep: async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
};

function settlementChunkNonce(
  matchId: string,
  channelId: DiscordChannelId,
  chunkIndex: number,
): string {
  const deliveryKey = `${matchId}:${channelId}:${chunkIndex.toString()}`;
  return `bbs:${Bun.hash(deliveryKey).toString(36)}`;
}

async function sendSettlementChunk(
  dependencies: SettlementDeliveryDependencies,
  input: {
    options: MessageCreateOptions;
    channelId: DiscordChannelId;
    guildId: DiscordGuildId;
    chunkIndex: number;
  },
): Promise<void> {
  for (
    let attempt = 1;
    attempt <= MAX_SETTLEMENT_CHUNK_SEND_ATTEMPTS;
    attempt++
  ) {
    try {
      await dependencies.sendMessage(
        input.options,
        input.channelId,
        input.guildId,
      );
      return;
    } catch (error) {
      const deterministicFailure =
        error instanceof ChannelSendError && error.permissionError;
      if (
        attempt === MAX_SETTLEMENT_CHUNK_SEND_ATTEMPTS ||
        deterministicFailure
      ) {
        throw error;
      }
      const delayMs = SETTLEMENT_CHUNK_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(
        `🎲 Bryan Bucks settlement chunk ${(input.chunkIndex + 1).toString()} attempt ${attempt.toString()}/${MAX_SETTLEMENT_CHUNK_SEND_ATTEMPTS.toString()} failed; retrying in ${delayMs.toString()}ms: ${getErrorMessage(error)}`,
      );
      await dependencies.sleep(delayMs);
    }
  }
}

export async function sendSettlementMessages(
  input: {
    messages: readonly string[];
    matchId: string;
    channelId: string;
    guildId: string;
  },
  dependencies: SettlementDeliveryDependencies = defaultSettlementDeliveryDependencies,
): Promise<void> {
  const channelId = DiscordChannelIdSchema.parse(input.channelId);
  const guildId = DiscordGuildIdSchema.parse(input.guildId);
  const failures: unknown[] = [];
  for (const [chunkIndex, content] of input.messages.entries()) {
    try {
      await sendSettlementChunk(dependencies, {
        options: {
          content,
          // Stable nonces make a transient retry idempotent at Discord.
          nonce: settlementChunkNonce(input.matchId, channelId, chunkIndex),
          enforceNonce: true,
          // A fifteen-person settlement must not ping fifteen people.
          allowedMentions: { parse: [] },
        },
        channelId,
        guildId,
        chunkIndex,
      });
    } catch (error) {
      failures.push(error);
      logger.error(
        `🎲 Bryan Bucks settlement chunk ${(chunkIndex + 1).toString()}/${input.messages.length.toString()} failed after retries: ${getErrorMessage(error)}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Bryan Bucks settlement failed to deliver ${failures.length.toString()}/${input.messages.length.toString()} chunk(s)`,
    );
  }
}

/**
 * Post one settlement message per guild that this pass actually settled.
 *
 * `settleBettingForMatch` returns nothing for a pool another tick already
 * settled, which is what keeps this from announcing twice.
 */
export async function announceSettlements(
  input: {
    matchId: string;
    settlements: readonly SettlementSummary[];
    earnings: readonly EarnedAward[];
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  if (input.settlements.length === 0) {
    return;
  }

  for (const summary of input.settlements) {
    try {
      const pool = await prismaClient.bucksMatchPool.findUnique({
        where: {
          matchId_serverId: {
            matchId: summary.matchId,
            serverId: summary.serverId,
          },
        },
        select: { messageRefs: true, predictionJson: true },
      });
      if (pool === null) {
        continue;
      }

      const predictionSentence = formatPrediction(pool.predictionJson);
      const prediction =
        pool.predictionJson === null
          ? undefined
          : BucksPredictionSchema.safeParse(JSON.parse(pool.predictionJson))
              .data;

      const body = formatSettlementBody({
        summary,
        earnings: input.earnings,
        predictionSentence,
        predictionVerdictLine: predictionVerdict(
          prediction,
          summary.winningTeamId,
        ),
      });
      const messages = splitSettlementBody(body);

      const refs = BucksMessageRefsSchema.parse(JSON.parse(pool.messageRefs));
      if (refs.length === 0) {
        // No recorded message means no destination, and there is no second
        // chance: the pool has committed as settled, so a later pass returns no
        // summary for it. Whoever was owed something here was paid and will
        // never be told. That happens when the prematch message never landed in
        // this guild, or when recording its refs failed outright — which is
        // exactly why `recordPoolMessageRefs` is not the cosmetic write it once
        // claimed to be, and why this is reported rather than shrugged off.
        //
        // Deliberately not redirected to some other channel: the pool's own
        // message is where its bettors are watching, and substituting a guess
        // would post a guild's payouts somewhere nobody opted into. A pool that
        // owed nobody anything is not worth reporting.
        const owedSomeone =
          summary.bets.some((bet) => !bet.isHouse) ||
          input.earnings.some((award) => award.serverId === summary.serverId);
        if (owedSomeone) {
          logger.error(
            `❌ Settled Bryan Bucks pool ${summary.matchId} in guild ${summary.serverId} has no recorded message — the settlement was paid but cannot be announced`,
          );
          Sentry.captureMessage(
            "Bryan Bucks settlement had nowhere to announce",
            {
              level: "error",
              tags: { source: "betting-announce", matchId: summary.matchId },
              extra: { serverId: summary.serverId },
            },
          );
        }
        continue;
      }
      for (const ref of refs) {
        // Isolated per channel. The pool has already committed as settled and a
        // later pass returns no summary, so this delivery is one-shot: letting
        // a stale or no-longer-writable first ref throw would silently discard
        // the settlement for every healthy channel behind it.
        try {
          await sendSettlementMessages({
            messages,
            matchId: summary.matchId,
            channelId: ref.channelId,
            guildId: summary.serverId,
          });
        } catch (error) {
          logger.error(
            `❌ Could not deliver the Bryan Bucks settlement for ${summary.matchId} to channel ${ref.channelId}:`,
            error,
          );
          Sentry.captureException(error, {
            tags: {
              source: "betting-announce",
              matchId: summary.matchId,
              channelId: ref.channelId,
            },
          });
        }
      }
    } catch (error) {
      logger.error(
        `❌ Could not announce Bryan Bucks settlement for ${summary.matchId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "betting-announce", matchId: summary.matchId },
      });
    }
  }
}

/**
 * Grey out the buttons on windows that just closed.
 *
 * Editing a message Scout authored is a PATCH and needs no permission beyond
 * View Channel. The trap would be `channel.messages.fetch(id)` first — a GET,
 * which does require Read Message History, a permission Scout's install URL
 * does not request. `MessageManager#edit(id, options)` issues the PATCH
 * directly, with no preceding fetch.
 *
 * Entirely cosmetic, so every failure is swallowed at warn level.
 */
export async function disableClosedBettingMessages(
  closed: readonly ClosedPool[],
): Promise<void> {
  if (closed.length === 0) {
    return;
  }

  for (const pool of closed) {
    for (const ref of pool.messageRefs) {
      try {
        const channel = await client.channels.fetch(ref.channelId);
        if (channel?.isTextBased() !== true) {
          continue;
        }
        // Only `components` is passed, so the loading-screen attachment and
        // embed are left untouched — Discord leaves omitted fields alone.
        await channel.messages.edit(ref.messageId, { components: [] });
      } catch (error) {
        logger.warn(
          `⚠️ Could not disable Bryan Bucks buttons on ${ref.messageId}:`,
          error,
        );
      }
    }
  }
}
