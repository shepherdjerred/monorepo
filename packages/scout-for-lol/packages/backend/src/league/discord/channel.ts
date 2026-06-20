import type { MessageCreateOptions, MessagePayload, Message } from "discord.js";
import { z } from "zod";
import * as Sentry from "@sentry/bun";
import { client } from "#src/discord/client.ts";
import { asTextChannel } from "#src/discord/utils/channel.ts";
import {
  checkSendMessagePermission,
  isPermissionError,
  isMissingChannelError,
  formatPermissionErrorForLog,
  notifyServerOwnerAboutPermissionError,
  type DeliveryFailureKind,
} from "#src/discord/utils/permissions.ts";
import { discordPermissionErrorsTotal } from "#src/metrics/index.ts";
import { prisma } from "#src/database/index.ts";
import {
  recordPermissionError,
  recordSuccessfulSend,
} from "#src/database/guild-permission-errors.ts";
import type {
  DiscordChannelId,
  DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";

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
 * Record an escalatable delivery failure (missing permission OR a deleted /
 * unreachable channel) against the guild's streak and run the backed-off owner
 * notification. Fire-and-forget; never throws into the caller.
 */
function escalateDeliveryFailure(opts: {
  kind: DeliveryFailureKind;
  serverId: DiscordGuildId;
  channelId: DiscordChannelId;
  permissionReason?: string;
}): void {
  const { kind, serverId, channelId, permissionReason } = opts;
  void (async () => {
    try {
      const notifyDecision = await recordPermissionError(prisma, {
        serverId,
        channelId,
        errorType: kind,
        ...(permissionReason !== undefined && permissionReason.length > 0
          ? { errorReason: permissionReason }
          : {}),
      });

      // Backed-off escalation: DM the owner immediately on the first failure of
      // a streak, again ~1 week later, again ~1 month after that, then silent.
      if (notifyDecision !== "none") {
        await notifyServerOwnerAboutPermissionError({
          client,
          serverId,
          channelId,
          stage: notifyDecision,
          kind,
          ...(permissionReason === undefined
            ? {}
            : { reason: permissionReason }),
        });
      }
    } catch (dbError) {
      logger.error(
        `[ChannelSend] Failed to record delivery error in DB:`,
        dbError,
      );
      Sentry.captureException(dbError, {
        tags: { source: "channel-delivery-db-record", channelId },
      });
    }
  })();
}

/**
 * Build (and side-effect on) a pre-send "can't reach this channel" failure: a
 * deleted / non-text / inaccessible channel. Escalates to the owner when we know
 * the guild; otherwise captures to Sentry. Returns the error for the caller to
 * throw (marked permissionError=true so callers treat it as handled).
 */
function failChannelMissing(
  message: string,
  channelId: DiscordChannelId,
  serverId: DiscordGuildId | undefined,
  sentryReason: string,
): ChannelSendError {
  logger.warn(`[ChannelSend] ${message} - channel: ${channelId}`);
  if (serverId) {
    escalateDeliveryFailure({ kind: "channel_missing", serverId, channelId });
  } else {
    Sentry.captureException(new ChannelSendError(message, channelId, true), {
      tags: { source: "channel-send", channelId, reason: sentryReason },
    });
  }
  return new ChannelSendError(message, channelId, true);
}

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
      throw failChannelMissing(
        "Channel not found or bot cannot access it",
        channelId,
        serverId,
        "not-found",
      );
    }

    // Check if channel is text-based
    const channel = asTextChannel(fetchedChannel);
    if (!channel) {
      throw failChannelMissing(
        "Channel is not a text channel I can post in",
        channelId,
        serverId,
        "not-text-based",
      );
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
    // If it's already a ChannelSendError (pre-send checks), it has already been
    // handled — re-throw as-is.
    if (ChannelSendErrorSchema.safeParse(error).success) {
      throw error;
    }

    // Classify the failure: a permission issue, an unreachable/deleted channel,
    // or some other (likely transient) error.
    let kind: DeliveryFailureKind | "other";
    let permissionReason: string | undefined;
    if (isPermissionError(error)) {
      kind = "permission";
    } else if (isMissingChannelError(error)) {
      kind = "channel_missing";
    } else {
      // Re-fetch to diagnose: gone → channel_missing; reachable but no perms →
      // permission; otherwise treat as a transient/unknown error.
      const refetched = await client.channels
        .fetch(channelId)
        .catch(() => null);
      if (refetched === null) {
        kind = "channel_missing";
      } else {
        const permissionCheck = await checkSendMessagePermission(
          refetched,
          client.user,
        );
        if (permissionCheck.hasPermission) {
          kind = "other";
        } else {
          kind = "permission";
          permissionReason = permissionCheck.reason;
        }
      }
    }

    const errorMessage = formatPermissionErrorForLog(
      channelId,
      error,
      permissionReason,
    );

    if (kind === "other") {
      // Unknown / transient (rate limit, timeout, outage): operator domain.
      logger.error(`[ChannelSend] ${errorMessage}`);
      Sentry.captureException(error, {
        tags: { source: "channel-send", channelId, isPermissionError: "false" },
      });
    } else {
      // Permission or deleted-channel: a delivery problem the owner can fix.
      logger.warn(`[ChannelSend] ${errorMessage} (${kind})`);
      if (serverId) {
        escalateDeliveryFailure({
          kind,
          serverId,
          channelId,
          ...(permissionReason === undefined ? {} : { permissionReason }),
        });
      } else {
        discordPermissionErrorsTotal.inc({
          guild_id: "unknown",
          error_type: kind,
        });
      }
    }

    // permissionError=true marks "handled delivery problem" so callers don't
    // double-report it; false for genuinely-unexpected errors.
    throw new ChannelSendError(
      errorMessage,
      channelId,
      kind !== "other",
      error,
    );
  }
}
