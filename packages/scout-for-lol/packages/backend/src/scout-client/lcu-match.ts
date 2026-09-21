import {
  RawMatchSchema,
  RawParticipantSchema,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data";
import { z } from "zod";

const StringIdSchema = z.union([z.string(), z.number()]).transform(String);
const LegacyPlayerSchema = z
  .object({
    puuid: z.string().min(1),
    profileIcon: z.number().optional(),
    summonerId: StringIdSchema.optional(),
    summonerName: z.string().optional(),
    gameName: z.string().optional(),
    tagLine: z.string().optional(),
  })
  .loose();
const LegacyIdentitySchema = z
  .object({ participantId: z.number(), player: LegacyPlayerSchema })
  .loose();
const LegacyTimelineSchema = z
  .object({ lane: z.string().optional(), role: z.string().optional() })
  .loose();
const LegacyParticipantSchema = z
  .object({
    participantId: z.number(),
    teamId: z.number(),
    championId: z.number(),
    championName: z.string().optional(),
    spell1Id: z.number(),
    spell2Id: z.number(),
    stats: z.record(z.string(), z.unknown()),
    timeline: LegacyTimelineSchema.optional(),
  })
  .loose();
const LegacyBanSchema = z
  .object({ championId: z.number(), pickTurn: z.number() })
  .loose();
const LegacyTeamSchema = z
  .object({
    teamId: z.number(),
    win: z.union([z.boolean(), z.string()]),
    bans: z.array(LegacyBanSchema).optional(),
  })
  .loose();
const LegacyLcuMatchSchema = z
  .object({
    gameCreation: z.number(),
    gameDuration: z.number(),
    gameId: z.number(),
    gameMode: z.string(),
    gameName: z.string().optional(),
    gameType: z.string(),
    gameVersion: z.string(),
    mapId: z.number(),
    participantIdentities: z.array(LegacyIdentitySchema),
    participants: z.array(LegacyParticipantSchema),
    platformId: z.string(),
    queueId: z.number(),
    teams: z.array(LegacyTeamSchema),
    tournamentCode: z.string().optional(),
  })
  .loose();

const LegacyStatsSchema = RawParticipantSchema.partial().strip();
const PositionSchema = z.enum([
  "",
  "Invalid",
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
]);
const LaneSchema = z.enum(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "NONE"]);
const RoleSchema = z.enum([
  "SOLO",
  "NONE",
  "CARRY",
  "SUPPORT",
  "DUO_CARRY",
  "DUO_SUPPORT",
  "DUO",
]);

const EMPTY_PARTICIPANT = {
  assists: 0,
  baronKills: 0,
  basicPings: 0,
  champExperience: 0,
  champLevel: 0,
  championId: 0,
  championName: "",
  championTransform: 0,
  allInPings: 0,
  assistMePings: 0,
  commandPings: 0,
  visionClearedPings: 0,
  consumablesPurchased: 0,
  damageDealtToBuildings: 0,
  damageDealtToObjectives: 0,
  damageDealtToTurrets: 0,
  damageSelfMitigated: 0,
  dangerPings: 0,
  deaths: 0,
  detectorWardsPlaced: 0,
  doubleKills: 0,
  dragonKills: 0,
  enemyMissingPings: 0,
  enemyVisionPings: 0,
  firstBloodAssist: false,
  firstBloodKill: false,
  firstTowerAssist: false,
  firstTowerKill: false,
  gameEndedInEarlySurrender: false,
  gameEndedInSurrender: false,
  getBackPings: 0,
  goldEarned: 0,
  goldSpent: 0,
  holdPings: 0,
  individualPosition: "",
  inhibitorKills: 0,
  inhibitorTakedowns: 0,
  inhibitorsLost: 0,
  item0: 0,
  item1: 0,
  item2: 0,
  item3: 0,
  item4: 0,
  item5: 0,
  item6: 0,
  itemsPurchased: 0,
  killingSprees: 0,
  kills: 0,
  largestCriticalStrike: 0,
  largestKillingSpree: 0,
  largestMultiKill: 0,
  longestTimeSpentLiving: 0,
  magicDamageDealt: 0,
  magicDamageDealtToChampions: 0,
  magicDamageTaken: 0,
  needVisionPings: 0,
  neutralMinionsKilled: 0,
  nexusKills: 0,
  nexusLost: 0,
  nexusTakedowns: 0,
  objectivesStolen: 0,
  objectivesStolenAssists: 0,
  onMyWayPings: 0,
  participantId: 0,
  pentaKills: 0,
  perks: {
    statPerks: { defense: 0, flex: 0, offense: 0 },
    styles: [],
  },
  physicalDamageDealt: 0,
  physicalDamageDealtToChampions: 0,
  physicalDamageTaken: 0,
  profileIcon: 0,
  pushPings: 0,
  puuid: "",
  quadraKills: 0,
  riotIdTagline: "",
  sightWardsBoughtInGame: 0,
  spell1Casts: 0,
  spell2Casts: 0,
  spell3Casts: 0,
  spell4Casts: 0,
  summoner1Casts: 0,
  summoner1Id: 0,
  summoner2Casts: 0,
  summoner2Id: 0,
  summonerLevel: 0,
  teamEarlySurrendered: false,
  teamId: 0,
  teamPosition: "",
  timeCCingOthers: 0,
  timePlayed: 0,
  totalAllyJungleMinionsKilled: 0,
  totalDamageDealt: 0,
  totalDamageDealtToChampions: 0,
  totalDamageShieldedOnTeammates: 0,
  totalDamageTaken: 0,
  totalEnemyJungleMinionsKilled: 0,
  totalHeal: 0,
  totalHealsOnTeammates: 0,
  totalMinionsKilled: 0,
  totalTimeCCDealt: 0,
  totalTimeSpentDead: 0,
  totalUnitsHealed: 0,
  tripleKills: 0,
  trueDamageDealt: 0,
  trueDamageDealtToChampions: 0,
  trueDamageTaken: 0,
  turretKills: 0,
  turretTakedowns: 0,
  turretsLost: 0,
  unrealKills: 0,
  visionScore: 0,
  visionWardsBoughtInGame: 0,
  wardsKilled: 0,
  wardsPlaced: 0,
  win: false,
} satisfies RawParticipant;

type LegacyStats = Record<string, unknown>;

function statNumber(stats: LegacyStats, key: string): number {
  const value = stats[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function perkSelection(stats: LegacyStats, index: number) {
  const key = `perk${index.toString()}`;
  return {
    perk: statNumber(stats, key),
    var1: statNumber(stats, `${key}Var1`),
    var2: statNumber(stats, `${key}Var2`),
    var3: statNumber(stats, `${key}Var3`),
  };
}

function legacyPerks(stats: LegacyStats) {
  return {
    statPerks: {
      offense: statNumber(stats, "statPerk0"),
      flex: statNumber(stats, "statPerk1"),
      defense: statNumber(stats, "statPerk2"),
    },
    styles: [
      {
        description: "primaryStyle" as const,
        style: statNumber(stats, "perkPrimaryStyle"),
        selections: [0, 1, 2, 3].map((index) => perkSelection(stats, index)),
      },
      {
        description: "subStyle" as const,
        style: statNumber(stats, "perkSubStyle"),
        selections: [4, 5].map((index) => perkSelection(stats, index)),
      },
    ],
  };
}

function normalizedLane(value: string | undefined) {
  const renamed =
    value === "MID" ? "MIDDLE" : value === "BOT" ? "BOTTOM" : value;
  const parsed = LaneSchema.safeParse(renamed);
  return parsed.success ? parsed.data : "NONE";
}

function normalizedRole(value: string | undefined) {
  const parsed = RoleSchema.safeParse(value);
  return parsed.success ? parsed.data : "NONE";
}

function participantPosition(lane: z.infer<typeof LaneSchema>, role: string) {
  const candidate =
    lane === "BOTTOM" && ["SUPPORT", "DUO_SUPPORT"].includes(role)
      ? "UTILITY"
      : lane;
  return PositionSchema.parse(candidate === "NONE" ? "" : candidate);
}

function convertParticipant(
  participant: z.infer<typeof LegacyParticipantSchema>,
  identity: z.infer<typeof LegacyIdentitySchema>,
  gameDuration: number,
): RawParticipant | null {
  const compatibleStats = LegacyStatsSchema.safeParse(participant.stats);
  if (!compatibleStats.success) return null;
  const lane = normalizedLane(participant.timeline?.lane);
  const role = normalizedRole(participant.timeline?.role);
  const converted = RawParticipantSchema.safeParse({
    ...EMPTY_PARTICIPANT,
    ...compatibleStats.data,
    championId: participant.championId,
    championName: participant.championName ?? "",
    individualPosition: participantPosition(lane, role),
    lane,
    participantId: participant.participantId,
    perks: legacyPerks(participant.stats),
    profileIcon: identity.player.profileIcon ?? 0,
    puuid: identity.player.puuid,
    riotIdGameName: identity.player.gameName,
    riotIdName: identity.player.summonerName,
    riotIdTagline: identity.player.tagLine ?? "",
    role,
    summoner1Id: participant.spell1Id,
    summoner2Id: participant.spell2Id,
    summonerId: identity.player.summonerId,
    summonerName: identity.player.summonerName,
    teamId: participant.teamId,
    teamPosition: participantPosition(lane, role),
    timePlayed: statNumber(participant.stats, "timePlayed") || gameDuration,
  });
  return converted.success ? converted.data : null;
}

function teamBoolean(team: z.infer<typeof LegacyTeamSchema>, key: string) {
  const value = team[key];
  return value === true;
}

function teamNumber(team: z.infer<typeof LegacyTeamSchema>, key: string) {
  const value = team[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Convert the legacy row returned by the local match-history endpoint. */
export function convertLcuMatchHistoryRow(
  riotMatchId: string,
  payload: unknown,
): RawMatch | null {
  const parsed = LegacyLcuMatchSchema.safeParse(payload);
  if (!parsed.success) return null;
  const game = parsed.data;
  const identities = new Map(
    game.participantIdentities.map((identity) => [
      identity.participantId,
      identity,
    ]),
  );
  if (identities.size !== game.participantIdentities.length) return null;
  const participants = game.participants.flatMap((participant) => {
    const identity = identities.get(participant.participantId);
    if (identity === undefined) return [];
    const converted = convertParticipant(
      participant,
      identity,
      game.gameDuration,
    );
    return converted === null ? [] : [converted];
  });
  if (participants.length !== game.participants.length) return null;

  const converted = RawMatchSchema.safeParse({
    metadata: {
      dataVersion: "2",
      matchId: riotMatchId,
      participants: participants.map((participant) => participant.puuid),
    },
    info: {
      gameCreation: game.gameCreation,
      gameDuration: game.gameDuration,
      gameEndTimestamp: game.gameCreation + game.gameDuration * 1000,
      gameId: game.gameId,
      gameMode: game.gameMode,
      gameName: game.gameName ?? "",
      gameStartTimestamp: game.gameCreation,
      gameType: game.gameType,
      gameVersion: game.gameVersion,
      mapId: game.mapId,
      participants,
      platformId: game.platformId,
      queueId: game.queueId,
      teams: game.teams.map((team) => ({
        bans: team.bans ?? [],
        objectives: {
          baron: {
            first: teamBoolean(team, "firstBaron"),
            kills: teamNumber(team, "baronKills"),
          },
          champion: {
            first: teamBoolean(team, "firstBlood"),
            kills: participants
              .filter((participant) => participant.teamId === team.teamId)
              .reduce((sum, participant) => sum + participant.kills, 0),
          },
          dragon: {
            first: teamBoolean(team, "firstDragon"),
            kills: teamNumber(team, "dragonKills"),
          },
          inhibitor: {
            first: teamBoolean(team, "firstInhibitor"),
            kills: teamNumber(team, "inhibitorKills"),
          },
          riftHerald: {
            first: teamBoolean(team, "firstRiftHerald"),
            kills: teamNumber(team, "riftHeraldKills"),
          },
          tower: {
            first: teamBoolean(team, "firstTower"),
            kills: teamNumber(team, "towerKills"),
          },
        },
        teamId: team.teamId,
        win: team.win === true || team.win === "Win",
      })),
      tournamentCode: game.tournamentCode,
    },
  });
  return converted.success ? converted.data : null;
}
