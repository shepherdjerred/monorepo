import type { ExtendedPrismaClient } from "@scout-for-lol/backend/database/index.ts";
import type { DiscordAccountId } from "@scout-for-lol/data";
import type { PlayerWithSubscriptions } from "@scout-for-lol/backend/discord/commands/admin/utils/player-queries.ts";

/**
 * Update a player's Discord ID
 * Returns the updated player with accounts and subscriptions included
 */
export async function updatePlayerDiscordId(
  prisma: ExtendedPrismaClient,
  playerId: number,
  discordId: DiscordAccountId | null,
): Promise<PlayerWithSubscriptions> {
  const now = new Date();

  const updatedPlayer = await prisma.player.update({
    where: {
      id: playerId,
    },
    data: {
      discordId,
      updatedTime: now,
    },
    include: {
      accounts: true,
      subscriptions: true,
    },
  });

  return updatedPlayer;
}
