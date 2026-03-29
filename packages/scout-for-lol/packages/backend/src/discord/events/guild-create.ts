/**
 * Guild Create Event Handler
 *
 * Handles when the bot is added to a new server
 */

import { type Guild, ChannelType, AuditLogEvent } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("guild-create");

type WelcomeChannel = {
  name: string;
  send: (options: { content: string }) => Promise<unknown>;
};

/**
 * Find the best channel to send a welcome message to
 *
 * Priority:
 * 1. System channel (default channel for system messages)
 * 2. First text channel the bot can send messages to
 *
 * @param guild The guild that was joined
 * @returns A sendable channel or null if no suitable channel found
 */
async function findWelcomeChannel(
  guild: Guild,
): Promise<WelcomeChannel | null> {
  // Try system channel first
  if (guild.systemChannel) {
    const permissions = guild.systemChannel.permissionsFor(
      guild.members.me ?? guild.client.user,
    );
    if (permissions?.has(["ViewChannel", "SendMessages"]) === true) {
      return guild.systemChannel;
    }
  }

  // Find first text channel we can send to
  const channels = await guild.channels.fetch();
  for (const [, channel] of channels) {
    if (!channel) {
      continue;
    }
    if (channel.type !== ChannelType.GuildText) {
      continue;
    }
    if (!channel.isTextBased()) {
      continue;
    }

    const permissions = channel.permissionsFor(
      guild.members.me ?? guild.client.user,
    );
    if (permissions?.has(["ViewChannel", "SendMessages"]) === true) {
      return channel;
    }
  }

  return null;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Try to determine who added the bot by checking the audit log for a recent BotAdd entry.
 * Falls back to the guild owner if the audit log is inaccessible or has no recent entry.
 */
async function resolveInstaller(guild: Guild): Promise<string> {
  try {
    const auditLogs = await guild.fetchAuditLogs({
      limit: 5,
      type: AuditLogEvent.BotAdd,
    });

    const botUserId = guild.client.user.id;
    const now = Date.now();

    for (const [, entry] of auditLogs.entries) {
      // Match our bot as the target
      if (entry.target?.id !== botUserId) {
        continue;
      }
      // Only accept recent entries (within 5 minutes)
      if (now - entry.createdTimestamp > FIVE_MINUTES_MS) {
        continue;
      }
      if (entry.executor?.id !== undefined) {
        logger.info(
          `[Guild Create] Installer resolved from audit log: ${entry.executor.id}`,
        );
        return entry.executor.id;
      }
    }

    logger.info(
      `[Guild Create] No recent BotAdd audit log entry found, falling back to owner`,
    );
  } catch (error) {
    logger.warn(
      `[Guild Create] Could not fetch audit log (missing ViewAuditLog permission?): ${getErrorMessage(error)}`,
    );
  }

  return guild.ownerId;
}

/**
 * Save guild install info to the database
 */
async function saveGuildInstall(
  guild: Guild,
  addedByDiscordId: string,
): Promise<void> {
  try {
    const serverId = DiscordGuildIdSchema.parse(guild.id);
    const ownerId = DiscordAccountIdSchema.parse(guild.ownerId);
    const installerId = DiscordAccountIdSchema.parse(addedByDiscordId);

    await prisma.guildInstall.upsert({
      where: { serverId },
      create: {
        serverId,
        serverName: guild.name,
        ownerDiscordId: ownerId,
        addedByDiscordId: installerId,
        memberCount: guild.memberCount,
        installedAt: new Date(),
      },
      update: {
        serverName: guild.name,
        ownerDiscordId: ownerId,
        addedByDiscordId: installerId,
        memberCount: guild.memberCount,
        installedAt: new Date(),
        // Reset outreach timestamps on re-install
        outreach3dSentAt: null,
        outreach14dSentAt: null,
      },
    });

    logger.info(
      `[Guild Create] Saved install info for ${guild.name} (${guild.id}), installer: ${addedByDiscordId}`,
    );
  } catch (error) {
    logger.error(
      `[Guild Create] Failed to save install info for ${guild.name} (${guild.id}):`,
      getErrorMessage(error),
    );
  }
}

/**
 * Handle guildCreate event - send welcome message when bot joins a server
 */
export async function handleGuildCreate(guild: Guild): Promise<void> {
  logger.info(
    `[Guild Create] Bot added to server: ${guild.name} (${guild.id})`,
  );
  logger.info(
    `[Guild Create] Server has ${guild.memberCount.toString()} members`,
  );

  // Resolve who added the bot (audit log → fallback to owner)
  const installerId = await resolveInstaller(guild);

  // Save install info to database
  await saveGuildInstall(guild, installerId);

  try {
    const channel = await findWelcomeChannel(guild);

    if (!channel) {
      logger.warn(
        `[Guild Create] Could not find a channel to send welcome message in ${guild.name} (${guild.id})`,
      );
      return;
    }

    const welcomeMessage =
      truncateDiscordMessage(`👋 **Thanks for adding Scout!**

Scout tracks your friends' League of Legends matches and delivers beautiful post-match reports right here in Discord.

**Quick Start:**
• Use \`/help\` to see all available commands
• Use \`/subscription add\` to start tracking players
• Visit **https://scout-for-lol.com/getting-started** for a step-by-step setup guide

**Full Documentation:** https://scout-for-lol.com/docs

Need help? DM <@160509172704739328> or open a GitHub issue!`);

    await channel.send({ content: welcomeMessage });
    logger.info(
      `[Guild Create] Welcome message sent to ${guild.name} in #${channel.name}`,
    );
  } catch (error) {
    logger.error(
      `[Guild Create] Failed to send welcome message to ${guild.name} (${guild.id}):`,
      getErrorMessage(error),
    );
  }
}
