import type {
  RawCurrentGameInfo,
  RawMatch,
  RawParticipant,
} from "@scout-for-lol/data";
import { resolveQueueTypeFromGame } from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import type {
  AccountLakeRow,
  MatchLakeRow,
  PrematchLakeRow,
} from "#src/report-lake/schema.ts";
import { lakeMonth, lakeTimestamp } from "#src/report-lake/schema.ts";

/**
 * Flatten raw Riot documents into report-lake rows.
 *
 * These are the ONLY places lake rows are produced (staging appends at ingest
 * and compaction rebuilds), so the derivations below define lake semantics.
 * They intentionally match the fact-table derivations in
 * report-store/store.ts (participantKda / participantCreepScore /
 * participantSurrendered) — pinned by unit tests — until the fact tables are
 * dropped in the follow-up PR.
 */

type AccountWithPlayer = Prisma.AccountGetPayload<{
  include: { player: true };
}>;

function participantKda(participant: RawParticipant): number {
  const takedowns = participant.kills + participant.assists;
  return participant.deaths === 0 ? takedowns : takedowns / participant.deaths;
}

function participantCreepScore(participant: RawParticipant): number {
  return participant.totalMinionsKilled + participant.neutralMinionsKilled;
}

function participantSurrendered(participant: RawParticipant): boolean {
  return participant.gameEndedInSurrender || participant.teamEarlySurrendered;
}

function participantEarlySurrendered(participant: RawParticipant): boolean {
  return (
    participant.gameEndedInEarlySurrender || participant.teamEarlySurrendered
  );
}

export function flattenMatch(match: RawMatch): MatchLakeRow[] {
  const queue =
    resolveQueueTypeFromGame(
      match.info.queueId,
      match.info.gameMode,
      match.info.gameType,
    ) ?? null;
  const matchId = match.metadata.matchId;

  return match.info.participants.map((participant) => ({
    match_id: matchId,
    game_id: match.info.gameId.toString(),
    platform_id: match.info.platformId,
    month: lakeMonth(match.info.gameCreation),
    game_creation_at: lakeTimestamp(match.info.gameCreation),
    game_start_at: lakeTimestamp(match.info.gameStartTimestamp),
    game_end_at: lakeTimestamp(match.info.gameEndTimestamp),
    game_duration_seconds: match.info.gameDuration,
    queue_id: match.info.queueId,
    queue,
    game_mode: match.info.gameMode,
    game_type: match.info.gameType,
    game_version: match.info.gameVersion,
    map_id: match.info.mapId,
    puuid: participant.puuid,
    participant_id: participant.participantId,
    team_id: participant.teamId,
    riot_id_game_name: participant.riotIdGameName ?? null,
    riot_id_tagline: participant.riotIdTagline,
    summoner_name: participant.summonerName,
    champion_id: participant.championId,
    champion_name: participant.championName,
    team_position: participant.teamPosition,
    individual_position: participant.individualPosition,
    lane: participant.lane ?? null,
    role: participant.role ?? null,
    win: participant.win,
    surrendered: participantSurrendered(participant),
    early_surrendered: participantEarlySurrendered(participant),
    game_ended_in_surrender: participant.gameEndedInSurrender,
    game_ended_in_early_surrender: participant.gameEndedInEarlySurrender,
    team_early_surrendered: participant.teamEarlySurrendered,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    kda: participantKda(participant),
    creep_score: participantCreepScore(participant),
    total_minions_killed: participant.totalMinionsKilled,
    neutral_minions_killed: participant.neutralMinionsKilled,
    gold_earned: participant.goldEarned,
    gold_spent: participant.goldSpent,
    total_damage_dealt: participant.totalDamageDealt,
    total_damage_dealt_to_champions: participant.totalDamageDealtToChampions,
    total_damage_taken: participant.totalDamageTaken,
    damage_self_mitigated: participant.damageSelfMitigated,
    damage_dealt_to_objectives: participant.damageDealtToObjectives,
    damage_dealt_to_turrets: participant.damageDealtToTurrets,
    total_heal: participant.totalHeal,
    total_heals_on_teammates: participant.totalHealsOnTeammates,
    vision_score: participant.visionScore,
    wards_placed: participant.wardsPlaced,
    wards_killed: participant.wardsKilled,
    vision_wards_bought_in_game: participant.visionWardsBoughtInGame,
    detector_wards_placed: participant.detectorWardsPlaced,
    double_kills: participant.doubleKills,
    triple_kills: participant.tripleKills,
    quadra_kills: participant.quadraKills,
    penta_kills: participant.pentaKills,
    largest_multi_kill: participant.largestMultiKill,
    killing_sprees: participant.killingSprees,
    first_blood_kill: participant.firstBloodKill,
    champ_level: participant.champLevel,
    champ_experience: participant.champExperience,
    time_played: participant.timePlayed,
    total_time_spent_dead: participant.totalTimeSpentDead,
    longest_time_spent_living: participant.longestTimeSpentLiving,
    time_ccing_others: participant.timeCCingOthers,
    turret_kills: participant.turretKills,
    inhibitor_kills: participant.inhibitorKills,
    baron_kills: participant.baronKills,
    dragon_kills: participant.dragonKills,
    placement: participant.placement ?? null,
    subteam_placement: participant.subteamPlacement ?? null,
    player_subteam_id: participant.playerSubteamId ?? null,
  }));
}

/**
 * Flatten a spectator observation. Privacy-scrubbed participants (null
 * puuid) are skipped — they carry no usable identity and can never join to a
 * tracked account, matching today's fact behavior (store.ts).
 */
export function flattenPrematch(
  gameInfo: RawCurrentGameInfo,
  observedAt: Date,
): PrematchLakeRow[] {
  const queue =
    resolveQueueTypeFromGame(
      gameInfo.gameQueueConfigId,
      gameInfo.gameMode,
      gameInfo.gameType,
    ) ?? null;
  const dedupeKey = `${gameInfo.platformId}:${gameInfo.gameId.toString()}`;
  const observedMs = observedAt.getTime();
  const gameStartAt =
    gameInfo.gameStartTime > 0 ? lakeTimestamp(gameInfo.gameStartTime) : null;

  return gameInfo.participants.flatMap((participant) => {
    if (participant.puuid === null) {
      return [];
    }
    return [
      {
        dedupe_key: dedupeKey,
        game_id: gameInfo.gameId.toString(),
        platform_id: gameInfo.platformId,
        month: lakeMonth(observedMs),
        observed_at: lakeTimestamp(observedMs),
        game_start_at: gameStartAt,
        queue_id: gameInfo.gameQueueConfigId,
        queue,
        game_mode: gameInfo.gameMode,
        game_type: gameInfo.gameType,
        map_id: gameInfo.mapId,
        puuid: participant.puuid,
        team_id: participant.teamId,
        player_subteam_id: participant.playerSubteamId ?? null,
        champion_id: participant.championId,
        riot_id: participant.riotId,
        summoner_name: participant.summonerName ?? null,
        selected_skin_index: participant.lastSelectedSkinIndex,
        bot: participant.bot,
      },
    ];
  });
}

export function accountToLakeRow(account: AccountWithPlayer): AccountLakeRow {
  return {
    server_id: account.serverId,
    puuid: account.puuid,
    account_id: account.id,
    account_alias: account.alias,
    region: account.region,
    player_id: account.player.id,
    player_alias: account.player.alias,
    discord_id: account.player.discordId,
  };
}
