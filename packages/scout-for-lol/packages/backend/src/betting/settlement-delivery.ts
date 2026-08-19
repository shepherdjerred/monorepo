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

const logger = createLogger("betting-financial-delivery");
const MAX_SEND_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

type FinancialMessageKind = "close" | "settlement";

export type BettingDeliveryDependencies = {
  sendMessage: (
    options: MessageCreateOptions,
    channelId: DiscordChannelId,
    guildId: DiscordGuildId,
  ) => Promise<unknown>;
  sleep: (milliseconds: number) => Promise<void>;
};

const defaultDependencies: BettingDeliveryDependencies = {
  sendMessage: async (options, channelId, guildId) =>
    await sendChannelMessage(options, channelId, guildId),
  sleep: async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
};

function financialChunkNonce(
  kind: FinancialMessageKind,
  matchId: string,
  channelId: DiscordChannelId,
  chunkIndex: number,
): string {
  const deliveryKey = `${matchId}:${channelId}:${chunkIndex.toString()}`;
  const prefix = kind === "close" ? "bbc" : "bbs";
  return `${prefix}:${Bun.hash(deliveryKey).toString(36)}`;
}

async function sendFinancialChunk(
  dependencies: BettingDeliveryDependencies,
  input: {
    kind: FinancialMessageKind;
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
        `🎲 Bryan Bucks ${input.kind} chunk ${(input.chunkIndex + 1).toString()} attempt ${attempt.toString()}/${MAX_SEND_ATTEMPTS.toString()} failed; retrying in ${delayMs.toString()}ms: ${getErrorMessage(error)}`,
      );
      await dependencies.sleep(delayMs);
    }
  }
}

async function sendFinancialMessages(
  input: {
    kind: FinancialMessageKind;
    messages: readonly string[];
    matchId: string;
    channelId: string;
    guildId: string;
  },
  dependencies: BettingDeliveryDependencies,
): Promise<void> {
  const channelId = DiscordChannelIdSchema.parse(input.channelId);
  const guildId = DiscordGuildIdSchema.parse(input.guildId);
  const failures: unknown[] = [];
  for (const [chunkIndex, content] of input.messages.entries()) {
    try {
      await sendFinancialChunk(dependencies, {
        kind: input.kind,
        options: {
          content,
          // Stable nonces make a transient retry idempotent at Discord.
          nonce: financialChunkNonce(
            input.kind,
            input.matchId,
            channelId,
            chunkIndex,
          ),
          enforceNonce: true,
          // Financial summaries must not ping every bettor they enumerate.
          allowedMentions: { parse: [] },
        },
        channelId,
        guildId,
        chunkIndex,
      });
    } catch (error) {
      failures.push(error);
      logger.error(
        `🎲 Bryan Bucks ${input.kind} chunk ${(chunkIndex + 1).toString()}/${input.messages.length.toString()} failed after retries: ${getErrorMessage(error)}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Bryan Bucks ${input.kind} failed to deliver ${failures.length.toString()}/${input.messages.length.toString()} chunk(s)`,
    );
  }
}

export async function sendSettlementMessages(
  input: {
    messages: readonly string[];
    matchId: string;
    channelId: string;
    guildId: string;
  },
  dependencies: BettingDeliveryDependencies = defaultDependencies,
): Promise<void> {
  await sendFinancialMessages({ ...input, kind: "settlement" }, dependencies);
}

export async function sendCloseMessages(
  input: {
    messages: readonly string[];
    matchId: string;
    channelId: string;
    guildId: string;
  },
  dependencies: BettingDeliveryDependencies = defaultDependencies,
): Promise<void> {
  await sendFinancialMessages({ ...input, kind: "close" }, dependencies);
}
