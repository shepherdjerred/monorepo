import { Player } from "@discord/data";
import { PlayerConfigEntry } from "@discord/data";
import { getRanks } from "./rank.ts";

export async function getPlayer(
  playerConfig: PlayerConfigEntry
): Promise<Player> {
  return {
    config: playerConfig,
    ranks: await getRanks(playerConfig),
  };
}
