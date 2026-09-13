import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Every `Player` row in the guild with a linked Discord identity and at
 * least one Riot account, ordered by `id` ascending for deterministic
 * downstream processing.
 *
 * Shared by every consumer that needs the guild's candidate set, so they can
 * never silently disagree about who counts as "tracked and linked". Consumers
 * diverge only in how they group or label the rows afterward — dares, for
 * instance, union accounts across every `Player` row one Discord user owns.
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
