import { z } from "zod";

/**
 * The League client's own Clash payloads (`/lol-clash/v1/*`), as the Scout
 * Client uploads them. Distinct from `league/raw-clash.schema.ts`, which is
 * Riot's public Clash-V1 API.
 *
 * These shapes are the best available description of the League client's
 * Clash resources, written before a Clash window could confirm them, so every
 * field is optional and objects stay loose: a payload that differs reads as
 * "unknown" for that field rather than failing. Tighten them against real
 * captures once a window has produced some.
 */

const IdSchema = z.union([z.string(), z.number()]).transform(String);

export const LcuClashRosterMemberSchema = z
  .object({
    summonerId: IdSchema.optional(),
    puuid: z.string().optional(),
    position: z.string().optional(),
    gameName: z.string().optional(),
    summonerName: z.string().optional(),
    /** Locked in for the current phase. */
    lockedIn: z.boolean().optional(),
  })
  .loose();

export const LcuClashRosterSchema = z
  .object({
    id: IdSchema.optional(),
    tournamentId: IdSchema.optional(),
    name: z.string().optional(),
    shortName: z.string().optional(),
    tier: z.number().optional(),
    captainId: IdSchema.optional(),
    bracketId: IdSchema.optional(),
    isRegistered: z.boolean().optional(),
    members: z.array(LcuClashRosterMemberSchema).optional(),
  })
  .loose();

export const LcuClashBracketMatchSchema = z
  .object({
    id: IdSchema.optional(),
    roundId: z.number().optional(),
    rosterId1: IdSchema.optional(),
    rosterId2: IdSchema.optional(),
    winnerId: IdSchema.optional(),
    status: z.string().optional(),
  })
  .loose();

export const LcuClashBracketRosterSchema = z
  .object({
    rosterId: IdSchema.optional(),
    name: z.string().optional(),
    shortName: z.string().optional(),
  })
  .loose();

export const LcuClashBracketSchema = z
  .object({
    id: IdSchema.optional(),
    size: z.number().optional(),
    matches: z.array(LcuClashBracketMatchSchema).optional(),
    rosters: z.array(LcuClashBracketRosterSchema).optional(),
  })
  .loose();

export const LcuClashTournamentPhaseSchema = z
  .object({
    id: IdSchema.optional(),
    registrationTime: z.number().optional(),
    startTime: z.number().optional(),
    cancelled: z.boolean().optional(),
  })
  .loose();

export const LcuClashTournamentSchema = z
  .object({
    id: IdSchema.optional(),
    nameLocKey: z.string().optional(),
    nameLocKeySecondary: z.string().optional(),
    status: z.string().optional(),
    phases: z.array(LcuClashTournamentPhaseSchema).optional(),
  })
  .loose();

export type LcuClashRoster = z.infer<typeof LcuClashRosterSchema>;
export type LcuClashBracket = z.infer<typeof LcuClashBracketSchema>;
export type LcuClashTournament = z.infer<typeof LcuClashTournamentSchema>;
