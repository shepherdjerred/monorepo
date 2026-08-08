import {
  CompletedMatchSchema,
  findParticipant,
  getLaneOpponent,
  getOutcome,
  getTeams,
  invertTeam,
  parseTeam,
  participantToChampion,
  resolveQueueTypeFromGame,
  isClassicQueueType,
  type CompletedMatch,
  type PlayerConfigEntry,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data";

export function buildCompletedMatch(
  rawMatch: RawMatch,
  trackedPlayers: PlayerConfigEntry[],
): CompletedMatch {
  const queueType = resolveQueueTypeFromGame(
    rawMatch.info.queueId,
    rawMatch.info.gameMode,
    rawMatch.info.gameType,
  );
  if (
    queueType === undefined ||
    queueType === "arena" ||
    isClassicQueueType(queueType)
  ) {
    throw new Error(`Unsupported eval queue: ${queueType ?? "unknown"}`);
  }
  const teams = getTeams(rawMatch.info.participants, participantToChampion);
  const players = trackedPlayers.map((playerConfig) => {
    const participant = findParticipant(
      playerConfig.league.leagueAccount.puuid,
      rawMatch.info.participants,
    );
    if (participant === undefined) {
      throw new Error(
        `Tracked player ${playerConfig.alias} is absent from ${rawMatch.metadata.matchId}`,
      );
    }
    const champion = participantToChampion(participant);
    const team = parseTeam(participant.teamId);
    if (team === undefined) {
      throw new Error(`Unsupported team id ${participant.teamId.toString()}`);
    }
    return {
      champion,
      lane: champion.lane,
      laneOpponent: getLaneOpponent(champion, teams[invertTeam(team)]),
      outcome: getOutcome(participant),
      playerConfig,
      team,
    };
  });
  return CompletedMatchSchema.parse({
    durationInSeconds: rawMatch.info.gameDuration,
    players,
    queueType,
    teams,
  });
}

export function findTargetPlayerIndex(
  match: CompletedMatch,
  targetPlayerPuuid: string,
): number {
  const index = match.players.findIndex(
    (player) =>
      player.playerConfig.league.leagueAccount.puuid === targetPlayerPuuid,
  );
  if (index === -1) {
    throw new Error(`Target PUUID is not present in the tracked player list`);
  }
  return index;
}

export function findRawTarget(
  rawMatch: RawMatch,
  targetPlayerPuuid: string,
): RawParticipant {
  const participant = findParticipant(
    targetPlayerPuuid,
    rawMatch.info.participants,
  );
  if (participant === undefined) {
    throw new Error(
      `Target PUUID is not present in ${rawMatch.metadata.matchId}`,
    );
  }
  return participant;
}

export function buildDeterministicFacts(
  rawMatch: RawMatch,
  participant: RawParticipant,
): string {
  const creepScore =
    participant.totalMinionsKilled + participant.neutralMinionsKilled;
  const teamKills = rawMatch.info.participants
    .filter((candidate) => candidate.teamId === participant.teamId)
    .reduce((total, candidate) => total + candidate.kills, 0);
  return [
    `Result: ${participant.win ? "victory" : "defeat"}`,
    `Champion: ${participant.championName}`,
    `K/D/A: ${participant.kills.toString()}/${participant.deaths.toString()}/${participant.assists.toString()}`,
    `Team kills: ${teamKills.toString()}`,
    `Damage to champions: ${participant.totalDamageDealtToChampions.toString()}`,
    `CS: ${creepScore.toString()}`,
    `Vision score: ${participant.visionScore.toString()}`,
    `Gold earned: ${participant.goldEarned.toString()}`,
    `Game duration seconds: ${rawMatch.info.gameDuration.toString()}`,
  ].join("\n");
}
