import { match } from "ts-pattern";
import { z } from "zod";

/**
 * Map names returned by the Riot API.
 * See: https://static.developer.riotgames.com/docs/lol/maps.json
 */
export type MapName = z.infer<typeof MapNameSchema>;
export const MapNameSchema = z.enum([
  "Summoner's Rift",
  "Howling Abyss",
  "Nexus Blitz",
  "Star Guardian",
  "Rings of Wrath",
  "The Bandlewood",
]);

/**
 * Resolve a Riot map ID to its human-readable map name.
 * Throws on unknown map IDs — fail fast on unsupported maps.
 *
 * @param mapId - Riot map ID from the spectator or match API
 * @returns Human-readable map name
 */
export function mapIdToName(mapId: number): MapName {
  return match(mapId)
    .returnType<MapName>()
    .with(11, () => "Summoner's Rift")
    .with(12, () => "Howling Abyss")
    .with(21, () => "Nexus Blitz")
    .with(22, () => "Star Guardian")
    .with(30, () => "Rings of Wrath")
    .with(35, () => "The Bandlewood")
    .otherwise((id) => {
      throw new Error(`Unknown map ID: ${id.toString()}`);
    });
}
