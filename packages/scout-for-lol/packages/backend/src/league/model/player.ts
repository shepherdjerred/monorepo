import type { Player, PlayerConfigEntry } from "@scout-for-lol/data";
import { getRanks } from "@scout-for-lol/backend/league/model/rank";

export async function getPlayer(playerConfig: PlayerConfigEntry): Promise<Player> {
  const player: Player = {
    config: playerConfig,
    ranks: await getRanks(playerConfig),
  };

  return player;
}
