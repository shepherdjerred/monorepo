import type { MessageCreateOptions, MessagePayload, Message } from "discord.js";
import { z } from "zod";
import * as Sentry from "@sentry/bun";
import { client } from "@scout-for-lol/backend/discord/client.ts";
import { asTextChannel } from "@scout-for-lol/backend/discord/utils/channel.ts";
import {
  checkSendMessagePermission,
  isPermissionError,
  formatPermissionErrorForLog,
  notifyServerOwnerAboutPermissionError,
} from "@scout-for-lol/backend/discord/utils/permissions.ts";
import { discordPermissionErrorsTotal } from "@scout-for-lol/backend/metrics/index.ts";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import {
  recordPermissionError,
  recordSuccessfulSend,
} from "@scout-for-lol/backend/database/guild-permission-errors.ts";
import type {
  DiscordChannelId,
  DiscordGuildId,
} from "@scout-for-lol/data/index";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("discord-channel");

/**
 * Custom error class for channel send failures
 */
export class ChannelSendError extends Error {
  constructor(
    message: string,
    public readonly channelId: string,
    public readonly permissionError: boolean,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ChannelSendError";
  }
}

// Zod schema for validating ChannelSendError instances
const ChannelSendErrorSchema = z.instanceof(ChannelSendError);

/**
 * Send a message to a Discord channel with graceful error handling
 *
 * This function handles common failure cases:
 * - Channel not found or deleted
 * - Bot missing permissions (Send Messages, View Channel)
 * - Channel is not text-based
 * - Discord API errors
 *
 * When permission errors occur, the server owner will be notified via DM (if provided).
 *
 * @param options - Message content (string, MessagePayload, or MessageCreateOptions)
 * @param channelId - ID of the channel to send to
 * @param serverId - Optional Discord guild (server) ID for owner notification on permission errors
 * @returns Promise that resolves with the sent Message
 * @throws {ChannelSendError} If the message cannot be sent
 */
export async function send(
  options: string | MessagePayload | MessageCreateOptions,
  channelId: DiscordChannelId,
  serverId?: DiscordGuildId,
): Promise<Message> {
  try {
    // Fetch the channel
    const fetchedChannel = await client.channels.fetch(channelId);
    if (!fetchedChannel) {
      const error = new ChannelSendError(
        "Channel not found or bot cannot access it",
        channelId,
        false,
      );
      logger.error(`[ChannelSend] ${error.message} - channel: ${channelId}`);
      Sentry.captureException(error, {
        tags: { source: "channel-send", channelId, reason: "not-found" },
      });
      throw error;
    }

    // Check if channel is text-based
    const channel = asTextChannel(fetchedChannel);
    if (!channel) {
      const error = new ChannelSendError(
        "Channel is not text-based",
        channelId,
        false,
      );
      logger.error(`[ChannelSend] ${error.message} - channel: ${channelId}`);
      Sentry.captureException(error, {
        tags: { source: "channel-send", channelId, reason: "not-text-based" },
      });
      throw error;
    }

    // Log message info - only log string messages to avoid object stringification
    const stringResult = z.string().safeParse(options);
    if (stringResult.success) {
      logger.info(
        `[ChannelSend] Sending message to ${channelId}: ${stringResult.data}`,
      );
    } else {
      logger.info(
        `[ChannelSend] Sending message to ${channelId}: [MessagePayload/MessageCreateOptions]`,
      );
    }

    // Send the message
    const sentMessage = await channel.send(options);

    // Record successful send if serverId is provided
    if (serverId) {
      void (async () => {
        try {
          await recordSuccessfulSend(prisma, serverId, channelId);
        } catch (dbError) {
          logger.error(
            `[ChannelSend] Failed to record successful send in DB:`,
            dbError,
          );
          Sentry.captureException(dbError, {
            tags: { source: "channel-send-db-record", channelId },
          });
        }
      })();
    }

    return sentMessage;
  } catch (error) {
    // If it's already a ChannelSendError, re-throw it
    if (ChannelSendErrorSchema.safeParse(error).success) {
      throw error;
    }

    // Check if it's a Discord permission error
    let isPermError = isPermissionError(error);
    let errorMessage = formatPermissionErrorForLog(channelId, error);
    let permissionReason: string | undefined;

    // If not a Discord API permission error, check permissions to provide better diagnostics
    if (!isPermError) {
      // Fetch channel to check permissions
      const fetchedChannel = await client.channels
        .fetch(channelId)
        .catch(() => null);
      if (fetchedChannel) {
        const permissionCheck = await checkSendMessagePermission(
          fetchedChannel,
          client.user,
        );
        if (!permissionCheck.hasPermission) {
          // It was actually a permission issue even though Discord didn't return a permission error
          isPermError = true;
          permissionReason = permissionCheck.reason;
          errorMessage = formatPermissionErrorForLog(
            channelId,
            error,
            permissionCheck.reason,
          );
        }
      }
    }

    // Log appropriately based on error type
    if (isPermError) {
      logger.warn(`[ChannelSend] ${errorMessage}`);

      // Track permission error in metrics (only if serverId not provided to avoid duplication)
      if (!serverId) {
        discordPermissionErrorsTotal.inc({
          guild_id: "unknown",
          error_type: "api_error",
        });
      }

      // Record permission error in database and notify owner if serverId is provided
      if (serverId) {
        void (async () => {
          try {
            await recordPermissionError(prisma, {
              serverId,
              channelId,
              errorType: "api_error",
              ...(permissionReason !== undefined && permissionReason.length > 0 ? { errorReason: permissionReason } : {}),
            });
          } catch (dbError) {
            logger.error(
              `[ChannelSend] Failed to record permission error in DB:`,
              dbError,
            );
            Sentry.captureException(dbError, {
              tags: { source: "channel-permission-db-record", channelId },
            });
          }
        })();

        // Notify server owner (this will also track metrics)
        void notifyServerOwnerAboutPermissionError(
          client,
          serverId,
          channelId,
          permissionReason,
        );
      }
    } else {
      logger.error(`[ChannelSend] ${errorMessage}`);
      Sentry.captureException(error, {
        tags: { source: "channel-send", channelId, isPermissionError: "false" },
      });
    }

    // Wrap in ChannelSendError
    throw new ChannelSendError(errorMessage, channelId, isPermError, error);
  }
}
