import type {
  ClassicChampion,
  ClassicMatch,
  PlayerConfigEntry,
  RawMatch,
  RawParticipant,
  Team,
} from "@scout-for-lol/data";
import {
  ClassicMatchSchema,
  findParticipant,
  getOutcome,
  mapIdToName,
  parseTeam,
  resolveClassicChampionKey,
} from "@scout-for-lol/data";

function requireRiotIdGameName(participant: RawParticipant): string {
  if (
    participant.riotIdGameName === undefined ||
    participant.riotIdGameName.length === 0
  ) {
    throw new Error(
      `Classic match participant ${participant.puuid} has no Riot ID game name`,
    );
  }
  return participant.riotIdGameName;
}

function toClassicChampion(participant: RawParticipant): ClassicChampion {
  return {
    puuid: participant.puuid,
    riotIdGameName: requireRiotIdGameName(participant),
    riotIdTagLine: participant.riotIdTagline,
    championId: participant.championId,
    championName: resolveClassicChampionKey(participant.championId),
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    level: participant.champLevel,
    items: [
      participant.item0,
      participant.item1,
      participant.item2,
      participant.item3,
      participant.item4,
      participant.item5,
      participant.item6,
    ],
    spells: [participant.summoner1Id, participant.summoner2Id],
    gold: participant.goldEarned,
    creepScore:
      participant.totalMinionsKilled + participant.neutralMinionsKilled,
  };
}

function requireTeam(participant: RawParticipant): Team {
  const team = parseTeam(participant.teamId);
  if (team === undefined) {
    throw new Error(
      `Classic match participant ${participant.puuid} has unsupported team ID ${participant.teamId.toString()}`,
    );
  }
  return team;
}

export function buildClassicMatch(
  matchData: RawMatch,
  playersInMatch: PlayerConfigEntry[],
): ClassicMatch {
  const blue = matchData.info.participants
    .filter((participant) => requireTeam(participant) === "blue")
    .map((participant) => toClassicChampion(participant));
  const red = matchData.info.participants
    .filter((participant) => requireTeam(participant) === "red")
    .map((participant) => toClassicChampion(participant));

  const players = playersInMatch.map((playerConfig) => {
    const participant = findParticipant(
      playerConfig.league.leagueAccount.puuid,
      matchData.info.participants,
    );
    if (participant === undefined) {
      throw new Error(
        `Tracked Classic player ${playerConfig.alias} was absent from the match participant payload`,
      );
    }
    return {
      playerConfig,
      outcome: getOutcome(participant),
      champion: toClassicChampion(participant),
      team: requireTeam(participant),
    };
  });

  const mapName = mapIdToName(matchData.info.mapId);
  if (mapName !== "Classic Rift") {
    throw new Error(
      `Classic queue used unexpected map ${mapName} (${matchData.info.mapId.toString()})`,
    );
  }

  return ClassicMatchSchema.parse({
    durationInSeconds: matchData.info.gameDuration,
    queueType: "classic",
    mapName,
    players,
    teams: { blue, red },
  });
}
