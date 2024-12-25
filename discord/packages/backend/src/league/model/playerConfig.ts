import { PlayerConfig, PlayerConfigSchema } from "@discord/data";

const file = new URL("../../../players.json", import.meta.url);

export async function getPlayerConfigs(): Promise<PlayerConfig> {
  const playersJsonString = (await Deno.readFile(file)).toString();
  return PlayerConfigSchema.parse(JSON.parse(playersJsonString));
}
