import { parseDivision, Ranks } from "@discord/data";
import { PlayerConfigEntry } from "@discord/data";
import { Rank } from "@discord/data";
import { TierSchema } from "@discord/data";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import { api } from "../api/api.ts";
import { Constants } from "npm:twisted@1.57.0";
import { SummonerLeagueDto } from "npm:twisted@1.57.0/dist/models-dto/index.js";

const solo = "RANKED_SOLO_5x5";
const flex = "RANKED_TEAM_5x5";

export function getDto(
  dto: SummonerLeagueDto[],
  queue: string
): SummonerLeagueDto | undefined {
  return _.chain(dto)
    .filter((entry) => entry.queueType === queue)
    .first()
    .value();
}

export function getRank(
  dto: SummonerLeagueDto[],
  queue: string
): Rank | undefined {
  const entry = getDto(dto, queue);
  if (entry == undefined) {
    return undefined;
  }

  const division = parseDivision(entry.rank);
  if (division == undefined) {
    return undefined;
  }

  return {
    division,
    tier: TierSchema.parse(entry.tier.toLowerCase()),
    lp: entry.leaguePoints,
    wins: entry.wins,
    losses: entry.losses,
  };
}

export async function getRanks(player: PlayerConfigEntry): Promise<Ranks> {
  // TODO: get region from player
  const response = await api.League.bySummoner(
    player.league.leagueAccount.id,
    Constants.Regions.AMERICA_NORTH
  );

  return {
    solo: getRank(response.response, solo),
    flex: getRank(response.response, flex),
  };
}
