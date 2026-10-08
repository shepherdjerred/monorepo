import { describe, expect, test } from "vitest";
import {
  LcuClashBracketSchema,
  LcuClashRosterSchema,
} from "@scout-for-lol/data";
import {
  currentClientClashOpponent,
  projectClientClashTeam,
} from "./client-clash.ts";

const CAPTURED_AT = new Date("2026-10-10T20:00:00Z");
const OURS = "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e";

const roster = LcuClashRosterSchema.parse({
  id: OURS,
  tournamentId: 3021,
  name: "Baron Hunters",
  shortName: "BH",
  tier: 3,
  bracketId: 18_276,
  members: [{ puuid: "p1", position: "TOP" }, { summonerId: 7 }],
});

const bracket = LcuClashBracketSchema.parse({
  id: 18_276,
  rosters: [
    { rosterId: OURS, name: "Baron Hunters" },
    { rosterId: "r2", name: "Dragon Pit" },
    { rosterId: "r3", shortName: "ELD" },
  ],
  matches: [
    { roundId: 2, rosterId1: "r3", rosterId2: OURS },
    { roundId: 1, rosterId1: OURS, rosterId2: "r2", winnerId: OURS },
    { roundId: 1, rosterId1: "r3", rosterId2: "r4", winnerId: "r3" },
  ],
});

describe("a Clash roster the Scout Client saw", () => {
  test("projects its bracket from its own side, in round order", () => {
    const team = projectClientClashTeam({
      roster,
      bracket,
      capturedAt: CAPTURED_AT,
    });
    expect(team).toEqual({
      rosterId: OURS,
      tournamentId: "3021",
      name: "Baron Hunters",
      abbreviation: "BH",
      tier: 3,
      memberPuuids: ["p1"],
      matches: [
        {
          round: 1,
          opponent: { name: "Dragon Pit", abbreviation: "Dragon Pit" },
          result: "won",
        },
        {
          round: 2,
          opponent: { name: "ELD", abbreviation: "ELD" },
          result: "pending",
        },
      ],
      capturedAt: CAPTURED_AT,
    });
    expect(team === null ? null : currentClientClashOpponent(team)).toEqual({
      name: "ELD",
      abbreviation: "ELD",
    });
  });

  test("reads a loss, a bye, and a roster with no bracket yet", () => {
    const lost = projectClientClashTeam({
      roster,
      bracket: LcuClashBracketSchema.parse({
        matches: [
          { roundId: 1, rosterId1: OURS, rosterId2: "r2", winnerId: "r2" },
          { roundId: 2, rosterId1: OURS },
        ],
      }),
      capturedAt: CAPTURED_AT,
    });
    expect(lost?.matches).toEqual([
      { round: 1, opponent: null, result: "lost" },
      { round: 2, opponent: null, result: "pending" },
    ]);
    expect(
      projectClientClashTeam({ roster, bracket: null, capturedAt: CAPTURED_AT })
        ?.matches,
    ).toEqual([]);
  });

  test("names a roster by whichever label it has, and drops one with none", () => {
    expect(
      projectClientClashTeam({
        roster: LcuClashRosterSchema.parse({ id: OURS, shortName: "BH" }),
        bracket: null,
        capturedAt: CAPTURED_AT,
      }),
    ).toMatchObject({ name: "BH", abbreviation: "BH" });
    expect(
      projectClientClashTeam({
        roster: LcuClashRosterSchema.parse({ id: OURS, name: "  " }),
        bracket: null,
        capturedAt: CAPTURED_AT,
      }),
    ).toBeNull();
    expect(
      projectClientClashTeam({
        roster: LcuClashRosterSchema.parse({ name: "No id" }),
        bracket: null,
        capturedAt: CAPTURED_AT,
      }),
    ).toBeNull();
  });
});
