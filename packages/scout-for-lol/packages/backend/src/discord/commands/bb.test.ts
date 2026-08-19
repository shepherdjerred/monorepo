import { describe, expect, test } from "bun:test";
import { bucksTestRoster } from "#src/testing/bucks-fixtures.ts";
import {
  bbCommand,
  buildOpenMarketSections,
  formatGameSelectors,
  resolveOpenGameByAlias,
  trackedGameAliases,
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

  test("does not match a tracked alias whose participant was scrubbed", () => {
    const roster = bucksTestRoster().map((participant, index) =>
      index === 1
        ? { ...participant, puuid: null, trackedAlias: "scrubbed" }
        : participant,
    );
    expect(
      resolveOpenGameByAlias(
        [
          {
            matchId: "NA1_scrubbed",
            roster: JSON.stringify({ participants: roster }),
          },
        ],
        "scrubbed",
      ),
    ).toBeUndefined();
  });

  test("refuses to choose arbitrarily when an alias matches multiple pools", () => {
    expect(() =>
      resolveOpenGameByAlias([pool("NA1_1"), pool("NA1_2")], "jerred"),
    ).toThrow("matched 2 open Bryan Bucks pools");
  });

  test("formats every suggested game alias as a copyable selector", () => {
    expect(formatGameSelectors(["jerred", "bryan"])).toEqual([
      "game: `jerred`",
      "game: `bryan`",
    ]);
  });

  test("suggests only aliases accepted by the game selector", () => {
    expect(trackedGameAliases(bucksTestRoster())).toEqual(["jerred", "bryan"]);
  });

  test("shows every open-game alias with its Blue or Red team", () => {
    const sections = buildOpenMarketSections([
      {
        matchId: "NA1_open",
        closesAt: new Date("2030-01-01T00:10:00Z"),
        blue: {
          trackedPlayers: ["jerred", "friend"],
          totalStake: 6,
          betCount: 2,
        },
        red: { trackedPlayers: ["bryan"], totalStake: 5, betCount: 1 },
      },
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain(
      "🔵 **Blue Team:** 6 BB across 2 bet(s) — game: `jerred`, game: `friend`",
    );
    expect(sections[0]).toContain(
      "🔴 **Red Team:** 5 BB across 1 bet(s) — game: `bryan`",
    );
  });
});
