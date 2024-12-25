import {
  Champion,
  CompletedMatch,
  invertTeam,
  parseQueueType,
  Player,
  Rank,
} from "@discord/data";
import { parseTeam } from "@discord/data";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import { MatchV5DTOs } from "npm:twisted@1.57.0/dist/models-dto/index.js";
import { participantToChampion } from "./champion.ts";
import { match } from "https://esm.sh/ts-pattern@5.0.5";
import { assert } from "https://deno.land/std@0.218.0/assert/mod.ts";

function findParticipant(
  puuid: string,
  participants: MatchV5DTOs.ParticipantDto[]
): MatchV5DTOs.ParticipantDto {
  return _.chain(participants)
    .filter((participant) => participant.puuid === puuid)
    .first()
    .value();
}

export function getOutcome(participant: MatchV5DTOs.ParticipantDto) {
  return match(participant)
    .returnType<"Victory" | "Surrender" | "Defeat">()
    .with({ win: true }, () => "Victory")
    .with({ gameEndedInSurrender: true }, () => "Surrender")
    .with({ win: false }, () => "Defeat")
    .exhaustive();
}

function getLaneOpponent(player: Champion, opponents: Champion[]): Champion {
  return _.chain(opponents)
    .filter((opponent) => opponent.lane === player.lane)
    .first()
    .value();
}

function getTeams(participants: MatchV5DTOs.ParticipantDto[]) {
  return {
    blue: _.map(participants.slice(0, 5), participantToChampion),
    red: _.map(participants.slice(5, 10), participantToChampion),
  };
}

export function toMatch(
  player: Player,
  matchDto: MatchV5DTOs.MatchDto,
  rankBeforeMatch: Rank | undefined,
  rankAfterMatch: Rank
): CompletedMatch {
  const participant = findParticipant(
    player.config.league.leagueAccount.puuid,
    matchDto.info.participants
  );
  const champion = participantToChampion(participant);
  const team = parseTeam(participant.teamId);
  const teams = getTeams(matchDto.info.participants);

  assert(team !== undefined);

  const enemyTeam = invertTeam(team);

  return {
    queueType: parseQueueType(matchDto.info.queueId),
    player: {
      playerConfig: player.config,
      rankBeforeMatch,
      rankAfterMatch,
      wins: player.ranks.solo?.wins || 0,
      losses: player.ranks.solo?.losses || 0,
      champion,
      outcome: getOutcome(participant),
      team: team,
      lane: champion.lane,
      laneOpponent: getLaneOpponent(champion, teams[enemyTeam]),
    },
    durationInSeconds: matchDto.info.gameDuration,
    teams,
  };
}
