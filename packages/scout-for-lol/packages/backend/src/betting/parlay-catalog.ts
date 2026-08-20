import { z } from "zod";
import type { RawInfo, RawParticipant, RawTeam } from "@scout-for-lol/data";

/**
 * The only Riot result fields an LLM-authored parlay may reference.
 *
 * Keeping this as closed Zod enums plus complete records gives us three
 * independent guards: structured output cannot name another field, semantic
 * validation applies reviewed threshold limits, and the evaluator can index a
 * parsed RawMatch without accepting paths or expressions from the model.
 */

export const ParticipantNumericFieldSchema = z.enum([
  "assists",
  "baronKills",
  "champExperience",
  "champLevel",
  "consumablesPurchased",
  "damageDealtToBuildings",
  "damageDealtToObjectives",
  "damageDealtToTurrets",
  "damageSelfMitigated",
  "deaths",
  "detectorWardsPlaced",
  "doubleKills",
  "dragonKills",
  "goldEarned",
  "goldSpent",
  "inhibitorKills",
  "inhibitorTakedowns",
  "inhibitorsLost",
  "itemsPurchased",
  "killingSprees",
  "kills",
  "largestCriticalStrike",
  "largestKillingSpree",
  "largestMultiKill",
  "longestTimeSpentLiving",
  "magicDamageDealt",
  "magicDamageDealtToChampions",
  "magicDamageTaken",
  "neutralMinionsKilled",
  "nexusKills",
  "nexusLost",
  "nexusTakedowns",
  "objectivesStolen",
  "objectivesStolenAssists",
  "pentaKills",
  "physicalDamageDealt",
  "physicalDamageDealtToChampions",
  "physicalDamageTaken",
  "quadraKills",
  "sightWardsBoughtInGame",
  "spell1Casts",
  "spell2Casts",
  "spell3Casts",
  "spell4Casts",
  "summoner1Casts",
  "summoner2Casts",
  "timeCCingOthers",
  "timePlayed",
  "totalAllyJungleMinionsKilled",
  "totalDamageDealt",
  "totalDamageDealtToChampions",
  "totalDamageShieldedOnTeammates",
  "totalDamageTaken",
  "totalEnemyJungleMinionsKilled",
  "totalHeal",
  "totalHealsOnTeammates",
  "totalMinionsKilled",
  "totalTimeCCDealt",
  "totalTimeSpentDead",
  "totalUnitsHealed",
  "tripleKills",
  "trueDamageDealt",
  "trueDamageDealtToChampions",
  "trueDamageTaken",
  "turretKills",
  "turretTakedowns",
  "turretsLost",
  "unrealKills",
  "visionScore",
  "visionWardsBoughtInGame",
  "wardsKilled",
  "wardsPlaced",
]);

export type ParticipantNumericField = z.infer<
  typeof ParticipantNumericFieldSchema
>;

export const ParticipantBooleanFieldSchema = z.enum([
  "eligibleForProgression",
  "firstBloodAssist",
  "firstBloodKill",
  "firstTowerAssist",
  "firstTowerKill",
  "gameEndedInEarlySurrender",
  "gameEndedInSurrender",
  "teamEarlySurrendered",
  "win",
]);

export type ParticipantBooleanField = z.infer<
  typeof ParticipantBooleanFieldSchema
>;

export const TeamBooleanFieldSchema = z.enum(["win"]);
export type TeamBooleanField = z.infer<typeof TeamBooleanFieldSchema>;

export const TeamObjectiveSchema = z.enum([
  "baron",
  "champion",
  "dragon",
  "inhibitor",
  "riftHerald",
  "tower",
]);
export type TeamObjective = z.infer<typeof TeamObjectiveSchema>;

export const MatchNumericFieldSchema = z.enum(["gameDuration"]);
export type MatchNumericField = z.infer<typeof MatchNumericFieldSchema>;

/**
 * Ping counts, bettable only as an opponent-team total.
 *
 * Pings are free. A subject who can see the parlay can send fifty of them at
 * the fountain, and five of the fourteen bets placed so far came from a player
 * who was a subject in that same parlay, mid-game — so "free" and "settled by
 * the bettor" are the same thing here. Summed across the five opponents, none
 * of whom is in the market, the number is back to being a fact about the game.
 *
 * The enemy team is addressed as a whole rather than by player: opponents are
 * anonymous in the generation prompt, so naming one would need a champion
 * lookup to render, for no gain in what the leg means.
 */
export const OpponentPingFieldSchema = z.enum([
  "allInPings",
  "assistMePings",
  "basicPings",
  "commandPings",
  "dangerPings",
  "enemyMissingPings",
  "enemyVisionPings",
  "getBackPings",
  "holdPings",
  "needVisionPings",
  "onMyWayPings",
  "pushPings",
  "visionClearedPings",
]);
export type OpponentPingField = z.infer<typeof OpponentPingFieldSchema>;

const NumericCatalogEntrySchema = z.strictObject({
  label: z.string().min(1),
  thresholdMin: z.number().int().nonnegative(),
  thresholdMax: z.number().int().positive(),
});

const BooleanCatalogEntrySchema = z.strictObject({
  label: z.string().min(1),
});

type NumericCatalogEntry = z.infer<typeof NumericCatalogEntrySchema>;

function label(field: string): string {
  return field
    .replaceAll("CC", "crowd control")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

function numericEntry(field: ParticipantNumericField): NumericCatalogEntry {
  const damageOrEconomy =
    field.toLowerCase().includes("damage") ||
    field.startsWith("gold") ||
    field === "champExperience";
  const time = field.toLowerCase().includes("time");
  return {
    label: label(field),
    thresholdMin: 0,
    thresholdMax: damageOrEconomy ? 1_000_000 : time ? 20_000 : 10_000,
  };
}

export const PARTICIPANT_NUMERIC_CATALOG = z
  .record(ParticipantNumericFieldSchema, NumericCatalogEntrySchema)
  .parse(
    Object.fromEntries(
      ParticipantNumericFieldSchema.options.map((field) => [
        field,
        numericEntry(field),
      ]),
    ),
  );

export const PARTICIPANT_BOOLEAN_CATALOG = z
  .record(ParticipantBooleanFieldSchema, BooleanCatalogEntrySchema)
  .parse(
    Object.fromEntries(
      ParticipantBooleanFieldSchema.options.map((field) => [
        field,
        { label: label(field) },
      ]),
    ),
  );

export const TEAM_BOOLEAN_CATALOG = z
  .record(TeamBooleanFieldSchema, BooleanCatalogEntrySchema)
  .parse({ win: { label: "wins" } });

export const MATCH_NUMERIC_CATALOG = z
  .record(MatchNumericFieldSchema, NumericCatalogEntrySchema)
  .parse({
    gameDuration: {
      label: "game duration in seconds",
      thresholdMin: 300,
      thresholdMax: 7200,
    },
  });

export const TEAM_OBJECTIVE_CATALOG = z
  .record(TeamObjectiveSchema, NumericCatalogEntrySchema)
  .parse(
    Object.fromEntries(
      TeamObjectiveSchema.options.map((objective) => [
        objective,
        {
          label: objective === "riftHerald" ? "Rift Herald" : label(objective),
          thresholdMin: 0,
          thresholdMax: objective === "champion" ? 100 : 20,
        },
      ]),
    ),
  );

export function participantNumericValue(
  participant: RawParticipant,
  field: ParticipantNumericField,
): number {
  return participant[field];
}

export function participantBooleanValue(
  participant: RawParticipant,
  field: ParticipantBooleanField,
): boolean {
  return participant[field];
}

export function teamBooleanValue(
  team: RawTeam,
  field: TeamBooleanField,
): boolean {
  return team[field];
}

export function teamObjectiveValue(
  team: RawTeam,
  objective: TeamObjective,
): { first: boolean; kills: number } {
  return team.objectives[objective];
}

export function matchNumericValue(
  info: RawInfo,
  field: MatchNumericField,
): number {
  return info[field];
}

/**
 * The five opponents' combined count for one ping type.
 *
 * Summed over every participant NOT on the selected team, so the value cannot
 * be moved by anyone who could be holding a ticket on it.
 */
export function opponentTeamPingValue(
  participants: readonly RawParticipant[],
  selectedTeamId: number,
  field: OpponentPingField,
): number {
  return participants
    .filter((participant) => participant.teamId !== selectedTeamId)
    .reduce((total, participant) => total + participant[field], 0);
}

/** Explicit exclusions reviewed alongside the allowed catalog. */
export const EXCLUDED_PARTICIPANT_FIELDS = [
  // Every ping type. A subject's own pings cost nothing to send, so a leg on
  // them is settled by whoever is holding the ticket rather than by how the
  // game went. They remain bettable as OPPONENT team totals, which no subject
  // can influence — see OpponentPingFieldSchema below.
  "allInPings",
  "assistMePings",
  "basicPings",
  "baitPings",
  "commandPings",
  "dangerPings",
  "enemyMissingPings",
  "enemyVisionPings",
  "getBackPings",
  "holdPings",
  "needVisionPings",
  "onMyWayPings",
  "pushPings",
  "visionClearedPings",
  "bountyLevel",
  "challenges",
  "championId",
  "championName",
  "championTransform",
  "damageDealtToEpicMonsters",
  "individualPosition",
  "item0",
  "item1",
  "item2",
  "item3",
  "item4",
  "item5",
  "item6",
  "lane",
  "missions",
  "participantId",
  "perks",
  "playerAugment1",
  "playerAugment2",
  "playerAugment3",
  "playerAugment4",
  "playerAugment5",
  "playerAugment6",
  "playerScore0",
  "playerScore1",
  "playerScore2",
  "playerScore3",
  "playerScore4",
  "playerScore5",
  "playerScore6",
  "playerScore7",
  "playerScore8",
  "playerScore9",
  "playerScore10",
  "playerScore11",
  "PlayerBehavior",
  "PlayerScore0",
  "PlayerScore1",
  "PlayerScore2",
  "PlayerScore3",
  "PlayerScore4",
  "PlayerScore5",
  "PlayerScore6",
  "PlayerScore7",
  "PlayerScore8",
  "PlayerScore9",
  "PlayerScore10",
  "PlayerScore11",
  "playerSubteamId",
  "placement",
  "profileIcon",
  "puuid",
  "retreatPings",
  "riotIdGameName",
  "riotIdName",
  "riotIdTagline",
  "role",
  "roleBoundItem",
  "subteamPlacement",
  "summoner1Id",
  "summoner2Id",
  "summonerId",
  "summonerLevel",
  "summonerName",
  "teamId",
  "teamPosition",
] as const;

export const EXCLUDED_TEAM_FIELDS = ["bans", "feats", "teamId"] as const;

export const EXCLUDED_MATCH_INFO_FIELDS = [
  "endOfGameResult",
  "gameCreation",
  "gameEndTimestamp",
  "gameId",
  "gameMode",
  "gameModeMutators",
  "gameName",
  "gameStartTimestamp",
  "gameType",
  "gameVersion",
  "mapId",
  "participants",
  "platformId",
  "queueId",
  "teams",
  "tournamentCode",
] as const;

export const OPPONENT_PING_CATALOG = z
  .record(OpponentPingFieldSchema, NumericCatalogEntrySchema)
  .parse(
    Object.fromEntries(
      OpponentPingFieldSchema.options.map((field) => [
        field,
        // Wide rails only. A five-player total ran 0-37 across a 24-minute
        // sample, but the threshold a leg actually uses comes from measured
        // history, not from these bounds.
        {
          label: `enemy team ${label(field)}`,
          thresholdMin: 0,
          thresholdMax: 2000,
        },
      ]),
    ),
  );

export function promptFieldCatalog(input?: {
  participantNumericFields?: readonly ParticipantNumericField[];
  teamObjectives?: readonly TeamObjective[];
}): object {
  const participantNumericFields =
    input?.participantNumericFields ?? ParticipantNumericFieldSchema.options;
  const teamObjectives = input?.teamObjectives ?? TeamObjectiveSchema.options;
  return {
    participantNumeric: Object.fromEntries(
      participantNumericFields.map((field) => [
        field,
        PARTICIPANT_NUMERIC_CATALOG[field],
      ]),
    ),
    participantBoolean: PARTICIPANT_BOOLEAN_CATALOG,
    teamBoolean: TEAM_BOOLEAN_CATALOG,
    teamObjectives: Object.fromEntries(
      teamObjectives.map((objective) => [
        objective,
        TEAM_OBJECTIVE_CATALOG[objective],
      ]),
    ),
    matchNumeric: MATCH_NUMERIC_CATALOG,
    opponentPings: OPPONENT_PING_CATALOG,
  };
}
