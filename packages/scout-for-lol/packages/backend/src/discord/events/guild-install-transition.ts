import type {
  DiscordAccountId,
  DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import type { Db } from "#src/database/index.ts";

export type GuildInstallIdentity = {
  serverName: string;
  ownerDiscordId: DiscordAccountId;
  addedByDiscordId: DiscordAccountId;
  memberCount: number;
};

type LifecycleResetParams = {
  readonly identity: GuildInstallIdentity;
  readonly installedAt: Date;
  readonly analyticsInstallationId: string;
  readonly resetAttribution?: boolean;
  readonly analyticsLifecycleTracked?: boolean;
  readonly preserveRemoval?: boolean;
};

export function createLifecycleReset(params: LifecycleResetParams) {
  return {
    ...params.identity,
    installedAt: params.installedAt,
    analyticsInstallationId: params.analyticsInstallationId,
    analyticsLifecycleTracked: params.analyticsLifecycleTracked ?? true,
    firstCoreOutputAt: null,
    firstSubscriptionAt: null,
    emailNudgeSentAt: null,
    outreach3dSentAt: null,
    outreach14dSentAt: null,
    outreach30dSentAt: null,
    ...(params.preserveRemoval === true ? {} : { removedAt: null }),
    ...(params.resetAttribution === false
      ? {}
      : { attributedAt: null, attributionSurface: null }),
  } as const;
}

export async function preserveAttributedReplacement(params: {
  readonly db: Pick<Db, "guildInstall">;
  readonly serverId: DiscordGuildId;
  readonly expectedAnalyticsInstallationId: string;
  readonly identity: GuildInstallIdentity;
  readonly installedAt: Date;
  readonly attributedAtOrAfter?: Date;
}): Promise<boolean> {
  const claim = await params.db.guildInstall.updateMany({
    where: {
      serverId: params.serverId,
      analyticsInstallationId: params.expectedAnalyticsInstallationId,
      attributedAt:
        params.attributedAtOrAfter === undefined
          ? { not: null }
          : { gte: params.attributedAtOrAfter },
    },
    data: createLifecycleReset({
      identity: params.identity,
      installedAt: params.installedAt,
      analyticsInstallationId: params.expectedAnalyticsInstallationId,
      resetAttribution: false,
    }),
  });
  return claim.count === 1;
}

export async function claimObservedRemovalReplacement(params: {
  readonly db: Pick<Db, "guildInstall">;
  readonly serverId: DiscordGuildId;
  readonly observedAt: Date;
  readonly identity: GuildInstallIdentity;
  readonly installedAt: Date;
  readonly analyticsInstallationId: string;
}): Promise<string | undefined> {
  const currentInstall = await params.db.guildInstall.findUnique({
    where: { serverId: params.serverId },
    select: { analyticsInstallationId: true },
  });
  if (currentInstall === null) {
    return;
  }
  const preserveParams = {
    db: params.db,
    serverId: params.serverId,
    expectedAnalyticsInstallationId: currentInstall.analyticsInstallationId,
    identity: params.identity,
    installedAt: params.installedAt,
    attributedAtOrAfter: params.observedAt,
  } as const;
  if (await preserveAttributedReplacement(preserveParams)) {
    return currentInstall.analyticsInstallationId;
  }
  const claim = await params.db.guildInstall.updateMany({
    where: {
      serverId: params.serverId,
      analyticsInstallationId: currentInstall.analyticsInstallationId,
      OR: [{ attributedAt: null }, { attributedAt: { lt: params.observedAt } }],
    },
    data: createLifecycleReset({
      identity: params.identity,
      installedAt: params.installedAt,
      analyticsInstallationId: params.analyticsInstallationId,
    }),
  });
  if (claim.count === 1) {
    return params.analyticsInstallationId;
  }
  return (await preserveAttributedReplacement(preserveParams))
    ? currentInstall.analyticsInstallationId
    : undefined;
}
