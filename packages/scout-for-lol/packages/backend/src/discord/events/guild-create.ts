/**
 * Guild Create Event Handler
 *
 * Handles when the bot is added to a new server
 */

import { type Guild, ChannelType, AuditLogEvent } from "discord.js";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { randomUUID } from "node:crypto";
import { captureGuildInstalled } from "#src/analytics/guild-lifecycle.ts";

const logger = createLogger("guild-create");

// Prisma surfaces unique-constraint violations as { code: "P2002", ... }.
const PrismaKnownErrorSchema = z.object({ code: z.string() });

function isUniqueConstraintError(error: unknown): boolean {
  const parsed = PrismaKnownErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === "P2002";
}

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
 * Save guild install info to the database.
 *
 * Concurrent `guildCreate` callbacks for the SAME guild (Discord replays,
 * shard reconnects) must not both decide they are the one making a "first
 * install" or "reinstall" transition — that would rotate
 * `analyticsInstallationId` twice and emit `guild_installed` under two
 * different identities for one real installation. So each case below is
 * claimed atomically at the database layer instead of a read-then-branch:
 * case 1 is guarded by the unique constraint on `serverId`, case 2 by an
 * `updateMany` scoped to the exact prior `removedAt` state — the same
 * claim-the-transition pattern already used for `firstCoreOutputAt` /
 * `firstSubscriptionAt` / `removedAt` in guild-lifecycle.ts.
 */
async function saveGuildInstall(
  guild: Guild,
  addedByDiscordId: string,
): Promise<void> {
  try {
    const serverId = DiscordGuildIdSchema.parse(guild.id);
    const ownerId = DiscordAccountIdSchema.parse(guild.ownerId);
    const installerId = DiscordAccountIdSchema.parse(addedByDiscordId);

    const identity = {
      serverName: guild.name,
      ownerDiscordId: ownerId,
      addedByDiscordId: installerId,
      memberCount: guild.memberCount,
    };
    const installedAt = new Date();

    // Case 1: a genuinely new guild. At most one concurrent caller's create
    // can succeed against the unique `serverId` constraint; every other
    // racing caller gets a P2002 and falls through to case 2/3 instead of
    // also believing it made the first install.
    try {
      const install = await prisma.guildInstall.create({
        data: {
          serverId,
          ...identity,
          installedAt,
          analyticsInstallationId: randomUUID(),
          analyticsLifecycleTracked: true,
        },
      });
      captureGuildInstalled(install, "first", guild.memberCount);
      logger.info(
        `[Guild Create] Saved install info for ${guild.name} (${guild.id}), installer: ${addedByDiscordId}, reinstall: false`,
      );
      return;
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }

    // Case 2: a genuine re-install. Guard the update on the row still being
    // `removedAt: { not: null }` so at most one concurrent caller's
    // updateMany matches — the loser's WHERE clause finds nothing once the
    // winner has already flipped removedAt to null, so only one caller
    // rotates the identity and emits `guild_installed`.
    const analyticsInstallationId = randomUUID();
    const reinstallClaim = await prisma.guildInstall.updateMany({
      where: { serverId, removedAt: { not: null } },
      data: {
        ...identity,
        // Moving installedAt forward IS the reset: outreach state is
        // derived from audit rows created after it, so there is no list of
        // counters to remember to clear.
        installedAt,
        analyticsInstallationId,
        analyticsLifecycleTracked: true,
        firstCoreOutputAt: null,
        firstSubscriptionAt: null,
        emailNudgeSentAt: null,
        outreach3dSentAt: null,
        outreach14dSentAt: null,
        outreach30dSentAt: null,
        removedAt: null,
      },
    });

    if (reinstallClaim.count === 1) {
      captureGuildInstalled(
        { analyticsInstallationId, analyticsLifecycleTracked: true },
        "reinstall",
        guild.memberCount,
      );
      logger.info(
        `[Guild Create] Saved install info for ${guild.name} (${guild.id}), installer: ${addedByDiscordId}, reinstall: true`,
      );
      return;
    }

    // Case 3: a guild we never left (or a concurrent caller already claimed
    // the reinstall above). No lifecycle transition, no analytics event —
    // just refresh identity fields, which can legitimately change.
    await prisma.guildInstall.updateMany({
      where: { serverId },
      data: { ...identity, removedAt: null },
    });
    logger.info(
      `[Guild Create] Saved install info for ${guild.name} (${guild.id}), installer: ${addedByDiscordId}, reinstall: false`,
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
  // guildCreate also fires when a guild the bot was already in becomes
  // available again (Discord outage, shard reconnect). That is NOT an install:
  // treating it as one would re-post the welcome message into their channel and
  // re-arm the onboarding DMs for a server that has had Scout for months.
  // Mirrors the same guard in handleGuildDelete.
  if (!guild.available) {
    logger.warn(
      `[Guild Create] Guild ${guild.id} is unavailable (likely a Discord outage) - skipping install handling`,
    );
    return;
  }

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

**Get started:** open the dashboard at **https://scout-for-lol.com/app/** \
to add the players you want to track, pick channels, and set up \
competitions. Read the guide at https://scout-for-lol.com/docs/

You can also try \`/track\` for a simple one-channel setup, or use \`/help\` to see the lightweight commands.

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
