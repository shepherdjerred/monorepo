import { describe, expect, test } from "bun:test";
import { bucksTestRoster } from "#src/testing/bucks-fixtures.ts";
import {
  bbCommand,
  resolveOpenGameByAlias,
  trackedGameLabels,
} from "#src/discord/commands/bb.ts";

function pool(matchId: string) {
  return {
    matchId,
    roster: JSON.stringify({ participants: bucksTestRoster() }),
  };
}

function fixturePuuidAt(index: number) {
  const puuid = bucksTestRoster()[index]?.puuid;
  if (puuid === undefined || puuid === null) {
    throw new Error(
      `expected a tracked-player fixture at index ${index.toString()}`,
    );
  }
  return puuid;
}

describe("/bb bet", () => {
  test("registers game, team, and amount as required options", () => {
    const command = bbCommand.toJSON();
    const bet = command.options?.find((option) => option.name === "bet");
    if (bet === undefined || !("options" in bet)) {
      throw new Error("expected the /bb bet subcommand");
    }

    expect(bet).toEqual(
      expect.objectContaining({
        type: 1,
        name: "bet",
        description: "Bet on Blue or Red; 20% win and cancellation house cuts",
      }),
    );
    expect(bet.options).toEqual([
      expect.objectContaining({
        name: "game",
        description: "A tracked player in the game",
        required: true,
      }),
      expect.objectContaining({
        name: "team",
        description: "The team to win",
        required: true,
        choices: [
          { name: "Blue", value: "blue" },
          { name: "Red", value: "red" },
        ],
      }),
      expect.objectContaining({
        name: "amount",
        required: true,
        min_value: 1,
        max_value: 1000,
      }),
    ]);
  });

  test("matches the game alias case-insensitively on either team", () => {
    const roster = bucksTestRoster();
    const pools = [
      {
        matchId: "NA1_blue-and-red",
        roster: JSON.stringify({ participants: roster }),
      },
    ];

    expect(resolveOpenGameByAlias(pools, "JERRED")).toEqual({
      matchId: "NA1_blue-and-red",
      subjectPuuid: fixturePuuidAt(0),
      subjectTeamId: 100,
    });
    expect(resolveOpenGameByAlias(pools, "BrYaN")).toEqual({
      matchId: "NA1_blue-and-red",
      subjectPuuid: fixturePuuidAt(5),
      subjectTeamId: 200,
    });
  });

  test("returns no game for an unknown alias", () => {
    expect(resolveOpenGameByAlias([pool("NA1_1")], "missing")).toBeUndefined();
  });

  test("refuses to choose arbitrarily when an alias matches multiple pools", () => {
    expect(() =>
      resolveOpenGameByAlias([pool("NA1_1"), pool("NA1_2")], "jerred"),
    ).toThrow("matched 2 open Bryan Bucks pools");
  });

  test("labels every tracked game anchor with its team", () => {
    expect(trackedGameLabels(bucksTestRoster())).toEqual([
      "jerred (Blue)",
      "bryan (Red)",
    ]);
  });
});
