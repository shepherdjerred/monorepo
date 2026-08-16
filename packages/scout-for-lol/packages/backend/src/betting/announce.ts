import * as Sentry from "@sentry/bun";
import {
  BucksMessageRefsSchema,
  BucksPredictionSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type BucksPrediction,
} from "@scout-for-lol/data";
import type { EarnedAward } from "#src/betting/earnings.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import type { ClosedPool } from "#src/betting/sweep.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { send } from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-announce");

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
const MAX_PAYOUT_ROWS = 15;

function formatPrediction(raw: string | null): string | undefined {
  if (raw === null) {
    return undefined;
  }
  const parsed = BucksPredictionSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data.sentence : undefined;
}

function predictionVerdict(
  prediction: BucksPrediction | undefined,
  winningTeamId: number | undefined,
): string | undefined {
  if (winningTeamId === undefined || prediction === undefined) {
    return undefined;
  }
  const predictedWin = prediction.winProbability > 0.5;
  const subjectWon = prediction.subjectTeamId === winningTeamId;
  return predictedWin === subjectWon ? "Scout called it." : "Scout was wrong.";
}

function formatSettlementBody(input: {
  summary: SettlementSummary;
  earnings: readonly EarnedAward[];
  predictionSentence: string | undefined;
  predictionVerdictLine: string | undefined;
}): string {
  const { summary } = input;
  const lines: string[] = [];

  if (summary.voidReason === undefined) {
    lines.push(
      `💰 **Bryan Bucks** — pool ${(summary.winnersPool + summary.losersPool).toString()} BB (winners ${summary.winnersPool.toString()} / losers ${summary.losersPool.toString()})`,
    );
  } else {
    const reason =
      summary.voidReason === "remake"
        ? "Remake — every bet refunded."
        : summary.voidReason === "no_counterparty"
          ? "No takers on the other side — every bet refunded."
          : summary.voidReason === "expired"
            ? "This game never resolved — every bet refunded."
            : "Unsupported game mode — every bet refunded.";
    lines.push(`💰 **Bryan Bucks** — ${reason}`);
  }

  if (input.predictionSentence !== undefined) {
    const verdict =
      input.predictionVerdictLine === undefined
        ? ""
        : ` ${input.predictionVerdictLine}`;
    lines.push(`${input.predictionSentence}${verdict}`);
  }

  const paid = summary.bets.filter((bet) => bet.payout > 0);
  if (paid.length > 0) {
    lines.push("");
    for (const bet of paid.slice(0, MAX_PAYOUT_ROWS)) {
      const delta = bet.refunded
        ? `refunded ${bet.payout.toString()} BB`
        : `+${bet.winnings.toString()} BB`;
      lines.push(`• staked ${bet.stake.toString()} BB → ${delta}`);
    }
    if (paid.length > MAX_PAYOUT_ROWS) {
      lines.push(
        `…and ${(paid.length - MAX_PAYOUT_ROWS).toString()} more — see \`/bb history\``,
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

      const refs = BucksMessageRefsSchema.parse(JSON.parse(pool.messageRefs));
      const guildId = DiscordGuildIdSchema.parse(summary.serverId);

      for (const ref of refs) {
        await send(
          {
            content: body,
            // A fifteen-person settlement must not ping fifteen people.
            allowedMentions: { parse: [] },
          },
          DiscordChannelIdSchema.parse(ref.channelId),
          guildId,
        );
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
