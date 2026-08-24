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
  type WeeklyParlayLeg,
} from "#src/betting/weekly-parlay-criteria.ts";
import { evaluateWeeklyParlay } from "#src/betting/weekly-parlay-evaluator.ts";
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

export type WeeklyParlayDiscordKind =
  "open" | "reminder" | "progress" | "settlement";

export function weeklyParlaySettlementActionKey(marketId: number): string {
  return `settlement:${marketId.toString()}`;
}

export async function refreshWeeklyParlayMessage(
  marketId: number,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const market = await prismaClient.bucksWeeklyParlayMarket.findUniqueOrThrow({
    where: { id: marketId },
    select: { updatedAt: true },
  });
  await deliverWeeklyParlayDiscord(
    {
      marketId,
      actionKey: `mutation:${marketId.toString()}:${market.updatedAt.getTime().toString()}`,
      kind: "reminder",
      scheduledAt: market.updatedAt,
    },
    prismaClient,
  );
}

export type WeeklyParlayDiscordSender = (
  options: MessageCreateOptions,
  channelId: DiscordChannelId,
  serverId: DiscordGuildId,
) => Promise<{ channelId: string; id: string }>;

function operatorCopy(leg: WeeklyParlayLeg): string {
  switch (leg.operator) {
    case "gte":
      return "at least";
    case "lte":
      return "at most";
    case "eq":
      return "exactly";
  }
}

function metricCopy(leg: WeeklyParlayLeg): string {
  switch (leg.kind) {
    case "aggregate":
    case "rate":
      return leg.metric
        .replaceAll("_x100", "")
        .replaceAll("_bps", "")
        .replaceAll("_", " ");
    case "champion_games":
      return `${leg.winsOnly ? "wins" : "games"} on ${leg.champion}`;
    case "role_games":
      return `${leg.winsOnly ? "wins" : "games"} as ${leg.role.toLowerCase()}`;
  }
}

function metricValue(leg: WeeklyParlayLeg, value: number): string {
  if (leg.kind === "rate") {
    if (leg.metric === "win_rate_bps") {
      return `${(value / 100).toFixed(1)}%`;
    }
    if (leg.metric.endsWith("_x100")) {
      return (value / 100).toFixed(2);
    }
  }
  return value.toLocaleString("en-US");
}

function legLine(
  leg: WeeklyParlayLeg,
  current: number | undefined,
  subjectAlias: string,
): string {
  const progress =
    current === undefined
      ? ""
      : ` — **${metricValue(leg, current)} / ${metricValue(leg, leg.threshold)}**`;
  return `• **${subjectAlias}** ${operatorCopy(leg)} **${metricValue(leg, leg.threshold)} ${metricCopy(leg)}**${progress}`;
}

function stableNonce(
  marketId: number,
  actionKey: string,
  messageIndex: number,
): string {
  return `ww:${marketId.toString(36)}:${Bun.hash(actionKey).toString(36)}:${messageIndex.toString(36)}`;
}

const MENTIONS_PER_MESSAGE = 20;

function deliveryTitle(
  kind: WeeklyParlayDiscordKind,
  marketState: string,
  yesResult: boolean | null,
): string {
  switch (kind) {
    case "open":
      return "📅 **Weekly Bryan Bucks parlay is open**";
    case "reminder":
      return "⏰ **Weekly parlay betting reminder**";
    case "progress":
      return "📈 **Weekly parlay progress**";
    case "settlement":
      if (marketState === "voided") {
        return "↩️ **Weekly parlay refunded**";
      }
      return yesResult === true
        ? "✅ **Weekly parlay settled YES**"
        : "❌ **Weekly parlay settled NO**";
  }
}

function currentLegValue(
  kind: WeeklyParlayDiscordKind,
  current: number,
): number | undefined {
  return kind === "open" || kind === "reminder" ? undefined : current;
}

function deliveryTimeCopy(
  kind: WeeklyParlayDiscordKind,
  bettingClosesAt: Date,
  scoringEndsAt: Date,
): string {
  if (kind === "open" || kind === "reminder") {
    return `Betting closes <t:${Math.floor(bettingClosesAt.getTime() / 1000).toString()}:R>. Use this message's buttons so your market is unambiguous.`;
  }
  return `Final cutoff <t:${Math.floor(scoringEndsAt.getTime() / 1000).toString()}:F>.`;
}

function weeklyParlayButtons(
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
  const subjects = isVoidedSettlement
    ? []
    : WeeklyParlaySubjectsSchema.parse(JSON.parse(market.definition.subjects));
  const evaluation = isVoidedSettlement
    ? undefined
    : evaluateWeeklyParlay(
        WeeklyParlayDefinitionCriteriaSchema.parse(
          JSON.parse(market.definition.criteria),
        ),
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
  const legs =
    evaluation?.legs.map((result) =>
      legLine(
        result.leg,
        currentLegValue(input.kind, result.current),
        aliases.get(result.leg.subject) ?? result.leg.subject,
      ),
    ) ?? [];
  const bettorIds = market.bets.map((bet) => bet.bucksAccount.discordId);
  const mentionIds = [
    ...new Set([...subjects.map((subject) => subject.discordId), ...bettorIds]),
  ];
  const totalStaked = market.bets.reduce((total, bet) => total + bet.stake, 0);
  const content = [
    deliveryTitle(input.kind, market.marketState, market.yesResult),
    ...(isVoidedSettlement
      ? [`Reason: **${market.voidReason ?? "unknown"}**`]
      : []),
    `Period: **${market.periodKey}** · ${(market.definition.yesProbabilityBps / 100).toFixed(1)}% YES`,
    ...legs,
    `**${market.bets.length.toString()} bettors · ${totalStaked.toString()} BB staked**`,
    deliveryTimeCopy(input.kind, market.bettingClosesAt, market.scoringEndsAt),
  ]
    .filter((line) => line.length > 0)
    .join("\n");
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
