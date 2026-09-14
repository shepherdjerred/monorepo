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

/** "" is the guild-channel audience; see the model's sentinel note. */
function audienceWhere(audience: TipAudience) {
  return {
    serverId: audience.serverId,
    audienceId: audience.discordId ?? "",
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
 * Claim a tip for this audience, returning whether the claim was won.
 *
 * The insert IS the claim. Two deliveries to the same guild can run
 * concurrently — two channels, or a post-match and a pre-match message — and
 * both can read the same cooldown and shown-set before either writes. The
 * unique constraint settles it: exactly one insert survives, so the same tip
 * cannot go out twice.
 *
 * Claiming happens before the send rather than after, so the loser of a race
 * never renders the tip at all. {@link releaseTipClaim} undoes the claim when
 * the send then fails.
 */
export async function claimTip(
  input: TipAudience & { tipKey: FeatureTipKey; shownAt?: Date },
  db: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const { count } = await db.featureTipImpression.createMany({
    data: [
      {
        ...audienceWhere(input),
        tipKey: input.tipKey,
        ...(input.shownAt === undefined ? {} : { shownAt: input.shownAt }),
      },
    ],
    skipDuplicates: true,
  });
  return count > 0;
}

/**
 * Give a claimed tip back after a failed send, so it stays eligible.
 *
 * Deliberately narrow: it deletes only this audience's row for this tip, and
 * only the caller that won the claim ever calls it.
 */
export async function releaseTipClaim(
  input: TipAudience & { tipKey: FeatureTipKey },
  db: ExtendedPrismaClient = prisma,
): Promise<void> {
  await db.featureTipImpression.deleteMany({
    where: { ...audienceWhere(input), tipKey: input.tipKey },
  });
}
