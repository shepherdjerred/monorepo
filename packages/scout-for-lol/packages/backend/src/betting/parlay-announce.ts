import * as Sentry from "@sentry/bun";
import {
  BucksMessageRefsSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type BucksParlaySide,
} from "@scout-for-lol/data";
import type { ParlaySettlementSummary } from "#src/betting/parlay-settle.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { splitMessageIntoChunks } from "#src/discord/utils/message.ts";
import { send } from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-parlay-announce");
const MAX_BET_ROWS = 15;

export function formatParlayPlacementAnnouncement(input: {
  discordId: string;
  side: BucksParlaySide;
  stake: number;
  totalStake: number;
  grossPayout: number;
}): string {
  return `🎲 <@${input.discordId}> staked **${input.stake.toString()} BB** on parlay **${input.side}** (position: **${input.totalStake.toString()} BB**, pays **${input.grossPayout.toString()} BB**).`;
}

export async function announceParlayPlacement(
  input: {
    matchId: string;
    serverId: ReturnType<typeof DiscordGuildIdSchema.parse>;
    discordId: string;
    side: BucksParlaySide;
    stake: number;
    totalStake: number;
    grossPayout: number;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  try {
    const market = await prismaClient.bucksParlayMarket.findUnique({
      where: {
        matchId_serverId: { matchId: input.matchId, serverId: input.serverId },
      },
      select: { messageRefs: true },
    });
    if (market === null) return;
    const content = formatParlayPlacementAnnouncement(input);
    const refs = BucksMessageRefsSchema.parse(JSON.parse(market.messageRefs));
    for (const ref of refs) {
      try {
        await send(
          { content, allowedMentions: { users: [input.discordId] } },
          DiscordChannelIdSchema.parse(ref.channelId),
          input.serverId,
        );
      } catch (error) {
        logger.warn(
          `Could not announce parlay placement for ${input.matchId} in ${ref.channelId}:`,
          error,
        );
      }
    }
  } catch (error) {
    logger.error(
      `Could not prepare parlay placement for ${input.matchId}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "betting-parlay-placement-announce",
        matchId: input.matchId,
      },
    });
  }
}

export function formatParlaySettlement(
  summary: ParlaySettlementSummary,
): string {
  const lines = ["🎲 **Bryan Bucks Parlay — Result**"];
  for (const [index, leg] of summary.legs.entries()) {
    lines.push(
      `${leg.passed ? "✅" : "❌"} ${(index + 1).toString()}. ${leg.rendered} — actual **${String(leg.actualValue)}**`,
    );
  }
  if (summary.voidReason === undefined) {
    lines.push(
      "",
      `Overall result: **${summary.yesResult === true ? "YES" : "NO"}**`,
    );
  } else {
    lines.push(
      ``,
      `↩️ Market voided (${summary.voidReason}); all stakes and house reserves were returned.`,
    );
  }
  if (summary.bets.length > 0) {
    lines.push("", "**Positions**");
    for (const bet of summary.bets.slice(0, MAX_BET_ROWS)) {
      lines.push(
        `• <@${bet.discordId}> ${bet.side} ${bet.stake.toString()} BB → ${bet.outcome}, ${bet.payout.toString()} BB`,
      );
    }
    if (summary.bets.length > MAX_BET_ROWS) {
      lines.push(
        `…and ${(summary.bets.length - MAX_BET_ROWS).toString()} more — see \`/bb history\``,
      );
    }
  }
  return lines.join("\n");
}

export function formatParlaySettlementChunks(
  summary: ParlaySettlementSummary,
): string[] {
  return splitMessageIntoChunks(formatParlaySettlement(summary));
}

type SettlementAnnouncementDependencies = {
  sendMessage?: (
    options: Parameters<typeof send>[0],
    channelId: Parameters<typeof send>[1],
    serverId: Parameters<typeof send>[2],
  ) => Promise<unknown>;
};

export async function announceParlaySettlements(
  summaries: readonly ParlaySettlementSummary[],
  dependencies: SettlementAnnouncementDependencies = {},
): Promise<void> {
  const sendMessage = dependencies.sendMessage ?? send;
  for (const summary of summaries) {
    const contents = formatParlaySettlementChunks(summary);
    for (const ref of summary.messageRefs) {
      for (const content of contents) {
        try {
          await sendMessage(
            { content, allowedMentions: { parse: [] } },
            DiscordChannelIdSchema.parse(ref.channelId),
            DiscordGuildIdSchema.parse(summary.serverId),
          );
        } catch (error) {
          logger.error(
            `Could not announce parlay settlement for ${summary.matchId} in ${ref.channelId}:`,
            error,
          );
          Sentry.captureException(error, {
            tags: {
              source: "betting-parlay-settlement-announce",
              matchId: summary.matchId,
              channelId: ref.channelId,
            },
          });
        }
      }
    }
  }
}
