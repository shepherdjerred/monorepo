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
import { createLogger } from "#src/logger.ts";
import { participantMismatchTotal } from "#src/metrics/index.ts";

const logger = createLogger("postmatch-match-report-classic");

const UNKNOWN_RIOT_ID_COMPONENT = "Unknown";

function nonBlank(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return;
  }
  return value;
}

function resolveClassicIdentity(
  participant: RawParticipant,
): Pick<ClassicChampion, "riotIdGameName" | "riotIdTagLine"> {
  return {
    riotIdGameName:
      nonBlank(participant.riotIdGameName) ??
      nonBlank(participant.summonerName) ??
      UNKNOWN_RIOT_ID_COMPONENT,
    riotIdTagLine:
      nonBlank(participant.riotIdTagline) ?? UNKNOWN_RIOT_ID_COMPONENT,
  };
}

function toClassicChampion(participant: RawParticipant): ClassicChampion {
  return {
    puuid: participant.puuid,
    ...resolveClassicIdentity(participant),
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
): ClassicMatch | undefined {
  const blue = matchData.info.participants
    .filter((participant) => requireTeam(participant) === "blue")
    .map((participant) => toClassicChampion(participant));
  const red = matchData.info.participants
    .filter((participant) => requireTeam(participant) === "red")
    .map((participant) => toClassicChampion(participant));

  const players = playersInMatch
    .map((playerConfig) => {
      const searchingFor = playerConfig.league.leagueAccount.puuid;
      const participant = findParticipant(
        searchingFor,
        matchData.info.participants,
      );
      if (participant === undefined) {
        const metadataPuuids = matchData.metadata.participants;
        const infoPuuids = matchData.info.participants.map(
          (candidate) => candidate.puuid,
        );

        logger.warn(
          "Classic participant mismatch: in metadata but not in info (skipping player)",
          {
            searchingFor,
            playerAlias: playerConfig.alias,
            matchId: matchData.metadata.matchId,
            queueId: matchData.info.queueId,
            inMetadata: metadataPuuids.includes(searchingFor),
            inInfo: infoPuuids.includes(searchingFor),
            metadataPuuids,
            infoPuuids,
            metadataCount: metadataPuuids.length,
            infoCount: infoPuuids.length,
            mismatchedCounts: metadataPuuids.length !== infoPuuids.length,
            emptyPuuidsInInfo: infoPuuids.filter((puuid) => puuid === "")
              .length,
          },
        );
        participantMismatchTotal.inc({ queue_type: "classic" });
        return;
      }
      return {
        playerConfig,
        outcome: getOutcome(participant),
        champion: toClassicChampion(participant),
        team: requireTeam(participant),
      };
    })
    .filter((player) => player !== undefined);

  if (players.length === 0) {
    return undefined;
  }

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
