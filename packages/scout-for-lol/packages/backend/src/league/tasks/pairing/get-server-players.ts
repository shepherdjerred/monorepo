import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import type { DiscordGuildId } from "@scout-for-lol/data/index";

const logger = createLogger("pairing-get-server-players");

/**
 * Player with their accounts for pairing calculation
 */
export type ServerPlayer = {
  id: number;
  alias: string;
  discordId: string | null;
  puuids: string[];
};

/**
 * Get all tracked players for a specific server with their PUUIDs
 */
export async function getServerPlayers(
  serverId: DiscordGuildId,
): Promise<ServerPlayer[]> {
  logger.info(`[GetServerPlayers] Fetching players for server: ${serverId}`);

  const players = await prisma.player.findMany({
    where: {
      serverId,
    },
    include: {
      accounts: true,
    },
  });

  const result: ServerPlayer[] = players.map((player) => ({
    id: player.id,
    alias: player.alias,
    discordId: player.discordId,
    puuids: player.accounts.map((account) => account.puuid),
  }));

  logger.info(
    `[GetServerPlayers] Found ${result.length.toString()} players with ${result.reduce((sum, p) => sum + p.puuids.length, 0).toString()} accounts`,
  );

  return result;
}

/**
 * Create a map from PUUID to player alias for quick lookup
 */
export function createPuuidToAliasMap(
  players: ServerPlayer[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const player of players) {
    for (const puuid of player.puuids) {
      map.set(puuid, player.alias);
    }
  }
  return map;
}

/**
 * Create a map from alias to Discord ID for mentions
 */
export function createAliasToDiscordIdMap(
  players: ServerPlayer[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const player of players) {
    if (player.discordId) {
      map.set(player.alias, player.discordId);
    }
  }
  return map;
}
