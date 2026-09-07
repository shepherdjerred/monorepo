import { z } from "zod";

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
