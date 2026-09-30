import type { Guild } from "discord.js";
import { randomUUID } from "node:crypto";
import {
  type DiscordGuildId,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { prisma, type Db } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import {
  captureGuildInstalled,
  captureGuildRemovalForInstallation,
} from "#src/analytics/guild-lifecycle.ts";
import {
  reconcilePendingInstallAttribution,
  retirePendingInstallAttribution,
  retirePendingInstallAttributionInTransaction,
  type RetiredInstallAttribution,
} from "#src/analytics/install-attribution.ts";
import {
  isUniqueConstraintError,
  saveGuildInstall,
  type GuildInstallReplacementClaim,
  type GuildInstallReplacement,
} from "#src/discord/events/guild-create.ts";
import {
  createLifecycleReset,
  type GuildInstallIdentity,
} from "#src/discord/events/guild-install-transition.ts";

const logger = createLogger("guild-install-reconciliation");
const RECONCILIATION_RETRY_DELAYS_MS = [250, 1000] as const;

type ReconciliationContext = {
  readonly guild: Guild;
  readonly serverId: DiscordGuildId;
  readonly readConnectedGuild: () => Guild | undefined;
  readonly registerReplacement?: (
    guild: Guild,
    replacement: GuildInstallReplacement,
  ) => void;
};

type AttributionRetirementResult =
  | {
      readonly succeeded: true;
      readonly retirement: RetiredInstallAttribution;
    }
  | { readonly succeeded: false };

type HistoricalInstallFinish =
  | { readonly remainedCurrent: false }
  | {
      readonly remainedCurrent: true;
      readonly attributionRetirementSucceeded: boolean;
    };

export type GuildInstallReconciliationOptions = {
  readonly getConnectedGuild?: (guildId: string) => Guild | undefined;
  readonly registerReplacement?: (
    guild: Guild,
    replacement: GuildInstallReplacement,
  ) => void;
  readonly claimReplacement?: (
    guild: Guild,
  ) => GuildInstallReplacementClaim | undefined;
  readonly waitBeforeRetry?: (delayMs: number) => Promise<void>;
};

async function retireAttribution(
  serverId: DiscordGuildId,
): Promise<AttributionRetirementResult> {
  try {
    return {
      succeeded: true,
      retirement: await retirePendingInstallAttribution(serverId),
    };
  } catch (error) {
    logger.error(
      `[Guild Install Reconciliation] Failed to retire attribution for ${serverId}:`,
      getErrorMessage(error),
    );
    return { succeeded: false };
  }
}

async function handleDisplacedSnapshot(
  context: ReconciliationContext,
  connectedGuild: Guild | undefined,
  analyticsInstallationId: string,
  attribution?: {
    readonly retiredAttribution?: RetiredInstallAttribution;
    readonly retirementFailed?: boolean;
  },
): Promise<void> {
  if (connectedGuild !== undefined) {
    context.registerReplacement?.(
      connectedGuild,
      attribution?.retirementFailed === true
        ? { kind: "reconciliation-pending-retirement", analyticsInstallationId }
        : {
            kind: "reconciliation",
            analyticsInstallationId,
            ...(attribution?.retiredAttribution === undefined
              ? {}
              : { retiredAttribution: attribution.retiredAttribution }),
          },
    );
    return;
  }

  // Gateway lifecycle tasks are serialized per guild by bootstrap. Recheck
  // the cache once more before the generation-guarded write. A replacement
  // that arrived since the caller's read still needs the exact handoff for
  // its queued guildCreate task.
  const replacementGuild = context.readConnectedGuild();
  if (replacementGuild !== undefined) {
    await handleDisplacedSnapshot(
      context,
      replacementGuild,
      analyticsInstallationId,
      attribution,
    );
    return;
  }
  await captureGuildRemovalForInstallation(
    context.serverId,
    new Date(),
    analyticsInstallationId,
  );
}

async function finishHistoricalInstall(
  context: ReconciliationContext,
  analyticsInstallationId: string,
): Promise<HistoricalInstallFinish> {
  const connectedGuild = context.readConnectedGuild();
  if (connectedGuild !== context.guild) {
    await handleDisplacedSnapshot(
      context,
      connectedGuild,
      analyticsInstallationId,
    );
    return { remainedCurrent: false };
  }

  const retirementResult = await retireAttribution(context.serverId);
  const connectedGuildAfterRetirement = context.readConnectedGuild();
  if (connectedGuildAfterRetirement !== context.guild) {
    await handleDisplacedSnapshot(
      context,
      connectedGuildAfterRetirement,
      analyticsInstallationId,
      retirementResult.succeeded
        ? { retiredAttribution: retirementResult.retirement }
        : { retirementFailed: true },
    );
    return { remainedCurrent: false };
  }
  return {
    remainedCurrent: true,
    attributionRetirementSucceeded: retirementResult.succeeded,
  };
}

async function reconcilePendingRetirementReplacement(
  context: ReconciliationContext,
  ownerDiscordId: string,
  replacementClaim: GuildInstallReplacementClaim,
): Promise<boolean> {
  if (
    replacementClaim.replacement.kind !== "reconciliation-pending-retirement"
  ) {
    return true;
  }
  const retirementResult = await retireAttribution(context.serverId);
  const connectedGuild = context.readConnectedGuild();
  if (connectedGuild !== context.guild) {
    await handleDisplacedSnapshot(
      context,
      connectedGuild,
      replacementClaim.replacement.analyticsInstallationId,
      retirementResult.succeeded
        ? { retiredAttribution: retirementResult.retirement }
        : { retirementFailed: true },
    );
    return true;
  }
  if (!retirementResult.succeeded) {
    return false;
  }
  const completedReplacement: GuildInstallReplacement = {
    kind: "reconciliation",
    analyticsInstallationId:
      replacementClaim.replacement.analyticsInstallationId,
    retiredAttribution: retirementResult.retirement,
  };
  if (!replacementClaim.update(completedReplacement)) {
    return true;
  }
  const savedInstallationId = await saveGuildInstall(
    context.guild,
    ownerDiscordId,
    true,
    completedReplacement,
  );
  if (savedInstallationId !== undefined) {
    replacementClaim.accept();
  }
  return savedInstallationId !== undefined;
}

async function recoverRemovedInstall(
  context: ReconciliationContext,
  ownerDiscordId: string,
  previousRemovedAt: Date,
): Promise<void> {
  const recovery = await prisma.$transaction(async (tx) => {
    const analyticsInstallationId = await claimProvisionalGuildReinstall(
      context,
      ownerDiscordId,
      previousRemovedAt,
      tx,
    );
    if (analyticsInstallationId === undefined) {
      return;
    }
    const retirement = await retirePendingInstallAttributionInTransaction(
      context.serverId,
      tx,
    );
    return { analyticsInstallationId, retirement };
  });
  if (recovery === undefined) {
    return;
  }
  const connectedGuild = context.readConnectedGuild();
  if (connectedGuild !== context.guild) {
    await handleDisplacedSnapshot(
      context,
      connectedGuild,
      recovery.analyticsInstallationId,
      { retiredAttribution: recovery.retirement },
    );
    return;
  }

  // Token retirement and the provisional generation were committed atomically.
  // Promotion is generation-guarded, so a replacement or removal that wins the
  // row first owns the next lifecycle transition instead.
  const promotion = await prisma.guildInstall.updateMany({
    where: {
      serverId: context.serverId,
      analyticsInstallationId: recovery.analyticsInstallationId,
      removedAt: previousRemovedAt,
      analyticsLifecycleTracked: false,
    },
    data: { analyticsLifecycleTracked: true, removedAt: null },
  });
  if (promotion.count !== 1) {
    return;
  }
  // The guarded promotion owns the lifecycle transition. Emit its install
  // event synchronously before any awaited attribution work so a departure
  // during that work can only produce an install followed by its removal.
  captureGuildInstalled(
    {
      analyticsInstallationId: recovery.analyticsInstallationId,
      analyticsLifecycleTracked: true,
      serverId: context.serverId,
    },
    "reinstall",
    context.guild.memberCount,
  );
  // A browser request that consumed its token while this generation was
  // provisional could not attribute it. Once promotion makes the generation
  // eligible, immediately retry the pending token.
  await reconcilePendingInstallAttribution(context.serverId);
  const connectedGuildAfterAttribution = context.readConnectedGuild();
  if (connectedGuildAfterAttribution !== context.guild) {
    if (connectedGuildAfterAttribution === undefined) {
      await handleDisplacedSnapshot(
        context,
        connectedGuildAfterAttribution,
        recovery.analyticsInstallationId,
      );
    }
    return;
  }
}

async function claimProvisionalGuildReinstall(
  context: ReconciliationContext,
  addedByDiscordId: string,
  previousRemovedAt: Date,
  db: Pick<Db, "guildInstall">,
): Promise<string | undefined> {
  const identity: GuildInstallIdentity = {
    serverName: context.guild.name,
    ownerDiscordId: DiscordAccountIdSchema.parse(context.guild.ownerId),
    addedByDiscordId: DiscordAccountIdSchema.parse(addedByDiscordId),
    memberCount: context.guild.memberCount,
  };
  const analyticsInstallationId = randomUUID();
  const claim = await db.guildInstall.updateMany({
    where: {
      serverId: context.serverId,
      removedAt: previousRemovedAt,
    },
    data: createLifecycleReset({
      identity,
      installedAt: new Date(),
      analyticsInstallationId,
      analyticsLifecycleTracked: false,
      preserveRemoval: true,
    }),
  });
  return claim.count === 1 ? analyticsInstallationId : undefined;
}

async function createHistoricalInstall(
  context: ReconciliationContext,
  ownerDiscordId: string,
): Promise<boolean> {
  const install = await prisma.guildInstall.create({
    data: {
      serverId: context.serverId,
      serverName: context.guild.name,
      ownerDiscordId,
      // A historical connection has no trustworthy BotAdd audit-log entry.
      addedByDiscordId: ownerDiscordId,
      memberCount: context.guild.memberCount,
      installedAt: new Date(),
      analyticsLifecycleTracked: false,
    },
  });
  const finish = await finishHistoricalInstall(
    context,
    install.analyticsInstallationId,
  );
  if (!finish.remainedCurrent) {
    return true;
  }
  if (!finish.attributionRetirementSucceeded) {
    return false;
  }
  logger.info(
    `[Guild Install Reconciliation] Backfilled ${context.guild.name} (${context.guild.id})`,
  );
  return true;
}

async function reconcileExistingInstall(
  context: ReconciliationContext,
  analyticsInstallationId: string,
  analyticsLifecycleTracked: boolean,
): Promise<boolean> {
  if (analyticsLifecycleTracked) {
    // The consumed token is itself the durable retry marker when a previous
    // post-promotion reconciliation hit a transient database failure.
    await reconcilePendingInstallAttribution(context.serverId);
    return true;
  }
  // Historical backfills remain untracked, but a retry must repeat the same
  // ownership checks and exact handoff as the initial reconciliation.
  const finish = await finishHistoricalInstall(
    context,
    analyticsInstallationId,
  );
  return !finish.remainedCurrent || finish.attributionRetirementSucceeded;
}

/**
 * Backfill authorization rows for guilds already connected at ClientReady,
 * without welcoming them or inventing a new-install lifecycle.
 */
async function reconcileConnectedGuildInstall(
  guild: Guild,
  options: GuildInstallReconciliationOptions,
): Promise<boolean> {
  if (!guild.available) {
    return true;
  }

  try {
    const serverId = DiscordGuildIdSchema.parse(guild.id);
    const ownerDiscordId = DiscordAccountIdSchema.parse(guild.ownerId);
    const context: ReconciliationContext = {
      guild,
      serverId,
      readConnectedGuild: () =>
        options.getConnectedGuild === undefined
          ? guild
          : options.getConnectedGuild(guild.id),
      ...(options.registerReplacement === undefined
        ? {}
        : { registerReplacement: options.registerReplacement }),
    };
    if (context.readConnectedGuild() !== guild) {
      return true;
    }
    const replacementClaim = options.claimReplacement?.(guild);
    if (replacementClaim !== undefined) {
      if (
        replacementClaim.replacement.kind ===
        "reconciliation-pending-retirement"
      ) {
        return await reconcilePendingRetirementReplacement(
          context,
          ownerDiscordId,
          replacementClaim,
        );
      }
      const savedInstallationId = await saveGuildInstall(
        guild,
        ownerDiscordId,
        true,
        replacementClaim.replacement,
      );
      if (savedInstallationId !== undefined) {
        replacementClaim.accept();
      }
      return savedInstallationId !== undefined;
    }
    const existingInstall = await prisma.guildInstall.findUnique({
      where: { serverId },
      select: {
        analyticsInstallationId: true,
        analyticsLifecycleTracked: true,
        removedAt: true,
      },
    });
    if (context.readConnectedGuild() !== guild) {
      return true;
    }
    if (existingInstall !== null && existingInstall.removedAt !== null) {
      await recoverRemovedInstall(
        context,
        ownerDiscordId,
        existingInstall.removedAt,
      );
      return true;
    }
    return existingInstall === null
      ? await createHistoricalInstall(context, ownerDiscordId)
      : await reconcileExistingInstall(
          context,
          existingInstall.analyticsInstallationId,
          existingInstall.analyticsLifecycleTracked,
        );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return true;
    }
    logger.error(
      `[Guild Install Reconciliation] Failed to backfill ${guild.name} (${guild.id}):`,
      getErrorMessage(error),
    );
    return false;
  }
}

export async function reconcileConnectedGuildInstalls(
  guilds: Iterable<Guild>,
  options: GuildInstallReconciliationOptions = {},
): Promise<void> {
  let pendingGuilds = [...guilds];
  for (
    let attempt = 0;
    attempt <= RECONCILIATION_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const failedGuilds: Guild[] = [];
    for (const guild of pendingGuilds) {
      if (!(await reconcileConnectedGuildInstall(guild, options))) {
        failedGuilds.push(guild);
      }
    }
    if (failedGuilds.length === 0) {
      return;
    }
    pendingGuilds = failedGuilds.filter((guild) => {
      return options.getConnectedGuild === undefined
        ? guild.available
        : options.getConnectedGuild(guild.id) === guild && guild.available;
    });
    const retryDelay = RECONCILIATION_RETRY_DELAYS_MS[attempt];
    if (retryDelay === undefined || pendingGuilds.length === 0) {
      return;
    }
    if (options.waitBeforeRetry === undefined) {
      await Bun.sleep(retryDelay);
    } else {
      await options.waitBeforeRetry(retryDelay);
    }
  }
}
