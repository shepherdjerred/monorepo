import * as Sentry from "@sentry/bun";
import {
  BucksMessageRefsSchema,
  DiscordGuildIdSchema,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { MessageCreateOptions, MessageEditOptions } from "discord.js";
import {
  WeeklyParlayDefinitionCriteriaSchema,
  WeeklyParlaySubjectsSchema,
} from "#src/betting/weekly-parlay-criteria.ts";
import { observeBucksDelivery } from "#src/betting/delivery-observability.ts";
import { weeklyParlayDeliveryContent } from "#src/betting/weekly-parlay-discord-copy.ts";
import { weeklyParlayMessageOptions } from "#src/betting/weekly-parlay-discord.ts";
import type { WeeklyParlayDiscordSender } from "#src/betting/weekly-parlay-discord.ts";
import { runSerialized } from "#src/betting/refresh-queue.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { COMMON_DENOMINATOR_CHANNEL_ID } from "#src/discord/channels.ts";
import { send } from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-weekly-parlay-refresh");

export type WeeklyParlayMessageEditor = (
  channelId: string,
  messageId: string,
  options: MessageEditOptions,
) => Promise<void>;

type WeeklyParlayMessageRef = { channelId: string; messageId: string };

type WeeklyParlayMessageDependencies = {
  sender: WeeklyParlayDiscordSender;
  deleter: (channelId: string, messageId: string) => Promise<void>;
};

type WeeklyParlayMessageDelivery = WeeklyParlayMessageDependencies & {
  editor: WeeklyParlayMessageEditor;
};

type ReconcileWeeklyParlayMessageArgs = {
  ref: WeeklyParlayMessageRef | undefined;
  messageOptions: MessageCreateOptions | undefined;
  marketIdentifier: string;
  serverId: string;
  editor: WeeklyParlayMessageEditor;
  dependencies: WeeklyParlayMessageDependencies;
};

async function sendDiscordMessage(
  options: MessageCreateOptions,
  channelId: DiscordChannelId,
  serverId: DiscordGuildId,
): Promise<{ channelId: string; id: string }> {
  const message = await send(
    options,
    channelId,
    DiscordGuildIdSchema.parse(serverId),
  );
  return { channelId: message.channelId, id: message.id };
}

async function deleteDiscordMessage(
  channelId: string,
  messageId: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (channel?.isTextBased() !== true) {
    throw new Error(
      `Weekly parlay channel ${channelId} is unavailable or not text based`,
    );
  }
  await channel.messages.delete(messageId);
}

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

async function reconcileWeeklyParlayMessage({
  ref,
  messageOptions,
  marketIdentifier,
  serverId,
  editor,
  dependencies,
}: ReconcileWeeklyParlayMessageArgs): Promise<
  WeeklyParlayMessageRef | undefined
> {
  if (messageOptions === undefined) {
    if (ref === undefined) {
      return undefined;
    }
    try {
      await dependencies.deleter(ref.channelId, ref.messageId);
      return undefined;
    } catch (error) {
      logger.warn(
        `⚠️ Could not remove stale weekly Bryan Bucks parlay message ${ref.messageId} for ${marketIdentifier}:`,
        error,
      );
      return ref;
    }
  }

  const content = messageOptions.content;
  if (content === undefined) {
    throw new Error("Weekly parlay message content is required for refresh");
  }
  const editOptions: MessageEditOptions = { content };
  if (messageOptions.allowedMentions !== undefined) {
    editOptions.allowedMentions = messageOptions.allowedMentions;
  }
  if (messageOptions.components !== undefined) {
    editOptions.components = messageOptions.components;
  }
  try {
    if (ref === undefined) {
      const message = await observeBucksDelivery(
        {
          surface: "weekly_parlay",
          operation: "send",
          matchId: marketIdentifier,
          channelId: COMMON_DENOMINATOR_CHANNEL_ID,
        },
        () =>
          dependencies.sender(
            messageOptions,
            COMMON_DENOMINATOR_CHANNEL_ID,
            DiscordGuildIdSchema.parse(serverId),
          ),
      );
      return { channelId: message.channelId, messageId: message.id };
    }
    await observeBucksDelivery(
      {
        surface: "weekly_parlay",
        operation: "edit",
        matchId: marketIdentifier,
        channelId: ref.channelId,
      },
      () => editor(ref.channelId, ref.messageId, editOptions),
    );
    return ref;
  } catch (error) {
    logger.warn(
      `⚠️ Could not refresh weekly Bryan Bucks parlay message ${ref?.messageId ?? "new chunk"} for ${marketIdentifier}:`,
      error,
    );
    return ref;
  }
}

const defaultWeeklyParlayMessageDependencies: WeeklyParlayMessageDependencies =
  {
    sender: sendDiscordMessage,
    deleter: deleteDiscordMessage,
  };

async function editWeeklyParlayMessage(
  marketId: number,
  mode: "open" | "operator_cancelled",
  prismaClient: ExtendedPrismaClient,
  delivery: WeeklyParlayMessageDelivery,
): Promise<void> {
  await runSerialized(`weekly:${marketId.toString()}`, async () => {
    const market = await prismaClient.bucksWeeklyParlayMarket.findUnique({
      where: { id: marketId },
      select: {
        serverId: true,
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
          select: {
            stake: true,
            betOutcome: true,
            bucksAccount: { select: { discordId: true } },
          },
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
    const bettorIds = relevantBets.map((bet) => bet.bucksAccount.discordId);
    const mentionIds = [
      ...new Set([
        ...subjects.map((subject) => subject.discordId),
        ...bettorIds,
      ]),
    ];
    const messageOptions = weeklyParlayMessageOptions({
      marketId,
      actionKey: `refresh:${mode}`,
      kind: mode === "open" ? "open" : "settlement",
      content,
      mentionIds,
    });
    const marketIdentifier = `weekly:${marketId.toString()}`;
    const updatedRefs: WeeklyParlayMessageRef[] = [];
    const operationCount = Math.max(refs.length, messageOptions.length);
    for (const index of Array.from(
      { length: operationCount },
      (_, value) => value,
    )) {
      const updatedRef = await reconcileWeeklyParlayMessage({
        ref: refs[index],
        messageOptions: messageOptions[index],
        marketIdentifier,
        serverId: market.serverId,
        editor: delivery.editor,
        dependencies: delivery,
      });
      if (updatedRef !== undefined) {
        updatedRefs.push(updatedRef);
      }
    }
    await prismaClient.bucksWeeklyParlayMarket.update({
      where: { id: marketId },
      data: { messageRefs: JSON.stringify(updatedRefs) },
    });
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
  dependencies: WeeklyParlayMessageDependencies = defaultWeeklyParlayMessageDependencies,
): Promise<void> {
  try {
    await editWeeklyParlayMessage(marketId, "open", prismaClient, {
      editor,
      ...dependencies,
    });
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
  dependencies: WeeklyParlayMessageDependencies = defaultWeeklyParlayMessageDependencies,
): Promise<void> {
  try {
    await editWeeklyParlayMessage(
      marketId,
      "operator_cancelled",
      prismaClient,
      { editor, ...dependencies },
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
