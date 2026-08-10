import type { DiscordGuildId } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
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

export async function recordCoreOutputsDelivered(
  serverIds: Iterable<DiscordGuildId>,
  outputKind: CoreOutputKind,
): Promise<void> {
  await Promise.all(
    [...serverIds].map((serverId) =>
      recordCoreOutputDelivered(serverId, outputKind),
    ),
  );
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

  const [subscriptions, reports, competitions] = await Promise.all([
    db.subscription.count({ where: { serverId } }),
    db.report.count({ where: { serverId } }),
    db.competition.count({ where: { serverId } }),
  ]);
  const transition = await db.guildInstall.updateMany({
    where: {
      id: install.id,
      analyticsInstallationId: install.analyticsInstallationId,
      removedAt: null,
    },
    data: { removedAt },
  });
  if (transition.count !== 1) {
    return false;
  }

  analytics.capture(install, {
    event: "guild_removed",
    properties: {
      activation_state: removalActivationState({
        firstCoreOutputAt: install.firstCoreOutputAt,
        subscriptions,
        reports,
        competitions,
      }),
      tenure_bucket: tenureBucket(install.installedAt, removedAt),
    },
  });
  return true;
}
