import * as Sentry from "@sentry/bun";
import type { MessageEditOptions } from "discord.js";
import {
  BucksMessageRefsSchema,
  BucksPoolStateSchema,
  BucksPredictionSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  RiotTeamIdSchema,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  appendBucksLine,
  bucksPrematchSummary,
  type BucksPrematchPosition,
} from "#src/betting/prematch-line.ts";
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

const refreshTails = new Map<string, Promise<void>>();

function refreshKey(matchId: string, serverId: DiscordGuildId): string {
  return `${serverId}:${matchId}`;
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
      bets: {
        select: {
          id: true,
          predictedTeamId: true,
          stake: true,
          bucksAccount: {
            select: { discordId: true, isHouse: true },
          },
        },
        orderBy: [{ predictedTeamId: "asc" }, { id: "asc" }],
      },
    },
  });
  if (pool === null) {
    return;
  }
  if (pool.prematchContentBase === null) {
    return;
  }

  const refs = BucksMessageRefsSchema.parse(JSON.parse(pool.messageRefs));
  if (refs.length === 0) {
    return;
  }
  const prediction =
    pool.predictionJson === null
      ? undefined
      : BucksPredictionSchema.parse(JSON.parse(pool.predictionJson));
  const positions: BucksPrematchPosition[] = pool.bets
    .filter((bet) => !bet.bucksAccount.isHouse)
    .map((bet) => ({
      discordId: bet.bucksAccount.discordId,
      teamId: RiotTeamIdSchema.parse(bet.predictedTeamId),
      stake: bet.stake,
    }));
  const content = appendBucksLine(
    pool.prematchContentBase,
    bucksPrematchSummary({
      prediction,
      poolState: BucksPoolStateSchema.parse(pool.poolState),
      positions,
    }),
  );

  for (const ref of refs) {
    try {
      await editMessage({
        channelId: DiscordChannelIdSchema.parse(ref.channelId),
        messageId: ref.messageId,
        options: {
          content,
          allowedMentions: { parse: [] },
          ...(input.removeComponents ? { components: [] } : {}),
        },
      });
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
  const key = refreshKey(input.matchId, input.serverId);
  const prior = refreshTails.get(key) ?? Promise.resolve();
  const current = (async () => {
    await prior;
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
  })();
  refreshTails.set(key, current);
  try {
    await current;
  } finally {
    if (refreshTails.get(key) === current) {
      refreshTails.delete(key);
    }
  }
}

export async function refreshClosedBucksMessages(
  closed: readonly { matchId: string; serverId: string }[],
): Promise<void> {
  for (const pool of closed) {
    await refreshBucksMessages({
      matchId: pool.matchId,
      serverId: DiscordGuildIdSchema.parse(pool.serverId),
      removeComponents: true,
    });
  }
}
