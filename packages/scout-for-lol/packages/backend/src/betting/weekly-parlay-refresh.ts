import * as Sentry from "@sentry/bun";
import { BucksMessageRefsSchema } from "@scout-for-lol/data";
import type { MessageEditOptions } from "discord.js";
import {
  WeeklyParlayDefinitionCriteriaSchema,
  WeeklyParlaySubjectsSchema,
} from "#src/betting/weekly-parlay-criteria.ts";
import { observeBucksDelivery } from "#src/betting/delivery-observability.ts";
import { weeklyParlayDeliveryContent } from "#src/betting/weekly-parlay-discord-copy.ts";
import { weeklyParlayButtons } from "#src/betting/weekly-parlay-discord.ts";
import { runSerialized } from "#src/betting/refresh-queue.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-weekly-parlay-refresh");

export type WeeklyParlayMessageEditor = (
  channelId: string,
  messageId: string,
  options: MessageEditOptions,
) => Promise<void>;

async function editDiscordMessage(
  channelId: string,
  messageId: string,
  options: MessageEditOptions,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (channel?.isTextBased() !== true) {
    throw new Error(
      `Weekly parlay channel ${channelId} is unavailable or not text based`,
    );
  }
  await channel.messages.edit(messageId, options);
}

async function editWeeklyParlayMessage(
  marketId: number,
  mode: "open" | "operator_cancelled",
  prismaClient: ExtendedPrismaClient,
  editor: WeeklyParlayMessageEditor,
): Promise<void> {
  await runSerialized(`weekly:${marketId.toString()}`, async () => {
    const market = await prismaClient.bucksWeeklyParlayMarket.findUnique({
      where: { id: marketId },
      select: {
        messageRefs: true,
        marketState: true,
        voidReason: true,
        bettingClosesAt: true,
        scoringEndsAt: true,
        definition: {
          select: {
            subjects: true,
            criteria: true,
            scoringStartsAt: true,
            scoringEndsAt: true,
          },
        },
        bets: {
          select: { stake: true, betOutcome: true },
          orderBy: { id: "asc" },
        },
        deliveries: {
          where: { kind: "open", deliveryState: "delivered" },
          select: { messageRefs: true },
          orderBy: { id: "asc" },
          take: 1,
        },
      },
    });
    if (market === null) {
      return;
    }
    if (
      (mode === "open" && market.marketState !== "open") ||
      (mode === "operator_cancelled" &&
        (market.marketState !== "voided" ||
          market.voidReason !== "operator_cancelled"))
    ) {
      return;
    }
    const refsJson =
      mode === "open"
        ? market.messageRefs
        : (market.deliveries[0]?.messageRefs ?? "[]");
    const refs = BucksMessageRefsSchema.parse(JSON.parse(refsJson));
    if (refs.length === 0) {
      return;
    }
    const subjects = WeeklyParlaySubjectsSchema.parse(
      JSON.parse(market.definition.subjects),
    );
    const criteria =
      mode === "open"
        ? WeeklyParlayDefinitionCriteriaSchema.parse(
            JSON.parse(market.definition.criteria),
          )
        : undefined;
    const aliases = new Map(
      subjects.map((subject) => [subject.key, subject.alias]),
    );
    const relevantBets = market.bets.filter((bet) =>
      mode === "open"
        ? bet.betOutcome === "pending"
        : bet.betOutcome === "refunded",
    );
    const totalStaked = relevantBets.reduce(
      (total, bet) => total + bet.stake,
      0,
    );
    const content = weeklyParlayDeliveryContent({
      kind: mode === "open" ? "open" : "settlement",
      marketState: market.marketState,
      yesResult: null,
      voidReason: market.voidReason,
      bettingClosesAt: market.bettingClosesAt,
      scoringStartsAt: market.definition.scoringStartsAt,
      scoringEndsAt: market.scoringEndsAt,
      criteria,
      evaluation: undefined,
      aliases,
      bettorCount: relevantBets.length,
      totalStaked,
    });
    const marketIdentifier = `weekly:${marketId.toString()}`;
    for (const ref of refs) {
      try {
        await observeBucksDelivery(
          {
            surface: "weekly_parlay",
            operation: "edit",
            matchId: marketIdentifier,
            channelId: ref.channelId,
          },
          () =>
            editor(ref.channelId, ref.messageId, {
              content,
              allowedMentions: { parse: [] },
              components:
                mode === "open" ? weeklyParlayButtons("open", marketId) : [],
            }),
        );
      } catch (error) {
        logger.warn(
          `⚠️ Could not refresh weekly Bryan Bucks parlay message ${ref.messageId} for ${marketIdentifier}:`,
          error,
        );
      }
    }
  });
}

/**
 * Edit the original open-market message after a bet or wager cancellation.
 *
 * The stake debit has already committed by the time a caller reaches this,
 * so a Discord failure here must never propagate: doing so would surface an
 * error to a web caller for a bet that was already placed, inviting a retry
 * that tops up the same position and debits the requested amount again.
 */
export async function refreshWeeklyParlayMessage(
  marketId: number,
  prismaClient: ExtendedPrismaClient = prisma,
  editor: WeeklyParlayMessageEditor = editDiscordMessage,
): Promise<void> {
  try {
    await editWeeklyParlayMessage(marketId, "open", prismaClient, editor);
  } catch (error) {
    logger.error(
      `❌ Could not prepare weekly Bryan Bucks parlay refresh for market ${marketId.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "betting-weekly-parlay-refresh" },
      extra: { marketId },
    });
  }
}

/** Mark the original publication as operator-cancelled and remove all controls. */
export async function cancelWeeklyParlayMessage(
  marketId: number,
  prismaClient: ExtendedPrismaClient = prisma,
  editor: WeeklyParlayMessageEditor = editDiscordMessage,
): Promise<void> {
  try {
    await editWeeklyParlayMessage(
      marketId,
      "operator_cancelled",
      prismaClient,
      editor,
    );
  } catch (error) {
    logger.error(
      `❌ Could not prepare weekly Bryan Bucks parlay cancellation refresh for market ${marketId.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "betting-weekly-parlay-refresh" },
      extra: { marketId },
    });
  }
}
