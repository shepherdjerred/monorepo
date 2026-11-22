import { z } from "zod";
import { SCOUT_CLIENT_HISTORY_DATA_VERSION } from "./data-source.ts";
import { checkStoredIdentities } from "./participant-identity.ts";
import { RawMetadataSchema } from "./raw-match.schema.ts";
import { RawParticipantSchema } from "./raw-participant.schema.ts";
import { RawTeamSchema } from "./raw-team.schema.ts";

/**
 * The history canonical record (`local-history-1`): a game Scout knows only
 * from the League client's own match history (`/lol-match-history/v1/games/
 * {id}`), because the Scout Client did not witness it end and Riot will not
 * publish it. An ARAM: Mayhem game played before the client was installed is
 * the case this exists for.
 *
 * The history row states the game, its teams and most of each player's
 * statistics, items, spells and runes, and its own completion marker
 * (`endOfGameResult`). It does not state the Match-V5 statistics only Riot's
 * document or the end-of-game block carries — pings, casts, time played or
 * dead, a player's own baron and dragon kills, and the rest of
 * {@link HISTORY_UNSTATED_PARTICIPANT_FIELDS} — so those are `null`, never
 * zero. Nor does it state when the game started or ended: both are derived
 * from the stated creation time and duration (see `convertHistoryMatch`).
 *
 * It keeps Match-V5's field names so a consumer reading a stat it states
 * reads it the same way. Consumers opt in through `CanonicalMatch`; a
 * `RawMatch` consumer never receives one. A history record is always
 * history-only: it is never announced and drives no effects.
 */

/**
 * Match-V5 participant fields the League client's match-history row does not
 * state. Measured against the ARAM: Mayhem, ranked, bot-custom and Arena
 * history fixtures (`testdata/lcu/lcu-game-*.json`): these are exactly the
 * fields `RawParticipantSchema` requires that none of them carry. The two
 * positions are stated for Summoner's Rift and absent where the mode has
 * none.
 */
export const HISTORY_UNSTATED_PARTICIPANT_FIELDS = [
  "allInPings",
  "assistMePings",
  "baronKills",
  "basicPings",
  "champExperience",
  "championTransform",
  "commandPings",
  "consumablesPurchased",
  "damageDealtToBuildings",
  "damageDealtToEpicMonsters",
  "dangerPings",
  "detectorWardsPlaced",
  "dragonKills",
  "enemyMissingPings",
  "enemyVisionPings",
  "getBackPings",
  "holdPings",
  "individualPosition",
  "inhibitorTakedowns",
  "inhibitorsLost",
  "itemsPurchased",
  "magicDamageTaken",
  "needVisionPings",
  "nexusKills",
  "nexusLost",
  "nexusTakedowns",
  "objectivesStolen",
  "objectivesStolenAssists",
  "onMyWayPings",
  "pushPings",
  "retreatPings",
  "spell1Casts",
  "spell2Casts",
  "spell3Casts",
  "spell4Casts",
  "summoner1Casts",
  "summoner2Casts",
  "summonerLevel",
  "teamPosition",
  "timePlayed",
  "totalAllyJungleMinionsKilled",
  "totalDamageShieldedOnTeammates",
  "totalEnemyJungleMinionsKilled",
  "totalHealsOnTeammates",
  "totalTimeCCDealt",
  "totalTimeSpentDead",
  "turretTakedowns",
  "turretsLost",
  "visionClearedPings",
] as const;

const shape = RawParticipantSchema.shape;

export const HistoryParticipantSchema = RawParticipantSchema.extend({
  allInPings: shape.allInPings.nullable(),
  assistMePings: shape.assistMePings.nullable(),
  baronKills: shape.baronKills.nullable(),
  basicPings: shape.basicPings.nullable(),
  champExperience: shape.champExperience.nullable(),
  championTransform: shape.championTransform.nullable(),
  commandPings: shape.commandPings.nullable(),
  consumablesPurchased: shape.consumablesPurchased.nullable(),
  damageDealtToBuildings: shape.damageDealtToBuildings.nullable(),
  damageDealtToEpicMonsters: shape.damageDealtToEpicMonsters.nullable(),
  dangerPings: shape.dangerPings.nullable(),
  detectorWardsPlaced: shape.detectorWardsPlaced.nullable(),
  dragonKills: shape.dragonKills.nullable(),
  enemyMissingPings: shape.enemyMissingPings.nullable(),
  enemyVisionPings: shape.enemyVisionPings.nullable(),
  getBackPings: shape.getBackPings.nullable(),
  holdPings: shape.holdPings.nullable(),
  individualPosition: shape.individualPosition.nullable(),
  inhibitorTakedowns: shape.inhibitorTakedowns.nullable(),
  inhibitorsLost: shape.inhibitorsLost.nullable(),
  itemsPurchased: shape.itemsPurchased.nullable(),
  magicDamageTaken: shape.magicDamageTaken.nullable(),
  needVisionPings: shape.needVisionPings.nullable(),
  nexusKills: shape.nexusKills.nullable(),
  nexusLost: shape.nexusLost.nullable(),
  nexusTakedowns: shape.nexusTakedowns.nullable(),
  objectivesStolen: shape.objectivesStolen.nullable(),
  objectivesStolenAssists: shape.objectivesStolenAssists.nullable(),
  onMyWayPings: shape.onMyWayPings.nullable(),
  pushPings: shape.pushPings.nullable(),
  retreatPings: shape.retreatPings.nullable(),
  spell1Casts: shape.spell1Casts.nullable(),
  spell2Casts: shape.spell2Casts.nullable(),
  spell3Casts: shape.spell3Casts.nullable(),
  spell4Casts: shape.spell4Casts.nullable(),
  summoner1Casts: shape.summoner1Casts.nullable(),
  summoner2Casts: shape.summoner2Casts.nullable(),
  summonerLevel: shape.summonerLevel.nullable(),
  teamPosition: shape.teamPosition.nullable(),
  timePlayed: shape.timePlayed.nullable(),
  totalAllyJungleMinionsKilled: shape.totalAllyJungleMinionsKilled.nullable(),
  totalDamageShieldedOnTeammates:
    shape.totalDamageShieldedOnTeammates.nullable(),
  totalEnemyJungleMinionsKilled: shape.totalEnemyJungleMinionsKilled.nullable(),
  totalHealsOnTeammates: shape.totalHealsOnTeammates.nullable(),
  totalTimeCCDealt: shape.totalTimeCCDealt.nullable(),
  totalTimeSpentDead: shape.totalTimeSpentDead.nullable(),
  turretTakedowns: shape.turretTakedowns.nullable(),
  turretsLost: shape.turretsLost.nullable(),
  visionClearedPings: shape.visionClearedPings.nullable(),
});

export const HistoryMatchSchema = z
  .object({
    metadata: RawMetadataSchema.extend({
      dataVersion: z.literal(SCOUT_CLIENT_HISTORY_DATA_VERSION),
    }),
    info: z
      .object({
        // The history row's own completion marker, required to say so.
        endOfGameResult: z.literal("GameComplete"),
        gameCreation: z.number().int().positive(),
        gameDuration: z.number().positive(),
        gameEndTimestamp: z.number().int().positive(),
        gameId: z.number().int().positive(),
        gameMode: z.string().min(1),
        gameStartTimestamp: z.number().int().positive(),
        gameType: z.string().min(1),
        gameVersion: z.string().min(1),
        mapId: z.number().int().positive(),
        participants: z.array(HistoryParticipantSchema).min(2),
        platformId: z.string().min(1),
        queueId: z.number().int().nonnegative(),
        teams: z.array(RawTeamSchema).min(2),
      })
      .strict(),
  })
  .strict()
  .superRefine((match, ctx) => {
    checkStoredIdentities(
      {
        scoutBuilt: true,
        metadataParticipants: match.metadata.participants,
        participants: match.info.participants,
      },
      ctx,
    );
  });

export type HistoryMatch = z.infer<typeof HistoryMatchSchema>;
export type HistoryParticipant = z.infer<typeof HistoryParticipantSchema>;

/**
 * Lake columns a history record leaves NULL: the ones flattened from
 * {@link HISTORY_UNSTATED_PARTICIPANT_FIELDS}. A Dare reading one cannot be
 * judged on such a game.
 */
export const HISTORY_NULLABLE_LAKE_COLUMNS: readonly string[] = [
  "team_position",
  "individual_position",
  "total_heals_on_teammates",
  "detector_wards_placed",
  "all_in_pings",
  "assist_me_pings",
  "basic_pings",
  "command_pings",
  "danger_pings",
  "enemy_missing_pings",
  "enemy_vision_pings",
  "get_back_pings",
  "hold_pings",
  "need_vision_pings",
  "on_my_way_pings",
  "push_pings",
  "vision_cleared_pings",
  "champ_experience",
  "time_played",
  "total_time_spent_dead",
  "baron_kills",
  "dragon_kills",
];
