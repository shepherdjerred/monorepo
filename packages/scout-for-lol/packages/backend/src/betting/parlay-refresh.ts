import * as Sentry from "@sentry/bun";
import {
  BucksMessageRefsSchema,
  BucksParlayMarketStateSchema,
  BucksParlaySideSchema,
  BucksParlayVoidReasonSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { BucksMessageEdit } from "#src/betting/message-refresh.ts";
import {
  GeneratedParlaySchema,
  ParlaySubjectsSchema,
} from "#src/betting/parlay-criteria.ts";
import {
  buildParlayContent,
  type ParlayPosition,
} from "#src/betting/parlay-line.ts";
import { buildParlayButtons } from "#src/betting/parlay-components.ts";
import { runSerialized } from "#src/betting/refresh-queue.ts";
import {
  observeBucksDelivery,
  recordBucksDeliverySkip,
} from "#src/betting/delivery-observability.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-parlay-refresh");

const defaultEditMessage: BucksMessageEdit = async (input) => {
  const channel = await client.channels.fetch(input.channelId);
  if (channel?.isTextBased() !== true) {
    throw new Error(
      `Bryan Bucks parlay channel ${input.channelId} is unavailable or not text based`,
    );
  }
  await channel.messages.edit(input.messageId, input.options);
};

function refreshKey(matchId: string, serverId: DiscordGuildId): string {
  return `parlay:${serverId}:${matchId}`;
}

async function refreshOnce(
  input: {
    matchId: string;
    serverId: DiscordGuildId;
    removeComponents: boolean;
  },
  prismaClient: ExtendedPrismaClient,
  editMessage: BucksMessageEdit,
): Promise<void> {
  const market = await prismaClient.bucksParlayMarket.findUnique({
    where: {
      matchId_serverId: { matchId: input.matchId, serverId: input.serverId },
    },
    select: {
      messageRefs: true,
      marketState: true,
      closesAt: true,
      voidReason: true,
      definition: { select: { criteria: true, subjects: true } },
      bets: {
        select: {
          side: true,
          stake: true,
          grossPayout: true,
          bucksAccount: { select: { discordId: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (market === null) {
    recordBucksDeliverySkip({
      surface: "parlay_market",
      operation: "edit",
      reason: "skipped_no_pool",
      matchId: input.matchId,
      serverId: input.serverId,
    });
    return;
  }

  const marketState = BucksParlayMarketStateSchema.parse(market.marketState);
  // The activation outbox owns a publishing message. Refreshing it here would
  // race `activatePendingParlayMarkets` for the same edit, and a publishing
  // market provably holds no positions: both `placeParlayBet` and
  // `cancelParlayBet` require `marketState: "open"`.
  if (marketState === "publishing") {
    return;
  }

  const refs = BucksMessageRefsSchema.parse(JSON.parse(market.messageRefs));
  if (refs.length === 0) {
    recordBucksDeliverySkip({
      surface: "parlay_market",
      operation: "edit",
      reason: "skipped_no_refs",
      matchId: input.matchId,
      serverId: input.serverId,
    });
    return;
  }

  const positions: ParlayPosition[] = market.bets.map((bet) => ({
    discordId: bet.bucksAccount.discordId,
    side: BucksParlaySideSchema.parse(bet.side),
    stake: bet.stake,
    grossPayout: bet.grossPayout,
  }));

  const content = buildParlayContent({
    criteria: GeneratedParlaySchema.parse(
      JSON.parse(market.definition.criteria),
    ),
    subjects: ParlaySubjectsSchema.parse(
      JSON.parse(market.definition.subjects),
    ),
    closesAt: market.closesAt,
    marketState,
    positions,
    voidReason:
      market.voidReason === null
        ? undefined
        : BucksParlayVoidReasonSchema.parse(market.voidReason),
  });

  const components = input.removeComponents
    ? []
    : [buildParlayButtons({ matchId: input.matchId })];

  for (const ref of refs) {
    try {
      await observeBucksDelivery(
        {
          surface: "parlay_market",
          operation: "edit",
          matchId: input.matchId,
          serverId: input.serverId,
          channelId: ref.channelId,
        },
        () =>
          editMessage({
            channelId: DiscordChannelIdSchema.parse(ref.channelId),
            messageId: ref.messageId,
            options: {
              content,
              allowedMentions: { parse: [] },
              components,
            },
          }),
      );
    } catch (error) {
      logger.warn(
        `⚠️ Could not refresh Bryan Bucks parlay message ${ref.messageId} for ${input.matchId}:`,
        error,
      );
    }
  }
}

/**
 * Edit every parlay market message from a fresh database snapshot.
 *
 * This is what lets a parlay placement mutate the market message instead of
 * posting a public receipt per bet, which was ~1.8 extra messages per game.
 */
export async function refreshParlayMessages(
  input: {
    matchId: string;
    serverId: DiscordGuildId;
    removeComponents?: boolean;
  },
  prismaClient: ExtendedPrismaClient = prisma,
  editMessage: BucksMessageEdit = defaultEditMessage,
): Promise<void> {
  await runSerialized(refreshKey(input.matchId, input.serverId), async () => {
    try {
      await refreshOnce(
        {
          matchId: input.matchId,
          serverId: input.serverId,
          removeComponents: input.removeComponents ?? false,
        },
        prismaClient,
        editMessage,
      );
    } catch (error) {
      logger.error(
        `❌ Could not prepare Bryan Bucks parlay refresh for ${input.matchId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-parlay-refresh",
          matchId: input.matchId,
        },
        extra: { serverId: input.serverId },
      });
    }
  });
}

/** Re-render closed, settled, or voided markets with their controls removed. */
export async function refreshClosedParlayMessages(
  closed: readonly { matchId: string; serverId: string }[],
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  for (const market of closed) {
    await refreshParlayMessages(
      {
        matchId: market.matchId,
        serverId: DiscordGuildIdSchema.parse(market.serverId),
        removeComponents: true,
      },
      prismaClient,
    );
  }
}
