import { BucksMessageRefsSchema } from "@scout-for-lol/data";
import type { MessageEditOptions } from "discord.js";
import {
  WeeklyParlayDefinitionCriteriaSchema,
  WeeklyParlaySubjectsSchema,
} from "#src/betting/weekly-parlay-criteria.ts";
import {
  countLabel,
  deliveryTimeCopy,
  deliveryTitle,
  legLine,
  weeklyParlayQualificationCopy,
} from "#src/betting/weekly-parlay-discord-copy.ts";
import { weeklyParlayButtons } from "#src/betting/weekly-parlay-discord.ts";
import { isWeeklyParlayCatchupTimeline } from "#src/betting/weekly-parlay-period.ts";
import { runSerialized } from "#src/betting/refresh-queue.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";

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
        periodKey: true,
        bettingClosesAt: true,
        scoringEndsAt: true,
        definition: {
          select: {
            subjects: true,
            criteria: true,
            yesProbabilityBps: true,
            openAt: true,
            bettingClosesAt: true,
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
    const criteria = WeeklyParlayDefinitionCriteriaSchema.parse(
      JSON.parse(market.definition.criteria),
    );
    const aliases = new Map(
      subjects.map((subject) => [subject.key, subject.alias]),
    );
    const catchup = isWeeklyParlayCatchupTimeline({
      periodKey: market.periodKey,
      openAt: market.definition.openAt,
      bettingClosesAt: market.definition.bettingClosesAt,
      scoringStartsAt: market.definition.scoringStartsAt,
      scoringEndsAt: market.definition.scoringEndsAt,
    });
    const legs = criteria.legs.map((leg) =>
      legLine(leg, undefined, aliases.get(leg.subject) ?? leg.subject),
    );
    const qualification = weeklyParlayQualificationCopy(criteria) ?? "";
    const relevantBets = market.bets.filter((bet) =>
      mode === "open"
        ? bet.betOutcome === "pending"
        : bet.betOutcome === "refunded",
    );
    const totalStaked = relevantBets.reduce(
      (total, bet) => total + bet.stake,
      0,
    );
    const content =
      mode === "open"
        ? [
            deliveryTitle({
              kind: "open",
              marketState: market.marketState,
              yesResult: null,
              catchup,
            }),
            `Period: **${market.periodKey}** · ${(market.definition.yesProbabilityBps / 100).toFixed(1)}% YES`,
            ...legs,
            qualification,
            `**${relevantBets.length.toString()} ${countLabel(relevantBets.length, "bettor")} · ${totalStaked.toString()} BB staked**`,
            deliveryTimeCopy({
              kind: "open",
              bettingClosesAt: market.bettingClosesAt,
              scoringEndsAt: market.scoringEndsAt,
              scoringStartsAt: market.definition.scoringStartsAt,
              catchup,
            }),
          ]
            .filter((line) => line.length > 0)
            .join("\n")
        : [
            deliveryTitle({
              kind: "settlement",
              marketState: market.marketState,
              yesResult: null,
              catchup,
              voidReason: market.voidReason,
            }),
            `Period: **${market.periodKey}**`,
            ...legs,
            qualification,
            `**${relevantBets.length.toString()} ${countLabel(relevantBets.length, "bettor")} refunded · ${totalStaked.toString()} BB returned**`,
            "This market was cancelled by an operator.",
          ]
            .filter((line) => line.length > 0)
            .join("\n");
    for (const ref of refs) {
      await editor(ref.channelId, ref.messageId, {
        content,
        allowedMentions: { parse: [] },
        components:
          mode === "open" ? weeklyParlayButtons("open", marketId) : [],
      });
    }
  });
}

/** Edit the original open-market message after a bet or wager cancellation. */
export async function refreshWeeklyParlayMessage(
  marketId: number,
  prismaClient: ExtendedPrismaClient = prisma,
  editor: WeeklyParlayMessageEditor = editDiscordMessage,
): Promise<void> {
  await editWeeklyParlayMessage(marketId, "open", prismaClient, editor);
}

/** Mark the original publication as operator-cancelled and remove all controls. */
export async function cancelWeeklyParlayMessage(
  marketId: number,
  prismaClient: ExtendedPrismaClient = prisma,
  editor: WeeklyParlayMessageEditor = editDiscordMessage,
): Promise<void> {
  await editWeeklyParlayMessage(
    marketId,
    "operator_cancelled",
    prismaClient,
    editor,
  );
}
