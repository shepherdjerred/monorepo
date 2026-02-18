import {
  type ArenaMatch,
  type ArenaMatchPlayer,
  ArenaMatchPlayerSchema,
  ArenaMatchSchema,
  ArenaTeamSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data";
import { getTeams } from "./arena-teams.ts";
import {
  createAatroxChampion,
  createLeonaChampion,
} from "./arena-factories.ts";
import {
  createMasterOfDualityAugment,
  createCourageAugment,
} from "./arena-augments.ts";

function getMainPlayer() {
  return {
    playerConfig: {
      alias: "MainPlayer",
      league: {
        leagueAccount: {
          puuid: LeaguePuuidSchema.parse(
             
            "XtEsV464OFaO3c0_q9REa6wYF0HpC2LK4laLnyM7WhfAVeuDz9biieJ5ZRD049AUCBjLjyBeeezTaw",
          ),
          region: "AMERICA_NORTH" as const,
        },
      },
      discordAccount: null,
    },
    wins: 5,
    losses: 2,
    placement: 2 as const,
    teamId: 1 as const,
    champion: createAatroxChampion([createMasterOfDualityAugment()]),
    teammate: createLeonaChampion([createCourageAugment()]),
  } satisfies ArenaMatchPlayer;
}

export function getArenaExampleMatch(): ArenaMatch {
  const mainPlayer = getMainPlayer();
  const teams = getTeams();
  return ArenaMatchSchema.parse({
    durationInSeconds: 1200,
    queueType: "arena",
    players: [ArenaMatchPlayerSchema.parse(mainPlayer)],
    teams: teams.map((team) => ArenaTeamSchema.parse(team)),
  });
}
