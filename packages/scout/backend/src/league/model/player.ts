import type { Player, PlayerConfigEntry } from "@shepherdjerred/scout-data";
import { getRanks } from "@shepherdjerred/scout-backend/league/model/rank";

export async function getPlayer(playerConfig: PlayerConfigEntry): Promise<Player> {
  const player: Player = {
    config: playerConfig,
    ranks: await getRanks(playerConfig),
  };

  return player;
}
