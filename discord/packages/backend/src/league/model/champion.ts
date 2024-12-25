import { Champion } from "@discord/data";
import { parseLane } from "@discord/data";
import { MatchV5DTOs } from "npm:twisted@1.57.0/dist/models-dto/index.js";

export function participantToChampion(
  dto: MatchV5DTOs.ParticipantDto
): Champion {
  return {
    summonerName: dto.riotIdName || dto.summonerName,
    championName: dto.championName,
    kills: dto.kills,
    deaths: dto.deaths,
    assists: dto.assists,
    items: [
      dto.item0,
      dto.item1,
      dto.item2,
      dto.item3,
      dto.item4,
      dto.item5,
      dto.item6,
    ],
    spells: [dto.summoner1Id, dto.summoner2Id],
    runes: [],
    lane: parseLane(dto.teamPosition),
    creepScore: dto.totalMinionsKilled + dto.neutralMinionsKilled,
    visionScore: dto.visionScore,
    damage: dto.totalDamageDealtToChampions,
    gold: dto.goldEarned,
    level: dto.champLevel,
  };
}
