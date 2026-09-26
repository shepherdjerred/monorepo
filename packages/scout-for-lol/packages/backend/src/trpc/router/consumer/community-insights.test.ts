import { describe, expect, test } from "vitest";
import { balanceGuildTeams } from "#src/trpc/router/consumer/community-balancer.ts";
import {
  buildCommunityInsights,
  squadChemistry,
} from "#src/trpc/router/consumer/community-insights.ts";
import type { GuildMatchRow } from "#src/reports/duckdb/community/community-lake.ts";

const roles = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const players = [
  {
    id: 1,
    alias: "Alpha",
    accounts: [
      {
        id: 1,
        puuid: "main",
        riotGameName: "Alpha",
        riotTagLine: "NA1",
        region: "NA1",
      },
      {
        id: 2,
        puuid: "smurf",
        riotGameName: "Alt",
        riotTagLine: "NA1",
        region: "NA1",
      },
    ],
  },
  {
    id: 2,
    alias: "Beta",
    accounts: [
      {
        id: 3,
        puuid: "beta",
        riotGameName: "Beta",
        riotTagLine: "NA1",
        region: "NA1",
      },
    ],
  },
  {
    id: 3,
    alias: "Gamma",
    accounts: [
      {
        id: 4,
        puuid: "gamma",
        riotGameName: "Gamma",
        riotTagLine: "NA1",
        region: "NA1",
      },
    ],
  },
];

function roster(
  matchId: string,
  at: number,
  firstPuuid: string,
): GuildMatchRow[] {
  return Array.from({ length: 10 }, (_, index) => ({
    match_id: matchId,
    game_creation_ms: at,
    queue: "solo",
    queue_id: 420,
    game_mode: "CLASSIC",
    map_id: 11,
    puuid:
      index === 0
        ? firstPuuid
        : index === 1
          ? "beta"
          : index === 5
            ? "gamma"
            : `unknown-${index.toString()}`,
    team_id: index < 5 ? 100 : 200,
    participant_id: index + 1,
    riot_id_game_name: `Riot${index.toString()}`,
    riot_id_tagline: "NA1",
    champion_name: "Ashe",
    team_position: roles[index % 5] ?? "TOP",
    win: index < 5,
    kills: 3,
    deaths: 2,
    assists: 5,
    creep_score: 100,
    time_played: 1800,
  }));
}

describe("guild community insights", () => {
  const rows = [
    ...roster("NA1_first", 1000, "main"),
    ...roster("NA1_second", 2000, "smurf"),
  ];
  test("resolves smurfs, teammates, rivals, main account, and squad meetings", () => {
    const insights = buildCommunityInsights({
      players,
      rows,
      allTimeAccounts: [
        { puuid: "main", games: 10, last_match_ms: 1000 },
        { puuid: "smurf", games: 5, last_match_ms: 2000 },
      ],
      standardOnly: true,
    });
    expect(insights.matchCount).toBe(2);
    expect(
      insights.recentlyPlayedWith.find(
        (relation) => relation.playerId === 1 && relation.guildPlayerId === 2,
      ),
    ).toMatchObject({ games: 2, wins: 2 });
    expect(
      insights.rivalries.find(
        (relation) => relation.playerId === 1 && relation.guildPlayerId === 3,
      ),
    ).toMatchObject({ games: 2, wins: 2 });
    expect(
      insights.rivalries.find(
        (relation) => relation.playerId === 1 && relation.name === "Riot6#NA1",
      )?.games,
    ).toBe(2);
    expect(
      insights.pairs.find((pair) => pair.firstId === 1 && pair.secondId === 2),
    ).toMatchObject({ games: 2, wins: 2 });
    expect(
      insights.accountForms.find((account) => account.accountId === 1)?.isMain,
    ).toBe(true);
    expect(
      insights.accountForms.find((account) => account.accountId === 2)?.games,
    ).toBe(1);
    expect(squadChemistry({ players, rows, playerIds: [1, 2] })).toMatchObject({
      games: 2,
      wins: 2,
      lowSample: true,
    });
    expect(squadChemistry({ players, rows, playerIds: [1, 3] }).games).toBe(0);
  });

  test("assigns ten unique players to five roles per team deterministically", () => {
    const form = Array.from({ length: 10 }, (_, index) => ({
      playerId: index + 1,
      games: 20,
      wins: index < 5 ? 16 : 4,
      strength: index < 5 ? 0.7 : 0.3,
      roles: { [roles[index % 5] ?? "TOP"]: 20 },
    }));
    const first = balanceGuildTeams(form, "roles");
    const second = balanceGuildTeams(form, "roles");
    expect(second).toEqual(first);
    expect(
      first.teams
        .flatMap((team) =>
          team.assignments.map((assignment) => assignment.playerId),
        )
        .toSorted((a, b) => a - b),
    ).toEqual(form.map((player) => player.playerId).toSorted((a, b) => a - b));
    expect(
      first.teams.every(
        (team) =>
          new Set(team.assignments.map((assignment) => assignment.role))
            .size === 5,
      ),
    ).toBe(true);
    expect(balanceGuildTeams(form, "strength").formGap).toBeLessThanOrEqual(
      first.formGap,
    );
  });
});
