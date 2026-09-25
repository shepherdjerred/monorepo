import { RawParticipantSchema, RawPerksSchema } from "@scout-for-lol/data";
import { z } from "zod";
import type {
  LegacyIdentity,
  LegacyParticipant,
  SourcePlayer,
  ValueRecord,
} from "./lcu-schema.ts";

const NumericValueSchema = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(?:\.\d+)?$/)
    .transform(Number),
]);
const BooleanValueSchema = z.union([
  z.boolean(),
  z.literal(0).transform(() => false),
  z.literal(1).transform(() => true),
  z.literal("0").transform(() => false),
  z.literal("1").transform(() => true),
  z.literal("Fail").transform(() => false),
  z.literal("Win").transform(() => true),
]);
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

function valueFrom(
  records: readonly ValueRecord[],
  keys: readonly string[],
): unknown {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function numberFrom(records: readonly ValueRecord[], ...keys: string[]) {
  const parsed = NumericValueSchema.safeParse(valueFrom(records, keys));
  return parsed.success ? parsed.data : null;
}

function booleanFrom(records: readonly ValueRecord[], ...keys: string[]) {
  const parsed = BooleanValueSchema.safeParse(valueFrom(records, keys));
  return parsed.success ? parsed.data : null;
}

function stringFrom(records: readonly ValueRecord[], ...keys: string[]) {
  const parsed = z.string().safeParse(valueFrom(records, keys));
  return parsed.success ? parsed.data : null;
}

function normalizedLane(value: string | undefined) {
  const renamed =
    value === "MID" ? "MIDDLE" : value === "BOT" ? "BOTTOM" : value;
  const parsed = LaneSchema.safeParse(renamed);
  return parsed.success ? parsed.data : undefined;
}

function normalizedRole(value: string | undefined) {
  const parsed = RoleSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function positionFrom(
  records: readonly ValueRecord[],
  participant: LegacyParticipant,
) {
  const explicit = stringFrom(
    records,
    "teamPosition",
    "individualPosition",
    "TEAM_POSITION",
    "INDIVIDUAL_POSITION",
  );
  const parsed = PositionSchema.safeParse(explicit);
  if (parsed.success) return parsed.data;
  const lane = normalizedLane(participant.timeline?.lane);
  const role = normalizedRole(participant.timeline?.role);
  const candidate =
    lane === "BOTTOM" && (role === "SUPPORT" || role === "DUO_SUPPORT")
      ? "UTILITY"
      : lane;
  const fallback = PositionSchema.safeParse(candidate);
  return fallback.success ? fallback.data : null;
}

function selection(records: readonly ValueRecord[], index: number) {
  const upper = `PERK${index.toString()}`;
  const lower = `perk${index.toString()}`;
  return {
    perk: numberFrom(records, lower, upper),
    var1: numberFrom(records, `${lower}Var1`, `${upper}_VAR1`),
    var2: numberFrom(records, `${lower}Var2`, `${upper}_VAR2`),
    var3: numberFrom(records, `${lower}Var3`, `${upper}_VAR3`),
  };
}

function perksFrom(records: readonly ValueRecord[]) {
  const embedded = RawPerksSchema.safeParse(valueFrom(records, ["perks"]));
  if (embedded.success) return embedded.data;
  return {
    statPerks: {
      offense: numberFrom(records, "statPerk0", "STAT_PERK_0"),
      flex: numberFrom(records, "statPerk1", "STAT_PERK_1"),
      defense: numberFrom(records, "statPerk2", "STAT_PERK_2"),
    },
    styles: [
      {
        description: "primaryStyle" as const,
        style: numberFrom(records, "perkPrimaryStyle", "PERK_PRIMARY_STYLE"),
        selections: [0, 1, 2, 3].map((index) => selection(records, index)),
      },
      {
        description: "subStyle" as const,
        style: numberFrom(records, "perkSubStyle", "PERK_SUB_STYLE"),
        selections: [4, 5].map((index) => selection(records, index)),
      },
    ],
  };
}

export function convertParticipant(
  participant: LegacyParticipant,
  identity: LegacyIdentity,
  source: SourcePlayer,
) {
  const records = [source.stats, participant.stats];
  const position = positionFrom(records, participant);
  const lane = normalizedLane(participant.timeline?.lane);
  const role = normalizedRole(participant.timeline?.role);
  const converted = RawParticipantSchema.safeParse({
    assists: numberFrom(records, "assists", "ASSISTS"),
    baronKills: numberFrom(records, "baronKills", "BARON_KILLS"),
    basicPings: numberFrom(records, "basicPings", "BASIC_PINGS"),
    champExperience: numberFrom(records, "champExperience", "EXP"),
    champLevel: numberFrom(records, "champLevel", "LEVEL"),
    championId: participant.championId,
    championName:
      source.skinName ??
      stringFrom(records, "championName", "SKIN") ??
      participant.championName,
    championTransform: numberFrom(
      records,
      "championTransform",
      "CHAMPION_TRANSFORM",
    ),
    allInPings: numberFrom(records, "allInPings", "ALL_IN_PINGS"),
    assistMePings: numberFrom(records, "assistMePings", "ASSIST_ME_PINGS"),
    commandPings: numberFrom(records, "commandPings", "COMMAND_PINGS"),
    retreatPings: numberFrom(records, "retreatPings", "RETREAT_PINGS"),
    visionClearedPings: numberFrom(
      records,
      "visionClearedPings",
      "VISION_CLEARED_PINGS",
    ),
    consumablesPurchased: numberFrom(
      records,
      "consumablesPurchased",
      "CONSUMABLES_PURCHASED",
    ),
    damageDealtToBuildings: numberFrom(
      records,
      "damageDealtToBuildings",
      "TOTAL_DAMAGE_DEALT_TO_BUILDINGS",
    ),
    damageDealtToEpicMonsters: numberFrom(
      records,
      "damageDealtToEpicMonsters",
      "TOTAL_DAMAGE_DEALT_TO_EPIC_MONSTERS",
    ),
    damageDealtToObjectives: numberFrom(
      records,
      "damageDealtToObjectives",
      "TOTAL_DAMAGE_DEALT_TO_OBJECTIVES",
    ),
    damageDealtToTurrets: numberFrom(
      records,
      "damageDealtToTurrets",
      "TOTAL_DAMAGE_DEALT_TO_TURRETS",
    ),
    damageSelfMitigated: numberFrom(
      records,
      "damageSelfMitigated",
      "TOTAL_DAMAGE_SELF_MITIGATED",
    ),
    dangerPings: numberFrom(records, "dangerPings", "DANGER_PINGS"),
    deaths: numberFrom(records, "deaths", "NUM_DEATHS"),
    detectorWardsPlaced: numberFrom(
      records,
      "detectorWardsPlaced",
      "WARD_PLACED_DETECTOR",
    ),
    doubleKills: numberFrom(records, "doubleKills", "DOUBLE_KILLS"),
    dragonKills: numberFrom(records, "dragonKills", "DRAGON_KILLS"),
    enemyMissingPings: numberFrom(
      records,
      "enemyMissingPings",
      "ENEMY_MISSING_PINGS",
    ),
    enemyVisionPings: numberFrom(
      records,
      "enemyVisionPings",
      "ENEMY_VISION_PINGS",
    ),
    firstBloodAssist: booleanFrom(records, "firstBloodAssist"),
    firstBloodKill: booleanFrom(records, "firstBloodKill"),
    firstTowerAssist: booleanFrom(records, "firstTowerAssist"),
    firstTowerKill: booleanFrom(records, "firstTowerKill"),
    gameEndedInEarlySurrender: booleanFrom(
      records,
      "gameEndedInEarlySurrender",
      "GAME_ENDED_IN_EARLY_SURRENDER",
    ),
    gameEndedInSurrender: booleanFrom(
      records,
      "gameEndedInSurrender",
      "GAME_ENDED_IN_SURRENDER",
    ),
    getBackPings: numberFrom(records, "getBackPings", "GET_BACK_PINGS"),
    goldEarned: numberFrom(records, "goldEarned", "GOLD_EARNED"),
    goldSpent: numberFrom(records, "goldSpent", "GOLD_SPENT"),
    holdPings: numberFrom(records, "holdPings", "HOLD_PINGS"),
    individualPosition: position,
    inhibitorKills: numberFrom(records, "inhibitorKills", "BARRACKS_KILLED"),
    inhibitorTakedowns: numberFrom(
      records,
      "inhibitorTakedowns",
      "BARRACKS_TAKEDOWNS",
    ),
    inhibitorsLost: numberFrom(
      records,
      "inhibitorsLost",
      "FRIENDLY_DAMPEN_LOST",
    ),
    item0: numberFrom(records, "item0", "ITEM0"),
    item1: numberFrom(records, "item1", "ITEM1"),
    item2: numberFrom(records, "item2", "ITEM2"),
    item3: numberFrom(records, "item3", "ITEM3"),
    item4: numberFrom(records, "item4", "ITEM4"),
    item5: numberFrom(records, "item5", "ITEM5"),
    item6: numberFrom(records, "item6", "ITEM6"),
    itemsPurchased: numberFrom(records, "itemsPurchased", "ITEMS_PURCHASED"),
    killingSprees: numberFrom(records, "killingSprees", "KILLING_SPREES"),
    kills: numberFrom(records, "kills", "CHAMPIONS_KILLED"),
    lane,
    largestCriticalStrike: numberFrom(
      records,
      "largestCriticalStrike",
      "LARGEST_CRITICAL_STRIKE",
    ),
    largestKillingSpree: numberFrom(
      records,
      "largestKillingSpree",
      "LARGEST_KILLING_SPREE",
    ),
    largestMultiKill: numberFrom(
      records,
      "largestMultiKill",
      "LARGEST_MULTI_KILL",
    ),
    longestTimeSpentLiving: numberFrom(
      records,
      "longestTimeSpentLiving",
      "LONGEST_TIME_SPENT_LIVING",
    ),
    magicDamageDealt: numberFrom(
      records,
      "magicDamageDealt",
      "MAGIC_DAMAGE_DEALT_PLAYER",
    ),
    magicDamageDealtToChampions: numberFrom(
      records,
      "magicDamageDealtToChampions",
      "MAGIC_DAMAGE_DEALT_TO_CHAMPIONS",
    ),
    magicDamageTaken: numberFrom(
      records,
      "magicDamageTaken",
      "MAGIC_DAMAGE_TAKEN",
    ),
    needVisionPings: numberFrom(
      records,
      "needVisionPings",
      "NEED_VISION_PINGS",
    ),
    neutralMinionsKilled: numberFrom(
      records,
      "neutralMinionsKilled",
      "NEUTRAL_MINIONS_KILLED",
    ),
    nexusKills: numberFrom(records, "nexusKills", "HQ_KILLED"),
    nexusLost: numberFrom(records, "nexusLost", "FRIENDLY_HQ_LOST"),
    nexusTakedowns: numberFrom(records, "nexusTakedowns", "HQ_TAKEDOWNS"),
    objectivesStolen: numberFrom(
      records,
      "objectivesStolen",
      "OBJECTIVES_STOLEN",
    ),
    objectivesStolenAssists: numberFrom(
      records,
      "objectivesStolenAssists",
      "OBJECTIVES_STOLEN_ASSISTS",
    ),
    onMyWayPings: numberFrom(records, "onMyWayPings", "ON_MY_WAY_PINGS"),
    participantId: participant.participantId,
    pentaKills: numberFrom(records, "pentaKills", "PENTA_KILLS"),
    perks: perksFrom(records),
    physicalDamageDealt: numberFrom(
      records,
      "physicalDamageDealt",
      "PHYSICAL_DAMAGE_DEALT_PLAYER",
    ),
    physicalDamageDealtToChampions: numberFrom(
      records,
      "physicalDamageDealtToChampions",
      "PHYSICAL_DAMAGE_DEALT_TO_CHAMPIONS",
    ),
    physicalDamageTaken: numberFrom(
      records,
      "physicalDamageTaken",
      "PHYSICAL_DAMAGE_TAKEN",
    ),
    profileIcon: source.profileIconId ?? identity.player.profileIcon,
    puuid: identity.player.puuid,
    pushPings: numberFrom(records, "pushPings", "PUSH_PINGS"),
    quadraKills: numberFrom(records, "quadraKills", "QUADRA_KILLS"),
    riotIdGameName: source.riotIdGameName ?? identity.player.gameName,
    riotIdName: identity.player.summonerName,
    riotIdTagline:
      source.riotIdTagLine ??
      stringFrom(records, "riotIdTagline", "RIOT_ID_TAG_LINE") ??
      identity.player.tagLine,
    role,
    sightWardsBoughtInGame: numberFrom(
      records,
      "sightWardsBoughtInGame",
      "SIGHT_WARDS_BOUGHT_IN_GAME",
    ),
    spell1Casts: numberFrom(records, "spell1Casts", "SPELL1_CAST"),
    spell2Casts: numberFrom(records, "spell2Casts", "SPELL2_CAST"),
    spell3Casts: numberFrom(records, "spell3Casts", "SPELL3_CAST"),
    spell4Casts: numberFrom(records, "spell4Casts", "SPELL4_CAST"),
    summoner1Casts: numberFrom(records, "summoner1Casts", "SUMMON_SPELL1_CAST"),
    summoner1Id: participant.spell1Id,
    summoner2Casts: numberFrom(records, "summoner2Casts", "SUMMON_SPELL2_CAST"),
    summoner2Id: participant.spell2Id,
    summonerId: source.summonerId ?? identity.player.summonerId,
    summonerLevel:
      source.level ?? numberFrom(records, "summonerLevel", "SUMMONER_LEVEL"),
    summonerName: source.summonerName ?? identity.player.summonerName,
    teamEarlySurrendered: booleanFrom(
      records,
      "teamEarlySurrendered",
      "TEAM_EARLY_SURRENDERED",
    ),
    teamId: participant.teamId,
    teamPosition: position,
    timeCCingOthers: numberFrom(
      records,
      "timeCCingOthers",
      "TIME_CCING_OTHERS",
    ),
    timePlayed: numberFrom(records, "timePlayed", "TIME_PLAYED"),
    totalAllyJungleMinionsKilled: numberFrom(
      records,
      "totalAllyJungleMinionsKilled",
      "NEUTRAL_MINIONS_KILLED_YOUR_JUNGLE",
    ),
    totalDamageDealt: numberFrom(
      records,
      "totalDamageDealt",
      "TOTAL_DAMAGE_DEALT",
    ),
    totalDamageDealtToChampions: numberFrom(
      records,
      "totalDamageDealtToChampions",
      "TOTAL_DAMAGE_DEALT_TO_CHAMPIONS",
    ),
    totalDamageShieldedOnTeammates: numberFrom(
      records,
      "totalDamageShieldedOnTeammates",
      "TOTAL_DAMAGE_SHIELDED_ON_TEAMMATES",
    ),
    totalDamageTaken: numberFrom(
      records,
      "totalDamageTaken",
      "TOTAL_DAMAGE_TAKEN",
    ),
    totalEnemyJungleMinionsKilled: numberFrom(
      records,
      "totalEnemyJungleMinionsKilled",
      "NEUTRAL_MINIONS_KILLED_ENEMY_JUNGLE",
    ),
    totalHeal: numberFrom(records, "totalHeal", "TOTAL_HEAL"),
    totalHealsOnTeammates: numberFrom(
      records,
      "totalHealsOnTeammates",
      "TOTAL_HEAL_ON_TEAMMATES",
    ),
    totalMinionsKilled: numberFrom(
      records,
      "totalMinionsKilled",
      "MINIONS_KILLED",
    ),
    totalTimeCCDealt: numberFrom(
      records,
      "totalTimeCCDealt",
      "TOTAL_TIME_CROWD_CONTROL_DEALT",
    ),
    totalTimeSpentDead: numberFrom(
      records,
      "totalTimeSpentDead",
      "TOTAL_TIME_SPENT_DEAD",
    ),
    totalUnitsHealed: numberFrom(
      records,
      "totalUnitsHealed",
      "TOTAL_UNITS_HEALED",
    ),
    tripleKills: numberFrom(records, "tripleKills", "TRIPLE_KILLS"),
    trueDamageDealt: numberFrom(
      records,
      "trueDamageDealt",
      "TRUE_DAMAGE_DEALT_PLAYER",
    ),
    trueDamageDealtToChampions: numberFrom(
      records,
      "trueDamageDealtToChampions",
      "TRUE_DAMAGE_DEALT_TO_CHAMPIONS",
    ),
    trueDamageTaken: numberFrom(
      records,
      "trueDamageTaken",
      "TRUE_DAMAGE_TAKEN",
    ),
    turretKills: numberFrom(records, "turretKills", "TURRETS_KILLED"),
    turretTakedowns: numberFrom(records, "turretTakedowns", "TURRET_TAKEDOWNS"),
    turretsLost: numberFrom(records, "turretsLost", "FRIENDLY_TURRET_LOST"),
    unrealKills: numberFrom(records, "unrealKills", "UNREAL_KILLS"),
    visionScore: numberFrom(records, "visionScore", "VISION_SCORE"),
    visionWardsBoughtInGame: numberFrom(
      records,
      "visionWardsBoughtInGame",
      "VISION_WARDS_BOUGHT_IN_GAME",
    ),
    wardsKilled: numberFrom(records, "wardsKilled", "WARD_KILLED"),
    wardsPlaced: numberFrom(records, "wardsPlaced", "WARD_PLACED"),
    win: booleanFrom(records, "win", "WIN"),
  });
  return converted.success ? converted.data : null;
}
