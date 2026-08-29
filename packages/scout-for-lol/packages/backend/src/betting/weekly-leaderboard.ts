import * as Sentry from "@sentry/bun";
import type { MessageCreateOptions } from "discord.js";
import {
  type BucksWeeklyLeaderboardEntries,
  type DiscordChannelId,
  type DiscordGuildId,
  formatInteger,
} from "@scout-for-lol/data";
import {
  getFullLeaderboard,
  type FullLeaderboardRow,
} from "#src/betting/accounts.ts";
import { saveWeeklyLeaderboardSnapshot } from "#src/betting/weekly-leaderboard-snapshot.ts";
import { isPolicyEnabled, MY_SERVER } from "#src/configuration/flags.ts";
import { client } from "#src/discord/client.ts";
import { COMMON_DENOMINATOR_CHANNEL_ID } from "#src/discord/channels.ts";
import { observeBucksDelivery } from "#src/betting/delivery-observability.ts";
import { splitMessageIntoChunks } from "#src/discord/utils/message.ts";
import {
  ChannelSendError,
  send as sendChannelMessage,
} from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

const logger = createLogger("betting-weekly-leaderboard");
const MAX_CHUNK_SEND_ATTEMPTS = 3;
const CHUNK_RETRY_BASE_DELAY_MS = 500;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const WEEKLY_BUCKS_CRON = {
  schedule: "0 0 17 * * 5",
  jobName: "weekly_bryan_bucks_leaderboard",
  logMessage: "💰 Posting the weekly Bryan Bucks leaderboard",
  timezone: "America/Los_Angeles",
  runOnInit: false,
} as const;

export type RankedLeaderboardRow = FullLeaderboardRow & { rank: number };

export function rankBucksLeaderboard(
  rows: readonly FullLeaderboardRow[],
): RankedLeaderboardRow[] {
  let previousBalance: number | undefined;
  let rank = 0;
  return rows.map((row, index) => {
    if (previousBalance === undefined || row.balance !== previousBalance) {
      rank = index + 1;
      previousBalance = row.balance;
    }
    return { ...row, rank };
  });
}

export function formatWeeklyBucksLeaderboard(
  rows: readonly FullLeaderboardRow[],
  maxLength?: number,
): string[] {
  if (rows.length === 0) {
    return [
      "💰 **Weekly Bryan Bucks leaderboard**\nNo Bryan Bucks wallets exist yet.",
    ];
  }

  const body = rankBucksLeaderboard(rows)
    .map(
      (row) =>
        `**${formatInteger(row.rank)}.** <@${row.discordId}> — **${formatInteger(row.balance)} BB**`,
    )
    .join("\n");
  return splitMessageIntoChunks(
    `💰 **Weekly Bryan Bucks leaderboard**\n${body}`,
    maxLength,
  );
}

export type WeeklyBucksLeaderboardDependencies = {
  enabledGuilds: () => Promise<DiscordGuildId[]>;
  hasGuild: (serverId: DiscordGuildId) => boolean;
  loadRows: (serverId: DiscordGuildId) => Promise<FullLeaderboardRow[]>;
  persistSnapshot: (input: {
    serverId: DiscordGuildId;
    runWeek: number;
    entries: BucksWeeklyLeaderboardEntries;
  }) => Promise<void>;
  sendMessage: (
    options: MessageCreateOptions,
    channelId: DiscordChannelId,
    serverId: DiscordGuildId,
  ) => Promise<unknown>;
  sleep: (milliseconds: number) => Promise<void>;
};

const defaultDependencies: WeeklyBucksLeaderboardDependencies = {
  enabledGuilds: async () =>
    (await isPolicyEnabled("betting_enabled", { server: MY_SERVER }))
      ? [MY_SERVER]
      : [],
  hasGuild: (serverId) => client.guilds.cache.has(serverId),
  loadRows: async (serverId) => await getFullLeaderboard({ serverId }),
  persistSnapshot: async (input) => {
    await saveWeeklyLeaderboardSnapshot(input);
  },
  sendMessage: async (options, channelId, serverId) =>
    await sendChannelMessage(options, channelId, serverId),
  sleep: async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
};

export type WeeklyBucksLeaderboardResult = {
  status: "sent" | "not_in_guild";
  entryCount: number;
  chunkCount: number;
};

function chunkNonce(runWeek: number, chunkIndex: number): string {
  return `bbw:${runWeek.toString(36)}:${chunkIndex.toString(36)}`;
}

async function sendLeaderboardChunk(
  dependencies: WeeklyBucksLeaderboardDependencies,
  options: MessageCreateOptions,
  serverId: DiscordGuildId,
  chunkIndex: number,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_CHUNK_SEND_ATTEMPTS; attempt++) {
    try {
      // Wrapped per attempt, so a retried send shows its failures rather than
      // only its eventual success.
      await observeBucksDelivery(
        {
          surface: "weekly_leaderboard",
          operation: "send",
          serverId,
          channelId: COMMON_DENOMINATOR_CHANNEL_ID,
        },
        () =>
          dependencies.sendMessage(
            options,
            COMMON_DENOMINATOR_CHANNEL_ID,
            serverId,
          ),
      );
      return;
    } catch (error) {
      const deterministicFailure =
        error instanceof ChannelSendError && error.permissionError;
      if (attempt === MAX_CHUNK_SEND_ATTEMPTS || deterministicFailure) {
        throw error;
      }
      const delayMs = CHUNK_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(
        `💰 Weekly Bryan Bucks leaderboard chunk ${(chunkIndex + 1).toString()} attempt ${attempt.toString()}/${MAX_CHUNK_SEND_ATTEMPTS.toString()} failed; retrying in ${delayMs.toString()}ms: ${getErrorMessage(error)}`,
      );
      await dependencies.sleep(delayMs);
    }
  }
}

/**
 * Publish the one configured guild's complete leaderboard.
 *
 * Both beta and production run background jobs against the same flag registry.
 * Only beta belongs to the configured guild, so a bot without that membership
 * deliberately does nothing. The guild count is still enforced first: adding
 * another enabled guild requires an explicit guild-to-channel mapping rather
 * than silently disclosing its balances in Common Denominator.
 */
export async function runWeeklyBucksLeaderboard(
  dependencies: WeeklyBucksLeaderboardDependencies = defaultDependencies,
): Promise<WeeklyBucksLeaderboardResult> {
  const guilds = await dependencies.enabledGuilds();
  if (guilds.length !== 1) {
    throw new Error(
      `Weekly Bryan Bucks leaderboard requires exactly one enabled guild; found ${guilds.length.toString()}`,
    );
  }
  const serverId = guilds[0];
  if (serverId === undefined) {
    throw new Error("The enabled Bryan Bucks guild was missing");
  }
  if (!dependencies.hasGuild(serverId)) {
    logger.info(
      `💰 Skipping weekly Bryan Bucks leaderboard: this Discord application is not in guild ${serverId}`,
    );
    return { status: "not_in_guild", entryCount: 0, chunkCount: 0 };
  }

  const rows = await dependencies.loadRows(serverId);
  const chunks = formatWeeklyBucksLeaderboard(rows);
  logger.info(
    `💰 Weekly Bryan Bucks leaderboard contains ${rows.length.toString()} entries across ${chunks.length.toString()} chunk(s)`,
  );

  const runWeek = Math.floor(Date.now() / WEEK_MS);
  // The rows are frozen into chunks above, so this is the moment the numbers
  // the post will disclose exist — persist exactly them. The post is the
  // product and the snapshot is derived disclosure, so a persist failure is
  // reported but never blocks the send.
  try {
    await dependencies.persistSnapshot({
      serverId,
      runWeek,
      entries: rankBucksLeaderboard(rows).map((row) => ({
        rank: row.rank,
        discordId: row.discordId,
        balance: row.balance,
      })),
    });
  } catch (error) {
    Sentry.captureException(error);
    logger.error(
      `💰 Could not persist the weekly Bryan Bucks leaderboard snapshot: ${getErrorMessage(error)}`,
    );
  }
  const failures: unknown[] = [];
  for (const [chunkIndex, chunk] of chunks.entries()) {
    try {
      await sendLeaderboardChunk(
        dependencies,
        {
          content: chunk,
          allowedMentions: { parse: [] },
          nonce: chunkNonce(runWeek, chunkIndex),
          enforceNonce: true,
        },
        serverId,
        chunkIndex,
      );
    } catch (error) {
      failures.push(error);
      logger.error(
        `💰 Weekly Bryan Bucks leaderboard chunk ${(chunkIndex + 1).toString()}/${chunks.length.toString()} failed after retries: ${getErrorMessage(error)}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Weekly Bryan Bucks leaderboard failed to deliver ${failures.length.toString()}/${chunks.length.toString()} chunk(s)`,
    );
  }

  return {
    status: "sent",
    entryCount: rows.length,
    chunkCount: chunks.length,
  };
}
