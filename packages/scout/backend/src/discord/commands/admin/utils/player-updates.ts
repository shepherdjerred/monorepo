import type { PrismaClient } from "@shepherdjerred/scout-backend/generated/prisma/client/index.js";
import type { DiscordAccountId } from "@shepherdjerred/scout-data";
import type { PlayerWithSubscriptions } from "@shepherdjerred/scout-backend/discord/commands/admin/utils/player-queries.ts";

/**
 * Update a player's Discord ID
 * Returns the updated player with accounts and subscriptions included
 */
export async function updatePlayerDiscordId(
  prisma: PrismaClient,
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
