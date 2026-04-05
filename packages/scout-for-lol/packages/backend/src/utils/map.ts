import { match } from "ts-pattern";

/**
 * Map ID to human-readable map name.
 * See: https://static.developer.riotgames.com/docs/lol/maps.json
 *
 * @param mapId - Riot map ID from the spectator or match API
 * @returns Human-readable map name
 */
export function mapIdToName(mapId: number): string {
  return match(mapId)
    .with(11, () => "Summoner's Rift")
    .with(12, () => "Howling Abyss")
    .with(21, () => "Nexus Blitz")
    .with(22, () => "Star Guardian")
    .with(30, () => "Rings of Wrath")
    .otherwise((id) => `Map ${id.toString()}`);
}
