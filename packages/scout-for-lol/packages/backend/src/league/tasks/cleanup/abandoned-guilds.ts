import type { Client, Guild } from "discord.js";
import { prisma } from "#src/database/index.ts";
import {
  getAbandonedGuilds,
  markGuildAsNotified,
} from "#src/database/guild-permission-errors.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import * as Sentry from "@sentry/bun";
import {
  abandonedGuildsDetectedTotal,
  guildsLeftTotal,
  abandonmentNotificationsTotal,
} from "#src/metrics/index.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import { differenceInCalendarDays } from "date-fns";
import { cleanupRemovedGuild } from "#src/league/tasks/cleanup/remove-guild.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
import { getFeedbackUrl } from "#src/discord/utils/feedback.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("cleanup-abandoned-guilds");

/**
 * Check for abandoned guilds and handle cleanup
 *
 * A guild is considered abandoned if:
 * - Permission errors have been occurring for 7+ consecutive days
 * - No successful message sends during that period
 * - Owner hasn't been notified yet
 *
 * Actions taken:
 * 1. Send DM to server owner explaining the situation
 * 2. Leave the guild
 * 3. Clean up database records for that guild
 */
export async function checkAbandonedGuilds(client: Client): Promise<void> {
  logger.info("[AbandonedGuilds] Checking for abandoned guilds...");

  try {
    // Get guilds with 7+ days of consecutive permission errors
    const abandonedGuilds = await getAbandonedGuilds(prisma, 7);

    if (abandonedGuilds.length === 0) {
      logger.info("[AbandonedGuilds] No abandoned guilds found");
      return;
    }

    logger.info(
      `[AbandonedGuilds] Found ${abandonedGuilds.length.toString()} potentially abandoned guild(s)`,
    );

    // Record metric for detected abandoned guilds
    abandonedGuildsDetectedTotal.inc(abandonedGuilds.length);

    for (const guildInfo of abandonedGuilds) {
      try {
        await handleAbandonedGuild(client, guildInfo);
      } catch (error) {
        logger.error(
          `[AbandonedGuilds] Error handling abandoned guild ${guildInfo.serverId}:`,
          getErrorMessage(error),
        );
        Sentry.captureException(error, {
          tags: {
            source: "handle-abandoned-guild",
            serverId: guildInfo.serverId,
          },
        });
        // Continue with other guilds even if one fails
      }
    }

    logger.info("[AbandonedGuilds] Abandoned guild check complete");
  } catch (error) {
    logger.error(
      "[AbandonedGuilds] Error during abandoned guild check:",
      getErrorMessage(error),
    );
    Sentry.captureException(error, {
      tags: { source: "check-abandoned-guilds" },
    });
    throw error;
  }
}

/**
 * Handle a single abandoned guild
 */
async function handleAbandonedGuild(
  client: Client,
  guildInfo: {
    serverId: DiscordGuildId;
    firstOccurrence: Date;
    lastOccurrence: Date;
    errorCount: number;
  },
): Promise<void> {
  const { serverId, firstOccurrence, errorCount } = guildInfo;

  logger.info(
    `[AbandonedGuilds] Processing guild ${serverId} (errors since ${firstOccurrence.toISOString()}, count: ${errorCount.toString()})`,
  );

  // Fetch the guild
  let guild;
  try {
    guild = await client.guilds.fetch(serverId);
  } catch (_error) {
    logger.warn(
      `[AbandonedGuilds] Could not fetch guild ${serverId} - already removed. Error details: ${getErrorMessage(_error)}`,
    );
    // The bot is no longer in this guild: fully clean up its orphaned data so we
    // stop dispatching/polling/erroring for it, then mark notified so we don't
    // keep retrying. (The guildDelete handler would normally do this, but if the
    // removal predates this code path nothing fired - so do it here.)
    await cleanupRemovedGuild(prisma, serverId);
    await markGuildAsNotified(prisma, serverId);
    return;
  }

  // Try to notify the server owner (while still a member, so the DM can land)
  await notifyOwnerOfAbandonment(client, guild, firstOccurrence, errorCount);

  // Leave the guild
  try {
    await guild.leave();
    logger.info(`[AbandonedGuilds] ✅ Left guild ${guild.name} (${serverId})`);

    // Record metric for leaving guild
    guildsLeftTotal.inc({ reason: "abandoned" });
  } catch (error) {
    logger.error(
      `[AbandonedGuilds] Failed to leave guild ${serverId}:`,
      getErrorMessage(error),
    );

    // Record failed leave attempt
    guildsLeftTotal.inc({ reason: "failed" });

    // Still mark as notified even if we couldn't leave
  }

  // Mark as notified to prevent repeated attempts
  await markGuildAsNotified(prisma, serverId);

  // Clean up all database records for this guild. `guild.leave()` also fires the
  // guildDelete handler (which runs the same idempotent cleanup), but we run it
  // directly here so cleanup is deterministic regardless of event timing.
  await cleanupRemovedGuild(prisma, serverId);

  logger.info(
    `[AbandonedGuilds] ✅ Completed processing for guild ${guild.name} (${serverId})`,
  );
}

/**
 * Notify the server owner that the bot is leaving due to persistent permission
 * errors. Routed through the audited `sendDM` so the attempt is recorded.
 */
async function notifyOwnerOfAbandonment(
  client: Client,
  guild: Guild,
  firstErrorDate: Date,
  errorCount: number,
): Promise<void> {
  let ownerId: string;
  try {
    const owner = await guild.fetchOwner();
    ownerId = owner.id;
  } catch (error) {
    logger.warn(
      `[AbandonedGuilds] Could not resolve owner of guild ${guild.id}: ${getErrorMessage(error)}`,
    );
    abandonmentNotificationsTotal.inc({ status: "failed" });
    return;
  }

  const daysSinceFirstError = differenceInCalendarDays(
    new Date(),
    firstErrorDate,
  );

  const message = `👋 **Scout for LoL - Server Departure Notice**

Hello! I'm writing to let you know that I'll be leaving your server **${guild.name}**.

**Why am I leaving?**
I've been experiencing permission errors for the past ${daysSinceFirstError.toString()} days and haven't been able to send messages in your server. I've recorded ${errorCount.toString()} failed attempts.

This usually means:
• My role was removed or permissions were revoked
• The channels I post to were deleted or made inaccessible
• The server is no longer actively using the bot

**What happens now?**
• I'll automatically leave the server to clean up unused resources
• Your server's tracking data (players, subscriptions, competitions) will be removed
• You can re-invite me at any time and set things back up with \`/subscription add\`

**Got a moment?** I'd love to know what went wrong - your feedback helps:
${getFeedbackUrl()}

Thank you for trying Scout for LoL!

*This is an automated message. Replies to this DM won't be monitored.*`;

  const status = await sendDM({
    client,
    userId: DiscordAccountIdSchema.parse(ownerId),
    message,
    kind: "abandonment",
    guildId: DiscordGuildIdSchema.parse(guild.id),
  });

  if (status === "sent") {
    logger.info(
      `[AbandonedGuilds] ✅ Notified owner of guild ${guild.id} about departure`,
    );
  } else {
    logger.info(
      `[AbandonedGuilds] Owner of guild ${guild.id} not notified about departure: ${status}`,
    );
  }
  abandonmentNotificationsTotal.inc({
    status: status === "sent" ? "success" : status,
  });
}
