import type {
  RawMatch,
  CompletedMatch,
  Player,
  Rank,
} from "@scout-for-lol/data";
import {
  getLaneOpponent,
  invertTeam,
  parseQueueType,
  parseTeam,
  findParticipant,
  getOutcome,
  getTeams,
  participantToChampion,
} from "@scout-for-lol/data";
import { strict as assert } from "node:assert";

export function toMatch(
  player: Player,
  rawMatch: RawMatch,
  rankBeforeMatch: Rank | undefined,
  rankAfterMatch: Rank | undefined,
): CompletedMatch {
  const participant = findParticipant(
    player.config.league.leagueAccount.puuid,
    rawMatch.info.participants,
  );
  if (participant === undefined) {
    console.debug("Player PUUID:", player.config.league.leagueAccount.puuid);
    console.debug("Match Participants:", rawMatch.info.participants);
    throw new Error("participant not found");
  }

  const champion = participantToChampion(participant);
  const team = parseTeam(participant.teamId);
  const teams = getTeams(rawMatch.info.participants, participantToChampion);

  assert.ok(team !== undefined);

  const enemyTeam = invertTeam(team);
  const queueType = parseQueueType(rawMatch.info.queueId);

  if (queueType === "arena") {
    throw new Error("arena matches are not supported");
  }

  return {
    queueType,
    players: [
      {
        playerConfig: player.config,
        rankBeforeMatch,
        rankAfterMatch,
        wins:
          queueType === "solo" || queueType === "flex"
            ? (player.ranks[queueType]?.wins ?? undefined)
            : undefined,
        losses:
          queueType === "solo" || queueType === "flex"
            ? (player.ranks[queueType]?.losses ?? undefined)
            : undefined,
        champion,
        outcome: getOutcome(participant),
        team: team,
        lane: champion.lane,
        laneOpponent: getLaneOpponent(champion, teams[enemyTeam]),
      },
    ],
    durationInSeconds: rawMatch.info.gameDuration,
    teams,
  };
}
