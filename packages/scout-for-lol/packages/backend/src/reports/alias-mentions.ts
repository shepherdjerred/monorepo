import type { DiscordGuildId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Build an alias→Discord-ID map for every tracked player in a server, so
 * report rendering can turn a leaderboard row's player alias into an
 * `@mention`. Players without a linked Discord ID are omitted; callers fall
 * back to the plain alias for those.
 */
export async function loadAliasToDiscordId(
  prisma: ExtendedPrismaClient,
  serverId: DiscordGuildId,
): Promise<Map<string, string>> {
  const players = await prisma.player.findMany({
    where: { serverId },
    select: { alias: true, discordId: true },
  });

  const aliasToDiscordId = new Map<string, string>();
  for (const player of players) {
    if (player.discordId !== null && player.discordId.length > 0) {
      aliasToDiscordId.set(player.alias, player.discordId);
    }
  }
  return aliasToDiscordId;
}
