import { PlayerConfig, PlayerConfigSchema } from "@discord/data";

export async function getPlayerConfigs(): Promise<PlayerConfig> {
  const playersJson = await Deno.readTextFile("players.json");
  return PlayerConfigSchema.parse(JSON.parse(playersJson));
}
