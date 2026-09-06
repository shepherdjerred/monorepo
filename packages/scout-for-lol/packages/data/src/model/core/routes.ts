import { match } from "ts-pattern";
import {
  type AccountRegionalRoute,
  type PlatformRoute,
  PlatformRouteSchema,
  type RegionalRoute,
} from "@scout-for-lol/domain/identity/routes.ts";
import { type Region, RegionSchema } from "#src/model/riot/league-account.ts";

export {
  type AccountRegionalRoute,
  AccountRegionalRouteSchema,
  type PlatformRoute,
  PlatformRouteSchema,
  type RegionalRoute,
  RegionalRouteSchema,
} from "@scout-for-lol/domain/identity/routes.ts";

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
