import { z } from "zod";
import { LaneSchema, RankSchema } from "@scout-for-lol/data";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";

/**
 * What `LiveGameRoster.participants` and `LiveGameRoster.recentForm` hold.
 *
 * Both are JSON columns, so these schemas are the contract: the writer parses
 * on the way in and every reader parses on the way out, and a row that no
 * longer matches is a broken contract that fails loudly rather than a page
 * that quietly shows less.
 */

/** A game's roster is at most ten players; Arena lobbies are not recorded. */
export const LIVE_ROSTER_MAX_PARTICIPANTS = 10;

/** How many of a stranger's ranked games the recent-form summary covers. */
export const LIVE_FORM_GAME_COUNT = 5;

/**
 * One player in the lobby, as the spectator snapshot named them.
 *
 * `puuid` and `riotId` are null together when Riot scrubbed the participant:
 * the payload then carries a champion name where an identity should be, and
 * that is not stored as if it were one. `rank` is the Solo/Duo rank known when
 * the game was detected, which only tracked players have; null means none was
 * captured, never "unranked".
 */
export const LiveRosterParticipantSchema = z.strictObject({
  puuid: LeaguePuuidSchema.nullable(),
  riotId: z.string().min(1).nullable(),
  teamId: z.number().int(),
  championId: z.number().int(),
  spell1Id: z.number().int(),
  spell2Id: z.number().int(),
  /** The first rune in the page: the keystone. */
  keystoneId: z.number().int().nullable(),
  primaryTreeId: z.number().int().nullable(),
  secondaryTreeId: z.number().int().nullable(),
  /** Inferred from champion and spells; null when the lobby is not unambiguous. */
  lane: LaneSchema.nullable(),
  rank: RankSchema.nullable(),
  isTracked: z.boolean(),
});
export type LiveRosterParticipant = z.infer<typeof LiveRosterParticipantSchema>;

export const LiveRosterParticipantsSchema = z
  .array(LiveRosterParticipantSchema)
  .min(1)
  .max(LIVE_ROSTER_MAX_PARTICIPANTS);

/** The newest run of one result, counted from the player's latest ranked game. */
export const LiveFormStreakSchema = z.strictObject({
  result: z.enum(["win", "loss"]),
  length: z.number().int().min(1).max(LIVE_FORM_GAME_COUNT),
});

/**
 * The summary of an untracked player's last ranked games.
 *
 * `unavailable` is Riot's final answer that nothing can be read for this
 * player (their data is hidden, or the payload failed validation), recorded so
 * the follow-up never asks again. A transient failure is not recorded at all:
 * the player simply stays without an entry and the next attempt picks them up.
 */
export const LiveRecentFormSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("fetched"),
    /** Ranked games found, at most {@link LIVE_FORM_GAME_COUNT}. */
    games: z.number().int().min(0).max(LIVE_FORM_GAME_COUNT),
    wins: z.number().int().min(0).max(LIVE_FORM_GAME_COUNT),
    streak: LiveFormStreakSchema.nullable(),
    /** Of those games, how many were on the champion they are playing now. */
    gamesOnChampion: z.number().int().min(0).max(LIVE_FORM_GAME_COUNT),
    winsOnChampion: z.number().int().min(0).max(LIVE_FORM_GAME_COUNT),
    rank: RankSchema.nullable(),
    fetchedAt: z.iso.datetime(),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    recordedAt: z.iso.datetime(),
  }),
]);
export type LiveRecentForm = z.infer<typeof LiveRecentFormSchema>;

/** Recent form keyed by PUUID. */
export const LiveRecentFormMapSchema = z.record(
  z.string().min(1),
  LiveRecentFormSchema,
);
export type LiveRecentFormMap = z.infer<typeof LiveRecentFormMapSchema>;
