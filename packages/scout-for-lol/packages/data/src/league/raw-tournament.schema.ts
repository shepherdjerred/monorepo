import { z } from "zod";

/**
 * Zod schemas for Riot's tournament-v5 API.
 *
 * `twisted` does not implement this API — its README lists TOURNAMENT(-STUB)-V4
 * as "not yet implemented" and there is no v5 — so unlike every other Riot
 * surface in this package these schemas back a hand-rolled client.
 *
 * They are `.strict()` like `RawMatchSchema` rather than loose like
 * `RawCurrentGameInfoSchema`, so that `parseWithUnknownKeyFallback` actually
 * fires its `unrecognized_keys` path and Riot's additive drift gets counted on
 * `riotApiUnknownKeysTotal` instead of silently dropped.
 */

/**
 * Region codes the tournament API uses in request/response bodies.
 *
 * NOT a host. Every tournament-v5 endpoint is `x-route-enum: regional` with
 * `x-platforms-available: ["americas"]`, so calls always go to
 * `americas.api.riotgames.com` no matter which shard the game is played on.
 */
export const TournamentRegionSchema = z.enum([
  "BR",
  "EUNE",
  "EUW",
  "JP",
  "LAN",
  "LAS",
  "NA",
  "OCE",
  "PBE",
  "RU",
  "TR",
  "KR",
  "PH",
  "SG",
  "TH",
  "TW",
  "VN",
]);
export type TournamentRegion = z.infer<typeof TournamentRegionSchema>;

export const TournamentPickTypeSchema = z.enum([
  "BLIND_PICK",
  "DRAFT_MODE",
  "ALL_RANDOM",
  "TOURNAMENT_DRAFT",
]);
export type TournamentPickType = z.infer<typeof TournamentPickTypeSchema>;

/**
 * `LEAGUE_CLASSIC` is accepted on code creation but not on code update, which
 * is why the update parameters below carry their own narrower enum.
 */
export const TournamentMapTypeSchema = z.enum([
  "SUMMONERS_RIFT",
  "HOWLING_ABYSS",
  "LEAGUE_CLASSIC",
]);
export type TournamentMapType = z.infer<typeof TournamentMapTypeSchema>;

export const TournamentSpectatorTypeSchema = z.enum([
  "NONE",
  "LOBBYONLY",
  "ALL",
]);
export type TournamentSpectatorType = z.infer<
  typeof TournamentSpectatorTypeSchema
>;

export const TOURNAMENT_MIN_TEAM_SIZE = 1;
export const TOURNAMENT_MAX_TEAM_SIZE = 5;

export const TournamentTeamSizeSchema = z
  .number()
  .int()
  .min(TOURNAMENT_MIN_TEAM_SIZE)
  .max(TOURNAMENT_MAX_TEAM_SIZE);

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const RawProviderRegistrationParametersSchema = z.strictObject({
  region: TournamentRegionSchema,
  /**
   * Riot requires http on port 80 or https on port 443, and an approved gTLD.
   */
  url: z.url(),
});
export type RawProviderRegistrationParameters = z.infer<
  typeof RawProviderRegistrationParametersSchema
>;

export const RawTournamentRegistrationParametersSchema = z.strictObject({
  providerId: z.number().int(),
  name: z.string().min(1).optional(),
});
export type RawTournamentRegistrationParameters = z.infer<
  typeof RawTournamentRegistrationParametersSchema
>;

export const RawTournamentCodeParametersSchema = z.strictObject({
  /** Encrypted PUUIDs. Riot enforces these in aggregate, not per team. */
  allowedParticipants: z.array(z.string().min(1)).optional(),
  metadata: z.string().optional(),
  teamSize: TournamentTeamSizeSchema,
  pickType: TournamentPickTypeSchema,
  mapType: TournamentMapTypeSchema,
  spectatorType: TournamentSpectatorTypeSchema,
  enoughPlayers: z.boolean(),
});
export type RawTournamentCodeParameters = z.infer<
  typeof RawTournamentCodeParametersSchema
>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** `POST /providers` and `POST /tournaments` both answer with a bare integer. */
export const RawTournamentIdSchema = z.number().int();

export const RawTournamentCodesSchema = z.array(z.string().min(1));

export const RawTournamentCodeSchema = z.strictObject({
  id: z.number().int(),
  providerId: z.number().int(),
  tournamentId: z.number().int(),
  code: z.string().min(1),
  region: TournamentRegionSchema,
  map: z.string(),
  teamSize: z.number().int(),
  spectators: z.string(),
  pickType: z.string(),
  lobbyName: z.string(),
  password: z.string(),
  metaData: z.string(),
  /** Encrypted PUUIDs. */
  participants: z.array(z.string()),
});
export type RawTournamentCode = z.infer<typeof RawTournamentCodeSchema>;

/**
 * `eventType` is deliberately `z.string()` rather than a `z.enum`.
 *
 * A wire schema should not editorialize: the endpoint replays its whole event
 * list on every call, so a single new Riot event type modelled as an enum would
 * fail the parse and take down every poll for that lobby, forever. Recognising
 * an event is a decision one layer up, where an unrecognised type is counted
 * and ignored.
 *
 * Known values: PracticeGameCreatedEvent, PlayerJoinedGameEvent,
 * PlayerSwitchedTeamEvent, PlayerQuitGameEvent, ChampSelectStartedEvent,
 * GameAllocationStartedEvent, GameAllocatedToLsmEvent.
 */
export const RawLobbyEventSchema = z.strictObject({
  /** Riot sends this as a string, not a number. */
  timestamp: z.string(),
  eventType: z.string(),
  /** Encrypted PUUID of whoever triggered the event. */
  puuid: z.string(),
});
export type RawLobbyEvent = z.infer<typeof RawLobbyEventSchema>;

export const RawLobbyEventListSchema = z.strictObject({
  eventList: z.array(RawLobbyEventSchema),
});
export type RawLobbyEventList = z.infer<typeof RawLobbyEventListSchema>;

const RawTournamentTeamMemberSchema = z.strictObject({
  puuid: z.string(),
});

/**
 * One recorded game for a tournament code.
 *
 * Riot's own note: "If the endpoint returns the game, it means a callback was
 * attempted." Only works for codes created after 2023-11-10, and the endpoint
 * does not exist on tournament-stub-v5 at all.
 */
export const RawTournamentGameSchema = z.strictObject({
  startTime: z.number().int(),
  winningTeam: z.array(RawTournamentTeamMemberSchema),
  losingTeam: z.array(RawTournamentTeamMemberSchema),
  /** The tournament code this game was played on. */
  shortCode: z.string(),
  metaData: z.string().optional(),
  /**
   * Riot game IDs are ~10^10, comfortably inside 2^53, and
   * `RawCurrentGameInfoSchema.gameId` is already a plain number.
   */
  gameId: z.number().int(),
  gameName: z.string(),
  gameType: z.string(),
  /** Map ID, e.g. 11 for Summoner's Rift. */
  gameMap: z.number().int(),
  gameMode: z.string(),
  region: z.string(),
});
export type RawTournamentGame = z.infer<typeof RawTournamentGameSchema>;

export const RawTournamentGamesSchema = z.array(RawTournamentGameSchema);
