import { z } from "zod";
import { match } from "ts-pattern";
import { type Region, RegionSchema } from "#src/model/league-account.ts";

/**
 * Platform routing values used by Riot platform-specific APIs (LeagueV4, SpectatorV5, ChampionMasteryV4).
 * Host format: https://${platform.toLowerCase()}.api.riotgames.com
 */
export type PlatformRoute = z.infer<typeof PlatformRouteSchema>;
export const PlatformRouteSchema = z.enum([
  "BR1",
  "EUN1",
  "EUW1",
  "JP1",
  "KR",
  "LA1",
  "LA2",
  "ME1",
  "NA1",
  "OC1",
  "RU",
  "SG2",
  "TR1",
  "TW2",
  "VN2",
  "PBE1",
]);

/**
 * Regional routing values used by Riot regional APIs (MatchV5, AccountV1, TournamentV5).
 * Host format: https://${regionalRoute.toLowerCase()}.api.riotgames.com
 */
export type RegionalRoute = z.infer<typeof RegionalRouteSchema>;
export const RegionalRouteSchema = z.enum([
  "AMERICAS",
  "ASIA",
  "EUROPE",
  "SEA",
]);

/**
 * Account API regional routing values. Riot Account-V1 routes SEA accounts through the ASIA regional host.
 */
export type AccountRegionalRoute = z.infer<typeof AccountRegionalRouteSchema>;
export const AccountRegionalRouteSchema = z.enum([
  "AMERICAS",
  "ASIA",
  "EUROPE",
]);

/**
 * Map a domain Region enum to its platform routing value.
 */
export function regionToPlatformRoute(region: Region): PlatformRoute {
  return match(region)
    .with("BRAZIL", () => "BR1" as const)
    .with("EU_EAST", () => "EUN1" as const)
    .with("EU_WEST", () => "EUW1" as const)
    .with("KOREA", () => "KR" as const)
    .with("LAT_NORTH", () => "LA1" as const)
    .with("LAT_SOUTH", () => "LA2" as const)
    .with("AMERICA_NORTH", () => "NA1" as const)
    .with("OCEANIA", () => "OC1" as const)
    .with("TURKEY", () => "TR1" as const)
    .with("RUSSIA", () => "RU" as const)
    .with("JAPAN", () => "JP1" as const)
    .with("VIETNAM", () => "VN2" as const)
    .with("TAIWAN", () => "TW2" as const)
    .with("SINGAPORE", () => "SG2" as const)
    .with("PBE", () => "PBE1" as const)
    .exhaustive();
}

/**
 * Map a platform routing value (or domain Region) to its MatchV5 regional routing group.
 */
export function platformToRegionalRoute(
  platform: PlatformRoute | Region,
): RegionalRoute {
  const regionParsed = RegionSchema.safeParse(platform);
  const resolvedPlatform: PlatformRoute = regionParsed.success
    ? regionToPlatformRoute(regionParsed.data)
    : PlatformRouteSchema.parse(platform);

  return match(resolvedPlatform)
    .with("NA1", "BR1", "LA1", "LA2", () => "AMERICAS" as const)
    .with("EUN1", "EUW1", "TR1", "RU", "ME1", () => "EUROPE" as const)
    .with("KR", "JP1", () => "ASIA" as const)
    .with("OC1", "SG2", "TW2", "VN2", () => "SEA" as const)
    .with("PBE1", () => "AMERICAS" as const)
    .exhaustive();
}

/**
 * Map a platform routing value (or domain Region) to its Account-V1 regional routing group.
 * (SEA platforms route to ASIA for the Account API).
 */
export function platformToAccountRegionalRoute(
  platform: PlatformRoute | Region,
): AccountRegionalRoute {
  const route = platformToRegionalRoute(platform);
  return route === "SEA" ? "ASIA" : route;
}
