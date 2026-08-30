import { describe, expect, test } from "vitest";
import type { CustomGameParticipant } from "@scout-for-lol/data";
import { nextCustomGameParticipants } from "#src/customs/intermission-service.ts";

function participant(index: number): CustomGameParticipant {
  const team = index < 5 ? "A" : "B";
  return {
    discordId: index.toString(),
    displayName: `Player ${index.toString()}`,
    playerId: index + 1,
    playerAlias: `p${index.toString()}`,
    accountId: index + 1,
    puuid: `puuid-${index.toString()}`,
    riotGameName: null,
    riotTagLine: null,
    rosterOrder: index,
    benchOrder: null,
    team,
    side: team === "A" ? "BLUE" : "RED",
    captain: index === 0 || index === 5,
    pickOrder: index === 0 || index === 5 ? null : index,
    championId: 1,
    won: team === "A",
  };
}

const completed = Array.from({ length: 10 }, (_, index) => participant(index));

function expectNewCaptains(next: readonly CustomGameParticipant[]): void {
  const newCaptains = next.filter((player) => player.captain);
  expect(newCaptains).toHaveLength(2);
  expect(newCaptains.some((player) => player.discordId === "0")).toBe(false);
  expect(newCaptains.some((player) => player.discordId === "5")).toBe(false);
}

describe("custom-night intermission choices", () => {
  test("keeps teams and captains", () => {
    const next = nextCustomGameParticipants(
      completed,
      "KEEP_TEAMS_AND_CAPTAINS",
      () => 0,
    );
    expect(
      next.map(({ discordId, team, captain }) => ({
        discordId,
        team,
        captain,
      })),
    ).toEqual(
      completed.map(({ discordId, team, captain }) => ({
        discordId,
        team,
        captain,
      })),
    );
    expect(
      next.every((player) => player.championId === null && player.won === null),
    ).toBe(true);
  });

  test("keeps teams while selecting new captains", () => {
    const next = nextCustomGameParticipants(
      completed,
      "KEEP_TEAMS_REROLL_CAPTAINS",
      () => 0,
    );
    expectNewCaptains(next);
    const newCaptains = next.filter((player) => player.captain);
    expect(new Set(newCaptains.map((player) => player.team))).toEqual(
      new Set(["A", "B"]),
    );
    expect(next.map((player) => player.team)).toEqual(
      completed.map((player) => player.team),
    );
  });

  test("redrafts around the same captains", () => {
    const next = nextCustomGameParticipants(
      completed,
      "REDRAFT_SAME_CAPTAINS",
      () => 0,
    );
    expect(
      next.filter((player) => player.captain).map((player) => player.discordId),
    ).toEqual(["0", "5"]);
    expect(
      next
        .filter((player) => !player.captain)
        .every((player) => player.team === null),
    ).toBe(true);
  });

  test("redrafts around new captains", () => {
    const next = nextCustomGameParticipants(
      completed,
      "REDRAFT_NEW_CAPTAINS",
      () => 0,
    );
    expectNewCaptains(next);
    expect(
      next
        .filter((player) => !player.captain)
        .every((player) => player.team === null),
    ).toBe(true);
  });
});
