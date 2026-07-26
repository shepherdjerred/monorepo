import {
  DiscordAccountIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Build a player-ID→Discord-ID map for every tracked player in a server. The
 * report result carries player identities, so mention rendering never infers
 * an identity from a display label. A non-null stored ID is a contract and is
 * validated here; only null represents an intentionally unlinked player.
 */
export async function loadPlayerDiscordIds(
  prisma: ExtendedPrismaClient,
  serverId: DiscordGuildId,
): Promise<Map<number, DiscordAccountId>> {
  const players = await prisma.player.findMany({
    where: { serverId },
    select: { id: true, discordId: true },
  });

  const playerDiscordIds = new Map<number, DiscordAccountId>();
  for (const player of players) {
    if (player.discordId !== null) {
      playerDiscordIds.set(
        player.id,
        DiscordAccountIdSchema.parse(player.discordId),
      );
    }
  }
  return playerDiscordIds;
}
