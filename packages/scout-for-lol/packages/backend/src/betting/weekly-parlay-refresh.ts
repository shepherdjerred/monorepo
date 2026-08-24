import type { MessageEditOptions } from "discord.js";
import { BucksMessageRefsSchema } from "@scout-for-lol/data";
import {
  WeeklyParlayDefinitionCriteriaSchema,
  WeeklyParlaySubjectsSchema,
} from "#src/betting/weekly-parlay-criteria.ts";
import {
  countLabel,
  deliveryTimeCopy,
  deliveryTitle,
  legLine,
  weeklyParlayButtons,
} from "#src/betting/weekly-parlay-discord.ts";
import { runSerialized } from "#src/betting/refresh-queue.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";

/** Edit the original open-market message after a bet or cancellation. */
export async function refreshWeeklyParlayMessage(
  marketId: number,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  await runSerialized(`weekly:${marketId.toString()}`, async () => {
    const market = await prismaClient.bucksWeeklyParlayMarket.findUnique({
      where: { id: marketId },
      select: {
        messageRefs: true,
        marketState: true,
        periodKey: true,
        bettingClosesAt: true,
        scoringEndsAt: true,
        definition: {
          select: {
            subjects: true,
            criteria: true,
            yesProbabilityBps: true,
          },
        },
        bets: {
          where: { betOutcome: "pending" },
          select: { stake: true },
        },
      },
    });
    if (market?.marketState !== "open") return;
    const refs = BucksMessageRefsSchema.parse(JSON.parse(market.messageRefs));
    if (refs.length === 0) return;
    const subjects = WeeklyParlaySubjectsSchema.parse(
      JSON.parse(market.definition.subjects),
    );
    const criteria = WeeklyParlayDefinitionCriteriaSchema.parse(
      JSON.parse(market.definition.criteria),
    );
    const aliases = new Map(
      subjects.map((subject) => [subject.key, subject.alias]),
    );
    const content = [
      deliveryTitle("open", market.marketState, null),
      `Period: **${market.periodKey}** · ${(market.definition.yesProbabilityBps / 100).toFixed(1)}% YES`,
      ...criteria.legs.map((leg) =>
        legLine(leg, undefined, aliases.get(leg.subject) ?? leg.subject),
      ),
      `**${market.bets.length.toString()} ${countLabel(market.bets.length, "bettor")} · ${market.bets.reduce((total, bet) => total + bet.stake, 0).toString()} BB staked**`,
      deliveryTimeCopy("open", market.bettingClosesAt, market.scoringEndsAt),
    ].join("\n");
    for (const [index, ref] of refs.entries()) {
      const channel = await client.channels.fetch(ref.channelId);
      if (channel?.isTextBased() !== true) {
        throw new Error(
          `Weekly parlay channel ${ref.channelId} is unavailable or not text based`,
        );
      }
      const options: MessageEditOptions = {
        content,
        allowedMentions: { parse: [] },
        components: index === 0 ? weeklyParlayButtons("open", marketId) : [],
      };
      await channel.messages.edit(ref.messageId, options);
    }
  });
}
