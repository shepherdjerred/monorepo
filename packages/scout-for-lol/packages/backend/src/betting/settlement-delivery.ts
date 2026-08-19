import type { MessageCreateOptions } from "discord.js";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  ChannelSendError,
  send as sendChannelMessage,
} from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

const logger = createLogger("betting-settlement-delivery");
const MAX_SEND_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

export type SettlementDeliveryDependencies = {
  sendMessage: (
    options: MessageCreateOptions,
    channelId: DiscordChannelId,
    guildId: DiscordGuildId,
  ) => Promise<unknown>;
  sleep: (milliseconds: number) => Promise<void>;
};

const defaultDependencies: SettlementDeliveryDependencies = {
  sendMessage: async (options, channelId, guildId) =>
    await sendChannelMessage(options, channelId, guildId),
  sleep: async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
};

function settlementChunkNonce(
  matchId: string,
  channelId: DiscordChannelId,
  chunkIndex: number,
): string {
  const deliveryKey = `${matchId}:${channelId}:${chunkIndex.toString()}`;
  return `bbs:${Bun.hash(deliveryKey).toString(36)}`;
}

async function sendSettlementChunk(
  dependencies: SettlementDeliveryDependencies,
  input: {
    options: MessageCreateOptions;
    channelId: DiscordChannelId;
    guildId: DiscordGuildId;
    chunkIndex: number;
  },
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      await dependencies.sendMessage(
        input.options,
        input.channelId,
        input.guildId,
      );
      return;
    } catch (error) {
      const deterministicFailure =
        error instanceof ChannelSendError && error.permissionError;
      if (attempt === MAX_SEND_ATTEMPTS || deterministicFailure) {
        throw error;
      }
      const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(
        `🎲 Bryan Bucks settlement chunk ${(input.chunkIndex + 1).toString()} attempt ${attempt.toString()}/${MAX_SEND_ATTEMPTS.toString()} failed; retrying in ${delayMs.toString()}ms: ${getErrorMessage(error)}`,
      );
      await dependencies.sleep(delayMs);
    }
  }
}

export async function sendSettlementMessages(
  input: {
    messages: readonly string[];
    matchId: string;
    channelId: string;
    guildId: string;
  },
  dependencies: SettlementDeliveryDependencies = defaultDependencies,
): Promise<void> {
  const channelId = DiscordChannelIdSchema.parse(input.channelId);
  const guildId = DiscordGuildIdSchema.parse(input.guildId);
  const failures: unknown[] = [];
  for (const [chunkIndex, content] of input.messages.entries()) {
    try {
      await sendSettlementChunk(dependencies, {
        options: {
          content,
          // Stable nonces make a transient retry idempotent at Discord.
          nonce: settlementChunkNonce(input.matchId, channelId, chunkIndex),
          enforceNonce: true,
          // A fifteen-person settlement must not ping fifteen people.
          allowedMentions: { parse: [] },
        },
        channelId,
        guildId,
        chunkIndex,
      });
    } catch (error) {
      failures.push(error);
      logger.error(
        `🎲 Bryan Bucks settlement chunk ${(chunkIndex + 1).toString()}/${input.messages.length.toString()} failed after retries: ${getErrorMessage(error)}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Bryan Bucks settlement failed to deliver ${failures.length.toString()}/${input.messages.length.toString()} chunk(s)`,
    );
  }
}
