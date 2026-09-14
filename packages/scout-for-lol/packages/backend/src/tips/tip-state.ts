import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { FeatureTipKey } from "#src/analytics/product-analytics.ts";

/**
 * Who a tip is aimed at. A guild-channel message has no `discordId`; a DM
 * carries the recipient's, so one member's cadence never spends the channel's.
 */
export type TipAudience = {
  serverId: DiscordGuildId;
  discordId?: DiscordAccountId | undefined;
};

function audienceWhere(audience: TipAudience) {
  return {
    serverId: audience.serverId,
    discordId: audience.discordId ?? null,
  };
}

/** The tip keys this audience has already been shown. */
export async function shownTipKeys(
  audience: TipAudience,
  db: ExtendedPrismaClient = prisma,
): Promise<Set<string>> {
  const rows = await db.featureTipImpression.findMany({
    where: audienceWhere(audience),
    select: { tipKey: true },
  });
  return new Set(rows.map((row) => row.tipKey));
}

/** When this audience last saw a tip, or undefined if it never has. */
export async function lastTipShownAt(
  audience: TipAudience,
  db: ExtendedPrismaClient = prisma,
): Promise<Date | undefined> {
  const row = await db.featureTipImpression.findFirst({
    where: audienceWhere(audience),
    orderBy: { shownAt: "desc" },
    select: { shownAt: true },
  });
  return row?.shownAt;
}

/**
 * Record a delivered tip.
 *
 * Written after the message is accepted, never before: a tip that failed to
 * send must stay eligible rather than being silently burned.
 */
export async function recordTipShown(
  input: TipAudience & { tipKey: FeatureTipKey; shownAt?: Date },
  db: ExtendedPrismaClient = prisma,
): Promise<void> {
  await db.featureTipImpression.create({
    data: {
      ...audienceWhere(input),
      tipKey: input.tipKey,
      ...(input.shownAt === undefined ? {} : { shownAt: input.shownAt }),
    },
  });
}
