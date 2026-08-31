import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Every `Player` row in the guild with a linked Discord identity and at
 * least one Riot account, ordered by `id` ascending for deterministic
 * downstream processing.
 *
 * Shared by dare shortlist building and weekly-parlay subject loading: both
 * start from this exact candidate set and diverge only in how they group or
 * label the rows afterward — dares union accounts across every `Player` row
 * one Discord user owns, while weekly parlays treat each `Player` row as its
 * own subject. The query itself is one definition so the two candidate
 * pools can never silently disagree about who counts as "tracked and
 * linked".
 */
export function findTrackedPlayersWithAccounts(
  serverId: DiscordGuildId,
  prismaClient: ExtendedPrismaClient,
) {
  return prismaClient.player.findMany({
    where: { serverId, discordId: { not: null }, accounts: { some: {} } },
    select: {
      id: true,
      alias: true,
      discordId: true,
      accounts: {
        select: { puuid: true, createdTime: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });
}
