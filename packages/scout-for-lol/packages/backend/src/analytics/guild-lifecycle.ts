import type { DiscordGuildId } from "@scout-for-lol/data";
import { chunk } from "remeda";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { productAnalyticsFailuresTotal } from "#src/metrics/product-analytics.ts";
import {
  getProductAnalytics,
  type AnalyticsInstallation,
  type CoreOutputKind,
  type InstallKind,
  type MemberCountBucket,
  type ProductAnalytics,
  type RemovalActivationState,
  type SubscriptionSurface,
  type TenureBucket,
} from "#src/analytics/product-analytics.ts";

const logger = createLogger("guild-lifecycle-analytics");
const DAY_MS = 24 * 60 * 60 * 1000;

export function memberCountBucket(memberCount: number): MemberCountBucket {
  if (memberCount <= 10) return "1-10";
  if (memberCount <= 50) return "11-50";
  if (memberCount <= 250) return "51-250";
  if (memberCount <= 1000) return "251-1000";
  return "1001+";
}

export function tenureBucket(installedAt: Date, removedAt: Date): TenureBucket {
  const days = (removedAt.getTime() - installedAt.getTime()) / DAY_MS;
  if (days < 1) return "<1d";
  if (days < 7) return "1-6d";
  if (days < 30) return "7-29d";
  if (days < 90) return "30-89d";
  return "90d+";
}

export function removalActivationState(input: {
  firstCoreOutputAt: Date | null;
  subscriptions: number;
  reports: number;
  competitions: number;
}): RemovalActivationState {
  if (input.firstCoreOutputAt !== null) return "activated";
  if (input.subscriptions + input.reports + input.competitions > 0) {
    return "configured";
  }
  return "installed_only";
}

export function captureGuildInstalled(
  installation: AnalyticsInstallation,
  installKind: InstallKind,
  memberCount: number,
  analytics: ProductAnalytics = getProductAnalytics(),
): void {
  analytics.capture(installation, {
    event: "guild_installed",
    properties: {
      install_kind: installKind,
      member_count_bucket: memberCountBucket(memberCount),
    },
  });
}

export async function captureFirstSubscriptionCreated(
  serverId: DiscordGuildId,
  surface: SubscriptionSurface,
  db: ExtendedPrismaClient = prisma,
  analytics: ProductAnalytics = getProductAnalytics(),
): Promise<void> {
  try {
    const install = await db.guildInstall.findUnique({
      where: { serverId },
      select: {
        id: true,
        serverId: true,
        analyticsInstallationId: true,
        analyticsLifecycleTracked: true,
        firstSubscriptionAt: true,
      },
    });
    if (install === null) {
      logger.warn(
        "Cannot capture first subscription without a GuildInstall lifecycle row",
      );
      return;
    }
    if (install.firstSubscriptionAt !== null) {
      return;
    }

    const claim = await db.guildInstall.updateMany({
      where: {
        id: install.id,
        analyticsInstallationId: install.analyticsInstallationId,
        firstSubscriptionAt: null,
      },
      data: { firstSubscriptionAt: new Date() },
    });
    if (claim.count !== 1 || !install.analyticsLifecycleTracked) {
      return;
    }

    analytics.capture(install, {
      event: "first_subscription_created",
      properties: { surface },
    });
  } catch (error) {
    logger.error(
      "Failed to read guild lifecycle for first subscription analytics",
      getErrorMessage(error),
    );
  }
}

export async function recordCoreOutputDelivered(
  serverId: DiscordGuildId,
  outputKind: CoreOutputKind,
  options?: {
    db?: ExtendedPrismaClient;
    analytics?: ProductAnalytics;
    deliveredAt?: Date;
  },
): Promise<void> {
  try {
    const db = options?.db ?? prisma;
    const analytics = options?.analytics ?? getProductAnalytics();
    const deliveredAt = options?.deliveredAt ?? new Date();
    const install = await db.guildInstall.findUnique({
      where: { serverId },
      select: {
        id: true,
        serverId: true,
        analyticsInstallationId: true,
        analyticsLifecycleTracked: true,
        firstCoreOutputAt: true,
      },
    });
    if (install === null) {
      logger.warn(
        "Cannot capture core output without a GuildInstall lifecycle row",
      );
      return;
    }

    const firstOutputClaim =
      install.firstCoreOutputAt === null
        ? await db.guildInstall.updateMany({
            where: {
              id: install.id,
              analyticsInstallationId: install.analyticsInstallationId,
              firstCoreOutputAt: null,
            },
            data: { firstCoreOutputAt: deliveredAt },
          })
        : { count: 0 };

    analytics.capture(install, {
      event: "core_output_delivered",
      properties: { output_kind: outputKind },
    });

    if (firstOutputClaim.count === 1 && install.analyticsLifecycleTracked) {
      analytics.capture(install, {
        event: "first_core_output_delivered",
        properties: { output_kind: outputKind },
      });
    }
  } catch (error) {
    logger.error(
      "Failed to record delivered core output analytics",
      getErrorMessage(error),
    );
  }
}

// Bounds how many guilds are processed at once: recordCoreOutputDelivered
// does a Prisma read plus a conditional update per guild, and an unbounded
// Promise.all over a large delivered-guild set (e.g. a weekly digest) would
// fire all of those reads/updates against the database concurrently.
const RECORD_CORE_OUTPUTS_BATCH_SIZE = 10;

export async function recordCoreOutputsDelivered(
  serverIds: Iterable<DiscordGuildId>,
  outputKind: CoreOutputKind,
  options?: {
    db?: ExtendedPrismaClient;
    analytics?: ProductAnalytics;
  },
): Promise<void> {
  for (const batch of chunk([...serverIds], RECORD_CORE_OUTPUTS_BATCH_SIZE)) {
    // recordCoreOutputDelivered catches and logs its own errors, so one
    // guild's failure never aborts the batch or the guilds after it.
    await Promise.all(
      batch.map((serverId) =>
        recordCoreOutputDelivered(serverId, outputKind, options),
      ),
    );
  }
}

export async function deliverTrackedCoreOutput(params: {
  serverId: DiscordGuildId;
  outputKind: CoreOutputKind;
  deliver: () => Promise<void>;
  db?: ExtendedPrismaClient;
  analytics?: ProductAnalytics;
}): Promise<void> {
  await params.deliver();
  await recordCoreOutputDelivered(params.serverId, params.outputKind, {
    ...(params.db === undefined ? {} : { db: params.db }),
    ...(params.analytics === undefined ? {} : { analytics: params.analytics }),
  });
}

export async function captureGuildRemoval(
  serverId: DiscordGuildId,
  removedAt: Date,
  db: ExtendedPrismaClient = prisma,
  analytics: ProductAnalytics = getProductAnalytics(),
): Promise<boolean> {
  const install = await db.guildInstall.findUnique({
    where: { serverId },
    select: {
      id: true,
      serverId: true,
      installedAt: true,
      removedAt: true,
      analyticsInstallationId: true,
      analyticsLifecycleTracked: true,
      firstCoreOutputAt: true,
    },
  });
  if (install?.removedAt !== null) {
    return false;
  }

  const claimWhere = {
    id: install.id,
    analyticsInstallationId: install.analyticsInstallationId,
    removedAt: null,
  };

  // Classify BEFORE claiming the removal, atomically with the claim, in one
  // transaction. cleanupRemovedGuild runs its (idempotent) deletion
  // transaction regardless of whether this call wins the claim below — a
  // caller that loses the claim proceeds straight to deleting
  // subscription/report/competition rows. On SQLite that deletion cannot
  // even begin until this transaction has fully committed (one connection,
  // strictly serialized transactions), so wrapping the counts and the claim
  // together guarantees no concurrent deletion can zero them out before
  // they're captured.
  let claim: {
    claimed: boolean;
    subscriptions: number;
    reports: number;
    competitions: number;
  };
  try {
    claim = await db.$transaction(async (tx) => {
      const [subscriptions, reports, competitions] = await Promise.all([
        tx.subscription.count({ where: { serverId } }),
        tx.report.count({ where: { serverId } }),
        tx.competition.count({ where: { serverId } }),
      ]);
      const transition = await tx.guildInstall.updateMany({
        where: claimWhere,
        data: { removedAt },
      });
      return {
        claimed: transition.count === 1,
        subscriptions,
        reports,
        competitions,
      };
    });
  } catch (error) {
    productAnalyticsFailuresTotal.inc({
      operation: "guild-removed-classification",
    });
    logger.error(
      "Failed to classify guild removal; claiming the removal without it",
      getErrorMessage(error),
    );
    // The classification reads must never block the removal stamp itself
    // (see cleanupRemovedGuild) — retry the claim alone, with no event.
    const transition = await db.guildInstall.updateMany({
      where: claimWhere,
      data: { removedAt },
    });
    return transition.count === 1;
  }

  if (!claim.claimed) {
    return false;
  }

  try {
    analytics.capture(install, {
      event: "guild_removed",
      properties: {
        activation_state: removalActivationState({
          firstCoreOutputAt: install.firstCoreOutputAt,
          subscriptions: claim.subscriptions,
          reports: claim.reports,
          competitions: claim.competitions,
        }),
        tenure_bucket: tenureBucket(install.installedAt, removedAt),
      },
    });
  } catch (error) {
    productAnalyticsFailuresTotal.inc({
      operation: "guild-removed-classification",
    });
    logger.error(
      "Failed to capture guild removal analytics",
      getErrorMessage(error),
    );
  }
  return true;
}
