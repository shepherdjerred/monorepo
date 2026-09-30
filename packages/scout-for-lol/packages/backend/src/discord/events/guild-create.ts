/**
 * Guild Create Event Handler
 *
 * Handles when the bot is added to a new server
 */

import { type Guild, ChannelType, AuditLogEvent } from "discord.js";
import { z } from "zod";
import {
  type DiscordGuildId,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { prisma, type Db } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { randomUUID } from "node:crypto";
import { captureGuildInstalled } from "#src/analytics/guild-lifecycle.ts";
import {
  reconcilePendingInstallAttribution,
  restoreRetiredInstallAttribution,
  type RetiredInstallAttribution,
} from "#src/analytics/install-attribution.ts";
import {
  claimObservedRemovalReplacement,
  createLifecycleReset,
  preserveAttributedReplacement,
  type GuildInstallIdentity,
} from "#src/discord/events/guild-install-transition.ts";

const logger = createLogger("guild-create");

async function finalizePendingInstallAttribution(
  serverId: DiscordGuildId,
): Promise<void> {
  try {
    await reconcilePendingInstallAttribution(serverId);
  } catch (error) {
    // Attribution is best-effort bookkeeping. Once the install transition is
    // committed, a token failure must not hide its installation generation
    // from the connection-race compensation below.
    logger.error(
      `[Guild Create] Failed to finalize install attribution for ${serverId}:`,
      getErrorMessage(error),
    );
  }
}

export type GuildInstallReplacement =
  | {
      readonly kind: "reconciliation";
      readonly analyticsInstallationId: string;
      readonly retiredAttribution?: RetiredInstallAttribution;
    }
  | {
      readonly kind: "reconciliation-pending-retirement";
      readonly analyticsInstallationId: string;
    }
  | {
      readonly kind: "observed-removal";
      readonly observedAt: Date;
    };

export type GuildInstallReplacementClaim = {
  readonly replacement: GuildInstallReplacement;
  readonly update: (replacement: GuildInstallReplacement) => boolean;
  readonly accept: () => void;
};

// Prisma surfaces unique-constraint violations as { code: "P2002", ... }.
const PrismaKnownErrorSchema = z.object({ code: z.string() });

export function isUniqueConstraintError(error: unknown): boolean {
  const parsed = PrismaKnownErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === "P2002";
}

type WelcomeChannel = {
  name: string;
  send: (options: { content: string }) => Promise<unknown>;
};

async function claimReplacement(params: {
  readonly serverId: DiscordGuildId;
  readonly replacement: GuildInstallReplacement;
  readonly identity: GuildInstallIdentity;
  readonly installedAt: Date;
  readonly analyticsInstallationId: string;
}): Promise<string | undefined> {
  if (params.replacement.kind === "observed-removal") {
    return await claimObservedRemovalReplacement({
      db: prisma,
      serverId: params.serverId,
      observedAt: params.replacement.observedAt,
      identity: params.identity,
      installedAt: params.installedAt,
      analyticsInstallationId: params.analyticsInstallationId,
    });
  }
  if (params.replacement.kind === "reconciliation-pending-retirement") {
    throw new Error(
      "Pending attribution retirement must be reconciled before replacement",
    );
  }
  const reconciliationReplacement = params.replacement;

  // If the browser attributed the provisional generation first, preserve its
  // identity so the already-emitted attribution event remains attached to the
  // installation that survives this handoff.
  const attributedClaim = await preserveAttributedReplacement({
    db: prisma,
    serverId: params.serverId,
    expectedAnalyticsInstallationId:
      reconciliationReplacement.analyticsInstallationId,
    identity: params.identity,
    installedAt: params.installedAt,
  });
  if (attributedClaim) {
    return params.replacement.analyticsInstallationId;
  }

  // Otherwise rotate only while attribution is still null. A browser request
  // that wins the row lock makes this claim miss; the retry below then
  // preserves that generation.
  const rotated = await prisma.$transaction(async (tx) => {
    const rotationClaim = await tx.guildInstall.updateMany({
      where: {
        serverId: params.serverId,
        analyticsInstallationId:
          reconciliationReplacement.analyticsInstallationId,
        attributedAt: null,
      },
      data: createLifecycleReset({
        identity: params.identity,
        installedAt: params.installedAt,
        analyticsInstallationId: params.analyticsInstallationId,
      }),
    });
    if (rotationClaim.count !== 1) {
      return false;
    }
    await restoreReplacementAttribution(reconciliationReplacement, tx);
    return true;
  });
  if (!rotated) {
    const attributedRetry = await preserveAttributedReplacement({
      db: prisma,
      serverId: params.serverId,
      expectedAnalyticsInstallationId:
        reconciliationReplacement.analyticsInstallationId,
      identity: params.identity,
      installedAt: params.installedAt,
    });
    return attributedRetry
      ? reconciliationReplacement.analyticsInstallationId
      : undefined;
  }
  return params.analyticsInstallationId;
}

async function restoreReplacementAttribution(
  replacement: GuildInstallReplacement,
  db: Pick<Db, "installAttributionToken">,
): Promise<void> {
  if (
    replacement.kind === "reconciliation" &&
    replacement.retiredAttribution !== undefined
  ) {
    await restoreRetiredInstallAttribution(replacement.retiredAttribution, {
      db,
    });
  }
}

async function createFirstGuildInstall(params: {
  guild: Guild;
  serverId: DiscordGuildId;
  identity: GuildInstallIdentity;
  installedAt: Date;
  shouldReconcilePendingAttribution: boolean;
}): Promise<string | undefined> {
  try {
    const install = await prisma.guildInstall.create({
      data: {
        serverId: params.serverId,
        ...params.identity,
        installedAt: params.installedAt,
        analyticsInstallationId: randomUUID(),
        analyticsLifecycleTracked: true,
      },
    });
    captureGuildInstalled(install, "first", params.guild.memberCount);
    if (params.shouldReconcilePendingAttribution) {
      await finalizePendingInstallAttribution(params.serverId);
    }
    logger.info(
      `[Guild Create] Saved install info for ${params.guild.name} (${params.guild.id}), installer: ${params.identity.addedByDiscordId}, reinstall: false`,
    );
    return install.analyticsInstallationId;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function completeGuildReinstall(params: {
  guild: Guild;
  serverId: DiscordGuildId;
  analyticsInstallationId: string;
  addedByDiscordId: string;
  shouldReconcilePendingAttribution: boolean;
}): Promise<string> {
  captureGuildInstalled(
    {
      analyticsInstallationId: params.analyticsInstallationId,
      analyticsLifecycleTracked: true,
      serverId: params.serverId,
    },
    "reinstall",
    params.guild.memberCount,
  );
  if (params.shouldReconcilePendingAttribution) {
    await finalizePendingInstallAttribution(params.serverId);
  }
  logger.info(
    `[Guild Create] Saved install info for ${params.guild.name} (${params.guild.id}), installer: ${params.addedByDiscordId}, reinstall: true`,
  );
  return params.analyticsInstallationId;
}

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
export async function saveGuildInstall(
  guild: Guild,
  addedByDiscordId: string,
  shouldReconcilePendingAttribution = true,
  replacement?: GuildInstallReplacement,
): Promise<string | undefined> {
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
    const firstInstallId = await createFirstGuildInstall({
      guild,
      serverId,
      identity,
      installedAt,
      shouldReconcilePendingAttribution,
    });
    if (firstInstallId !== undefined) {
      return firstInstallId;
    }

    // Case 2: a genuine re-install. Guard the update on the row still being
    // `removedAt: { not: null }` so at most one concurrent caller's
    // updateMany matches — the loser's WHERE clause finds nothing once the
    // winner has already flipped removedAt to null, so only one caller
    // rotates the identity and emits `guild_installed`.
    const analyticsInstallationId = randomUUID();
    const lifecycleReset = createLifecycleReset({
      identity,
      installedAt,
      analyticsInstallationId,
      analyticsLifecycleTracked: shouldReconcilePendingAttribution,
    });

    // Startup reconciliation can hand an exact in-flight generation to the
    // replacement Guild object that displaced its snapshot. Only that
    // identity-scoped handoff may rotate an active row: a normal guildCreate
    // for an availability restore must remain case 3 below.
    if (replacement === undefined) {
      const reinstallClaim = await prisma.guildInstall.updateMany({
        where: { serverId, removedAt: { not: null } },
        data: lifecycleReset,
      });
      if (reinstallClaim.count === 1) {
        if (shouldReconcilePendingAttribution) {
          return await completeGuildReinstall({
            guild,
            serverId,
            analyticsInstallationId,
            addedByDiscordId,
            shouldReconcilePendingAttribution,
          });
        }
        return analyticsInstallationId;
      }
    } else {
      const replacementInstallationId = await claimReplacement({
        serverId,
        replacement,
        identity,
        installedAt,
        analyticsInstallationId,
      });
      if (replacementInstallationId !== undefined) {
        return await completeGuildReinstall({
          guild,
          serverId,
          analyticsInstallationId: replacementInstallationId,
          addedByDiscordId,
          shouldReconcilePendingAttribution,
        });
      }
    }

    // Case 3: a guild we never left (or a concurrent caller already claimed
    // the reinstall above). No lifecycle transition, no analytics event —
    // just refresh identity fields, which can legitimately change.
    if (shouldReconcilePendingAttribution) {
      const refreshClaim = await prisma.guildInstall.updateMany({
        where: { serverId, removedAt: null },
        data: identity,
      });
      if (refreshClaim.count === 0) {
        return undefined;
      }
      // A prior post-promotion attempt may have left a durable consumed token
      // pending. Availability events safely retry the unchanged generation;
      // historical rows remain ineligible inside the attribution guard.
      await finalizePendingInstallAttribution(serverId);
    }
    const currentInstall = await prisma.guildInstall.findUnique({
      where: { serverId },
      select: { analyticsInstallationId: true },
    });
    logger.info(
      `[Guild Create] Saved install info for ${guild.name} (${guild.id}), installer: ${addedByDiscordId}, reinstall: false`,
    );
    return currentInstall?.analyticsInstallationId;
  } catch (error) {
    logger.error(
      `[Guild Create] Failed to save install info for ${guild.name} (${guild.id}):`,
      getErrorMessage(error),
    );
    return undefined;
  }
}

/**
 * Handle guildCreate event - send welcome message when bot joins a server
 */
export async function handleGuildCreate(
  guild: Guild,
  replacementClaim?: GuildInstallReplacementClaim,
): Promise<void> {
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
  const savedInstallationId = await saveGuildInstall(
    guild,
    installerId,
    true,
    replacementClaim?.replacement,
  );
  if (savedInstallationId !== undefined) {
    replacementClaim?.accept();
  }

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
