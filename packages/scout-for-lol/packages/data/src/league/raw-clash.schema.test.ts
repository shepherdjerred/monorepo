import { describe, expect, test } from "vitest";
import {
  RawClashPlayerListSchema,
  RawClashTeamSchema,
  RawClashTournamentListSchema,
} from "./raw-clash.schema.ts";

describe("RawClash schemas", () => {
  test("parses an empty player list when Clash is inactive", () => {
    expect(RawClashPlayerListSchema.parse([])).toEqual([]);
  });

  test("parses a by-puuid registration", () => {
    const players = RawClashPlayerListSchema.parse([
      {
        puuid: "abc",
        teamId: "team-1",
        position: "FILL",
        role: "CAPTAIN",
      },
    ]);
    expect(players[0]?.teamId).toBe("team-1");
    expect(players[0]?.role).toBe("CAPTAIN");
  });

  test("parses a team and tournament list", () => {
    const team = RawClashTeamSchema.parse({
      id: "team-1",
      tournamentId: 42,
      name: "Glivengers",
      iconId: 1,
      tier: 4,
      captain: "summoner-1",
      abbreviation: "GLIV",
      players: [
        {
          summonerId: "summoner-1",
          teamId: "team-1",
          position: "TOP",
          role: "CAPTAIN",
        },
      ],
    });
    expect(team.abbreviation).toBe("GLIV");

    const tournaments = RawClashTournamentListSchema.parse([
      {
        id: 42,
        themeId: 7,
        nameKey: "freljord",
        nameKeySecondary: "day_1",
        schedule: [
          {
            id: 1,
            registrationTime: 1_779_000_000_000,
            startTime: 1_779_100_000_000,
            cancelled: false,
          },
        ],
      },
    ]);
    expect(tournaments).toHaveLength(1);
  });

  test("parses a team whose nested players omit teamId", () => {
    const team = RawClashTeamSchema.parse({
      id: "team-1",
      tournamentId: 42,
      name: "Glivengers",
      iconId: 1,
      tier: 4,
      captain: "summoner-1",
      abbreviation: "GLIV",
      players: [
        {
          puuid: "abc",
          position: "TOP",
          role: "CAPTAIN",
        },
      ],
    });
    expect(team.players[0]?.teamId).toBeUndefined();
    expect(team.players[0]?.role).toBe("CAPTAIN");
  });
});
