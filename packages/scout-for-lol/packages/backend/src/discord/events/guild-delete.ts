/**
 * Guild Delete Event Handler
 *
 * Handles when the bot is removed from a server (kicked, banned, or the guild
 * is deleted). Cleans up all of that guild's data so the bot stops generating
 * reports for, polling, and erroring on a server it can no longer reach, then
 * best-effort asks the former owner for feedback.
 */

import { type Guild } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import * as Sentry from "@sentry/bun";
import { prisma } from "#src/database/index.ts";
import { cleanupRemovedGuild } from "#src/league/tasks/cleanup/remove-guild.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
import { buildFeedbackRequestMessage } from "#src/discord/utils/feedback.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("guild-delete");

/**
 * Handle the guildDelete event - clean up data and request feedback.
 */
export async function handleGuildDelete(guild: Guild): Promise<void> {
  // guildDelete also fires when a guild becomes temporarily unavailable due to a
  // Discord outage. That is NOT a removal - do not delete anything.
  if (!guild.available) {
    logger.warn(
      `[Guild Delete] Guild ${guild.id} is unavailable (likely a Discord outage) - skipping cleanup`,
    );
    return;
  }

  logger.info(
    `[Guild Delete] Bot removed from server: ${guild.name} (${guild.id})`,
  );

  const serverId = DiscordGuildIdSchema.parse(guild.id);

  try {
    const summary = await cleanupRemovedGuild(prisma, serverId);
    logger.info(
      `[Guild Delete] Cleanup summary for ${guild.id}: ${JSON.stringify(summary)}`,
    );
  } catch (error) {
    logger.error(
      `[Guild Delete] Failed to clean up data for guild ${guild.id}:`,
      getErrorMessage(error),
    );
    Sentry.captureException(error, {
      tags: { source: "guild-delete-cleanup", serverId },
    });
  }

  // Best-effort feedback request. After removal the bot usually no longer shares
  // a guild with the owner, so this often cannot be delivered - the attempt and
  // its outcome are recorded in DmAuditLog regardless.
  try {
    const ownerId = DiscordAccountIdSchema.parse(guild.ownerId);
    await sendDM({
      client: guild.client,
      userId: ownerId,
      message: buildFeedbackRequestMessage(guild.name),
      kind: "feedback_request",
      guildId: serverId,
    });
  } catch (error) {
    logger.warn(
      `[Guild Delete] Could not send feedback request for guild ${guild.id}: ${getErrorMessage(error)}`,
    );
  }
}
