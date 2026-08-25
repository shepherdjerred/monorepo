import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageCreateOptions,
} from "discord.js";
import {
  DiscordGuildIdSchema,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import {
  WeeklyParlayContributionSnapshotSchema,
  WeeklyParlayDefinitionCriteriaSchema,
  WeeklyParlaySubjectsSchema,
} from "#src/betting/weekly-parlay-criteria.ts";
import { evaluateWeeklyParlay } from "#src/betting/weekly-parlay-evaluator.ts";
import {
  weeklyParlayDeliveryContent,
  type WeeklyParlayDiscordKind,
} from "#src/betting/weekly-parlay-discord-copy.ts";
import { COMMON_DENOMINATOR_CHANNEL_ID } from "#src/discord/channels.ts";
import { send } from "#src/league/discord/channel.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { formatWeeklyParlayCustomId } from "#src/betting/weekly-parlay-custom-id.ts";
import {
  bettingWeeklyParlayDeliveriesTotal,
  bettingWeeklyParlayMarketsOpenedTotal,
} from "#src/metrics/betting-weekly-parlay.ts";
import { logBucksTransition } from "#src/betting/transition-log.ts";
import { observeBucksDelivery } from "#src/betting/delivery-observability.ts";
import { isWeeklyParlayCatchupTimeline } from "#src/betting/weekly-parlay-period.ts";

export function weeklyParlaySettlementActionKey(marketId: number): string {
  return `settlement:${marketId.toString()}`;
}

export type WeeklyParlayDiscordSender = (
  options: MessageCreateOptions,
  channelId: DiscordChannelId,
  serverId: DiscordGuildId,
) => Promise<{ channelId: string; id: string }>;

function stableNonce(
  marketId: number,
  actionKey: string,
  messageIndex: number,
): string {
  return `ww:${marketId.toString(36)}:${Bun.hash(actionKey).toString(36)}:${messageIndex.toString(36)}`;
}

const MENTIONS_PER_MESSAGE = 20;

export function weeklyParlayButtons(
  kind: WeeklyParlayDiscordKind,
  marketId: number,
): ActionRowBuilder<ButtonBuilder>[] {
  if (kind !== "open" && kind !== "reminder") {
    return [];
  }
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          formatWeeklyParlayCustomId({
            action: "b",
            marketId,
            side: "YES",
            amount: 1,
          }),
        )
        .setLabel("YES · 1 BB")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(
          formatWeeklyParlayCustomId({
            action: "b",
            marketId,
            side: "NO",
            amount: 1,
          }),
        )
        .setLabel("NO · 1 BB")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(
          formatWeeklyParlayCustomId({
            action: "x",
            marketId,
            side: "YES",
            amount: 0,
          }),
        )
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export async function deliverWeeklyParlayDiscord(
  input: {
    marketId: number;
    actionKey: string;
    kind: WeeklyParlayDiscordKind;
    scheduledAt: Date;
  },
  prismaClient: ExtendedPrismaClient = prisma,
  sender: WeeklyParlayDiscordSender = send,
): Promise<"sent" | "already_sent" | "stale"> {
  const market = await prismaClient.bucksWeeklyParlayMarket.findUnique({
    where: { id: input.marketId },
    select: {
      id: true,
      serverId: true,
      periodKey: true,
      slot: true,
      marketState: true,
      yesResult: true,
      voidReason: true,
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
          contributions: { select: { snapshot: true } },
        },
      },
      bets: {
        where: input.kind === "settlement" ? {} : { betOutcome: "pending" },
        select: {
          stake: true,
          bucksAccount: { select: { discordId: true } },
        },
      },
      deliveries: {
        where: { actionKey: input.actionKey },
        select: { deliveryState: true },
      },
    },
  });
  if (market === null) {
    bettingWeeklyParlayDeliveriesTotal.inc({
      kind: input.kind,
      result: "stale",
    });
    return "stale";
  }
  if (market.deliveries[0]?.deliveryState === "delivered") {
    bettingWeeklyParlayDeliveriesTotal.inc({
      kind: input.kind,
      result: "already_sent",
    });
    return "already_sent";
  }
  if (
    input.kind !== "settlement" &&
    (market.marketState === "settled" || market.marketState === "voided")
  ) {
    bettingWeeklyParlayDeliveriesTotal.inc({
      kind: input.kind,
      result: "stale",
    });
    return "stale";
  }
  const isVoidedSettlement =
    input.kind === "settlement" && market.marketState === "voided";
  const includeFrozenSubjects =
    !isVoidedSettlement || market.voidReason === "operator_cancelled";
  const subjects = includeFrozenSubjects
    ? WeeklyParlaySubjectsSchema.parse(JSON.parse(market.definition.subjects))
    : [];
  const criteria = isVoidedSettlement
    ? undefined
    : WeeklyParlayDefinitionCriteriaSchema.parse(
        JSON.parse(market.definition.criteria),
      );
  const evaluation =
    criteria === undefined
      ? undefined
      : evaluateWeeklyParlay(
          criteria,
          z
            .array(WeeklyParlayContributionSnapshotSchema)
            .parse(
              market.definition.contributions.map((row) =>
                JSON.parse(row.snapshot),
              ),
            ),
        );
  const aliases = new Map(
    subjects.map((subject) => [subject.key, subject.alias]),
  );
  const bettorIds = market.bets.map((bet) => bet.bucksAccount.discordId);
  const mentionIds = [
    ...new Set([...subjects.map((subject) => subject.discordId), ...bettorIds]),
  ];
  const totalStaked = market.bets.reduce((total, bet) => total + bet.stake, 0);
  const catchup = isWeeklyParlayCatchupTimeline({
    periodKey: market.periodKey,
    openAt: market.definition.openAt,
    bettingClosesAt: market.definition.bettingClosesAt,
    scoringStartsAt: market.definition.scoringStartsAt,
    scoringEndsAt: market.definition.scoringEndsAt,
  });
  const content = weeklyParlayDeliveryContent({
    kind: input.kind,
    marketState: market.marketState,
    yesResult: market.yesResult,
    voidReason: market.voidReason,
    catchup,
    periodKey: market.periodKey,
    yesProbabilityBps: market.definition.yesProbabilityBps,
    bettingClosesAt: market.bettingClosesAt,
    scoringStartsAt: market.definition.scoringStartsAt,
    scoringEndsAt: market.scoringEndsAt,
    criteria,
    evaluation,
    aliases,
    bettorCount: market.bets.length,
    totalStaked,
  });
  const mentionChunks = Array.from(
    {
      length: Math.max(1, Math.ceil(mentionIds.length / MENTIONS_PER_MESSAGE)),
    },
    (_, index) =>
      mentionIds.slice(
        index * MENTIONS_PER_MESSAGE,
        (index + 1) * MENTIONS_PER_MESSAGE,
      ),
  );
  const options: MessageCreateOptions[] = mentionChunks.map(
    (chunk, messageIndex) => ({
      content:
        messageIndex === 0
          ? [chunk.map((id) => `<@${id}>`).join(" "), content]
              .filter((line) => line.length > 0)
              .join("\n")
          : `Weekly parlay update mentions (continued): ${chunk.map((id) => `<@${id}>`).join(" ")}`,
      allowedMentions: { users: chunk },
      nonce: stableNonce(market.id, input.actionKey, messageIndex),
      enforceNonce: true,
      components:
        messageIndex === 0 ? weeklyParlayButtons(input.kind, market.id) : [],
    }),
  );
  await prismaClient.bucksWeeklyParlayDelivery.upsert({
    where: {
      marketId_actionKey: { marketId: market.id, actionKey: input.actionKey },
    },
    create: {
      marketId: market.id,
      actionKey: input.actionKey,
      kind: input.kind,
      scheduledAt: input.scheduledAt,
      attemptedAt: new Date(),
    },
    update: { attemptedAt: new Date() },
  });
  const refs: { channelId: string; messageId: string }[] = [];
  try {
    for (const messageOptions of options) {
      const message = await observeBucksDelivery(
        {
          surface: "weekly_parlay",
          operation: "send",
          serverId: market.serverId,
          channelId: COMMON_DENOMINATOR_CHANNEL_ID,
        },
        async () =>
          await sender(
            messageOptions,
            COMMON_DENOMINATOR_CHANNEL_ID,
            DiscordGuildIdSchema.parse(market.serverId),
          ),
      );
      refs.push({ channelId: message.channelId, messageId: message.id });
    }
  } catch (error) {
    bettingWeeklyParlayDeliveriesTotal.inc({
      kind: input.kind,
      result: "error",
    });
    throw error;
  }
  const opened = await prismaClient.$transaction(async (tx) => {
    // FIRST write: an open delivery may race start reconciliation or a void.
    // Only the process that still owns publishing may activate the market.
    const marketUpdate = await tx.bucksWeeklyParlayMarket.updateMany({
      where: {
        id: market.id,
        ...(input.kind === "open" ? { marketState: "publishing" } : {}),
      },
      data: {
        messageRefs: JSON.stringify(refs),
        ...(input.kind === "open" ? { marketState: "open" } : {}),
      },
    });
    await tx.bucksWeeklyParlayDelivery.update({
      where: {
        marketId_actionKey: { marketId: market.id, actionKey: input.actionKey },
      },
      data: {
        deliveryState: "delivered",
        deliveredAt: new Date(),
        messageRefs: JSON.stringify(refs),
      },
    });
    return input.kind === "open" && marketUpdate.count === 1;
  });
  bettingWeeklyParlayDeliveriesTotal.inc({ kind: input.kind, result: "sent" });
  if (opened) {
    bettingWeeklyParlayMarketsOpenedTotal.inc();
    logBucksTransition({
      event: "bucks.weekly_parlay.opened",
      serverId: market.serverId,
      marketId: market.id,
      periodKey: market.periodKey,
      slot: market.slot,
      fromState: "publishing",
      toState: "open",
      surface: "cron",
    });
  }
  return "sent";
}
