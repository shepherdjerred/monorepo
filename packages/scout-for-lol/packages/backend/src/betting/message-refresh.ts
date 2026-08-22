import * as Sentry from "@sentry/bun";
import type { MessageEditOptions } from "discord.js";
import {
  BucksMessageRefsSchema,
  BucksPoolRosterSchema,
  BucksPoolStateSchema,
  BucksPredictionSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  RiotTeamIdSchema,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  withBucksDigest,
  digestBudgetFor,
  bucksPrematchSummary,
  type BucksPrematchPosition,
} from "#src/betting/prematch-line.ts";
import { bettingAnchor, subjectFraming } from "#src/betting/components.ts";
import { runSerialized } from "#src/betting/refresh-queue.ts";
import {
  observeBucksDelivery,
  recordBucksDeliverySkip,
} from "#src/betting/delivery-observability.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-message-refresh");

export type BucksMessageEdit = (input: {
  channelId: DiscordChannelId;
  messageId: string;
  options: MessageEditOptions;
}) => Promise<void>;

const defaultEditMessage: BucksMessageEdit = async (input) => {
  const channel = await client.channels.fetch(input.channelId);
  if (channel?.isTextBased() !== true) {
    throw new Error(
      `Bryan Bucks message channel ${input.channelId} is unavailable or not text based`,
    );
  }
  await channel.messages.edit(input.messageId, input.options);
};

function refreshKey(matchId: string, serverId: DiscordGuildId): string {
  return `pool:${serverId}:${matchId}`;
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
  const pool = await prismaClient.bucksMatchPool.findUnique({
    where: {
      matchId_serverId: {
        matchId: input.matchId,
        serverId: input.serverId,
      },
    },
    select: {
      messageRefs: true,
      prematchContentBase: true,
      poolState: true,
      predictionJson: true,
      roster: true,
      closesAt: true,
      bets: {
        select: {
          id: true,
          predictedTeamId: true,
          stake: true,
          matchedStake: true,
          unmatchedStake: true,
          betOutcome: true,
          bucksAccount: {
            select: { discordId: true, isHouse: true },
          },
        },
        orderBy: [{ predictedTeamId: "asc" }, { id: "asc" }],
      },
    },
  });
  if (pool === null) {
    recordBucksDeliverySkip({
      surface: "prematch",
      operation: "edit",
      reason: "skipped_no_pool",
      matchId: input.matchId,
      serverId: input.serverId,
    });
    return;
  }
  if (pool.prematchContentBase === null) {
    // Expected forever for pools created before this column existed.
    recordBucksDeliverySkip({
      surface: "prematch",
      operation: "edit",
      reason: "skipped_no_base",
      matchId: input.matchId,
      serverId: input.serverId,
    });
    return;
  }

  const refs = BucksMessageRefsSchema.parse(JSON.parse(pool.messageRefs));
  if (refs.length === 0) {
    // Follows a failed recordPoolMessageRefs, and is the leading indicator of
    // "settlement had nowhere to announce".
    recordBucksDeliverySkip({
      surface: "prematch",
      operation: "edit",
      reason: "skipped_no_refs",
      matchId: input.matchId,
      serverId: input.serverId,
    });
    return;
  }
  const prediction =
    pool.predictionJson === null
      ? undefined
      : BucksPredictionSchema.parse(JSON.parse(pool.predictionJson));
  const poolState = BucksPoolStateSchema.parse(pool.poolState);
  const currentBets = pool.bets.filter((bet) => bet.betOutcome !== "cancelled");
  const positions: BucksPrematchPosition[] = pool.bets
    .filter(
      (bet) => bet.betOutcome !== "cancelled" && !bet.bucksAccount.isHouse,
    )
    .map((bet) => ({
      discordId: bet.bucksAccount.discordId,
      teamId: RiotTeamIdSchema.parse(bet.predictedTeamId),
      offeredStake: bet.stake,
      matchedStake: bet.matchedStake,
      unmatchedStake: bet.unmatchedStake,
    }));
  const houseBets = currentBets.filter((bet) => bet.bucksAccount.isHouse);
  if (poolState === "open" && houseBets.length > 0) {
    throw new Error(`Open Bryan Bucks pool ${input.matchId} has a house bet`);
  }
  const houseMatches = houseBets.map((bet) => {
    if (bet.matchedStake === null) {
      throw new Error(
        `House bet ${bet.id.toString()} in ${input.matchId} has no matched stake`,
      );
    }
    return {
      teamId: RiotTeamIdSchema.parse(bet.predictedTeamId),
      matchedStake: bet.matchedStake,
    };
  });
  const anchor = bettingAnchor(
    BucksPoolRosterSchema.parse(JSON.parse(pool.roster)).participants,
  );
  const content = withBucksDigest(
    pool.prematchContentBase,
    bucksPrematchSummary({
      prediction,
      poolState,
      positions,
      houseMatches,
      framing: anchor === undefined ? undefined : subjectFraming(anchor),
      closesAt: pool.closesAt,
      maxLength: digestBudgetFor(pool.prematchContentBase),
    }),
  );

  for (const ref of refs) {
    try {
      await observeBucksDelivery(
        {
          surface: "prematch",
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
              ...(input.removeComponents ? { components: [] } : {}),
            },
          }),
      );
    } catch (error) {
      logger.warn(
        `⚠️ Could not refresh Bryan Bucks message ${ref.messageId} for ${input.matchId}:`,
        error,
      );
    }
  }
}

/**
 * Edit every prematch message for a pool from a fresh database snapshot.
 *
 * The per-pool tail prevents an older refresh from landing after a newer one.
 * Every queued pass loads state only after the prior edit completes, so a
 * concurrent placement or cancellation is reflected by the final PATCH.
 */
export async function refreshBucksMessages(
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
        `❌ Could not prepare Bryan Bucks message refresh for ${input.matchId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "betting-message-refresh",
          matchId: input.matchId,
        },
        extra: { serverId: input.serverId },
      });
    }
  });
}

export async function refreshClosedBucksMessages(
  closed: readonly { matchId: string; serverId: string }[],
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  for (const pool of closed) {
    await refreshBucksMessages(
      {
        matchId: pool.matchId,
        serverId: DiscordGuildIdSchema.parse(pool.serverId),
        removeComponents: true,
      },
      prismaClient,
    );
  }
}
