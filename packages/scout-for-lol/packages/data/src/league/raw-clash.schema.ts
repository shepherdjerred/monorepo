import { z } from "zod";

/**
 * Zod schemas for Riot Clash-v1.
 *
 * Clash-v1 is platform-routed (`na1.api.riotgames.com`, etc.). It returns
 * schedule and registration, never match results. Player lookup is empty when
 * Clash is inactive.
 */

export const ClashPositionSchema = z.enum([
  "UNSELECTED",
  "FILL",
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
]);
export type ClashPosition = z.infer<typeof ClashPositionSchema>;

export const ClashRoleSchema = z.enum(["CAPTAIN", "MEMBER"]);
export type ClashRole = z.infer<typeof ClashRoleSchema>;

export const RawClashPlayerSchema = z.strictObject({
  /** Present on current by-puuid responses. */
  puuid: z.string().min(1).optional(),
  /** Legacy identity; TeamDTO.captain still uses this on some shards. */
  summonerId: z.string().min(1).optional(),
  /**
   * Set on `GET players/by-puuid`. Nested `TeamDTO.players` omit it because
   * the team id is the parent resource.
   */
  teamId: z.string().min(1).optional(),
  position: ClashPositionSchema,
  role: ClashRoleSchema,
});
export type RawClashPlayer = z.infer<typeof RawClashPlayerSchema>;

export const RawClashPlayerListSchema = z.array(RawClashPlayerSchema);
export type RawClashPlayerList = z.infer<typeof RawClashPlayerListSchema>;

export const RawClashTeamSchema = z.strictObject({
  id: z.string().min(1),
  tournamentId: z.number().int(),
  name: z.string(),
  iconId: z.number().int(),
  tier: z.number().int(),
  captain: z.string(),
  abbreviation: z.string(),
  players: z.array(RawClashPlayerSchema),
});
export type RawClashTeam = z.infer<typeof RawClashTeamSchema>;

export const RawClashTournamentPhaseSchema = z.strictObject({
  id: z.number().int(),
  registrationTime: z.number().int(),
  startTime: z.number().int(),
  cancelled: z.boolean(),
});
export type RawClashTournamentPhase = z.infer<
  typeof RawClashTournamentPhaseSchema
>;

export const RawClashTournamentSchema = z.strictObject({
  id: z.number().int(),
  themeId: z.number().int(),
  nameKey: z.string().min(1),
  nameKeySecondary: z.string().min(1),
  schedule: z.array(RawClashTournamentPhaseSchema),
});
export type RawClashTournament = z.infer<typeof RawClashTournamentSchema>;

export const RawClashTournamentListSchema = z.array(RawClashTournamentSchema);
export type RawClashTournamentList = z.infer<
  typeof RawClashTournamentListSchema
>;
