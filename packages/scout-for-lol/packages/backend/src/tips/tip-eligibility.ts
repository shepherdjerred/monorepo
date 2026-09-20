import type { DiscordGuildId } from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { FeatureTipKey } from "#src/analytics/product-analytics.ts";
import { FEATURE_TIPS, type FeatureTip } from "#src/tips/tip-catalog.ts";

/**
 * Whether the guild has already used the feature a tip advertises.
 *
 * Every probe is derived from rows the feature itself writes — there is no
 * separate usage counter to drift. A tip is only worth showing to someone who
 * has not found the feature yet.
 */
const HAS_USED: Record<
  FeatureTipKey,
  (serverId: DiscordGuildId, db: ExtendedPrismaClient) => Promise<boolean>
> = {
  competitions: async (serverId, db) =>
    (await db.competition.count({ where: { serverId }, take: 1 })) > 0,
  "scheduled-reports": async (serverId, db) =>
    (await db.report.count({ where: { serverId }, take: 1 })) > 0,
  "queue-filters": async (serverId, db) =>
    (await db.subscription.count({
      where: { serverId, filters: { not: null } },
      take: 1,
    })) > 0,
  // One tracked player is the bare minimum a working install has; the tip is
  // for servers that never added the rest of their group. Counted over
  // DISTINCT players, not subscription rows: the same player subscribed in two
  // channels is two rows and would otherwise read as a well-populated guild.
  "track-more-players": async (serverId, db) => {
    const players = await db.subscription.findMany({
      where: { serverId },
      select: { playerId: true },
      distinct: ["playerId"],
      take: 2,
    });
    return players.length > 1;
  },
  "hall-of-fame": async (serverId, db) =>
    (await db.hallSettings.count({ where: { guildId: serverId }, take: 1 })) >
    0,
  duels: async (serverId, db) =>
    (await db.duelSeries.count({ where: { guildId: serverId }, take: 1 })) > 0,
  dares: async (serverId, db) =>
    (await db.bucksDareV2.count({ where: { serverId }, take: 1 })) > 0 ||
    (await db.bucksDare.count({ where: { serverId }, take: 1 })) > 0,
  transfers: async (serverId, db) =>
    (await db.bucksLedgerEntry.count({
      where: { kind: "transfer_sent", bucksAccount: { serverId } },
      take: 1,
    })) > 0,
  "custom-nights": async (serverId, db) =>
    (await db.customNight.count({ where: { guildId: serverId }, take: 1 })) > 0,
};

/** Every flag a tip names must be on; a feature with none is always available. */
async function isAvailable(
  tip: FeatureTip,
  serverId: DiscordGuildId,
): Promise<boolean> {
  const verdicts = await Promise.all(
    tip.flags.map(
      async (flag) => await isPolicyEnabled(flag, { server: serverId }),
    ),
  );
  return verdicts.every(Boolean);
}

/**
 * Tips this guild could act on right now: the feature is enabled for it and it
 * has not used the feature yet.
 *
 * `alreadyShown` keys are excluded here rather than at the call site so a tip
 * the guild has already seen can never be reconsidered.
 */
export async function eligibleTips(input: {
  serverId: DiscordGuildId;
  alreadyShown: ReadonlySet<string>;
  db?: ExtendedPrismaClient;
}): Promise<FeatureTip[]> {
  const db = input.db ?? prisma;
  const candidates = FEATURE_TIPS.filter(
    (tip) => !input.alreadyShown.has(tip.key),
  );
  const verdicts = await Promise.all(
    candidates.map(async (tip) => {
      if (!(await isAvailable(tip, input.serverId))) return;
      return (await HAS_USED[tip.key](input.serverId, db)) ? undefined : tip;
    }),
  );
  return verdicts.filter((tip) => tip !== undefined);
}
