import { describe, expect, test } from "vitest";
import type { SnapshotChampion } from "#src/lib/champion-meta/snapshot-v2-schema.ts";
import { matchupsModel } from "./matchups.ts";

type Opponent = SnapshotChampion["matchups"][number]["opponents"][number];

function rate(value: number, spread = 0.04) {
  return { value, lower: value - spread, upper: value + spread };
}

function opponent(
  id: number,
  name: string,
  winRate: number,
  extra: Partial<Opponent> = {},
): Opponent {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    games: 200,
    wins: Math.round(200 * winRate),
    winRate: rate(winRate),
    ...extra,
  };
}

function lane(aheadRate: number, games = 40): Opponent["lane"] {
  return {
    games,
    ahead: Math.round(games * aheadRate),
    aheadRate: rate(aheadRate),
    share: rate(0.2),
    denominator: "matchup_games",
  };
}

describe("matchupsModel", () => {
  test("splits opponents by the side of 50% they are on", () => {
    const model = matchupsModel([
      opponent(1, "Yasuo", 0.54),
      opponent(2, "Syndra", 0.47),
      opponent(3, "Even", 0.5),
    ]);
    expect(model.wellAgainst.map((row) => row.name)).toEqual(["Yasuo"]);
    expect(model.hardAgainst.map((row) => row.name)).toEqual(["Syndra"]);
  });

  test("ranks on the edge of the interval nearest even, so a thin sample does not lead", () => {
    const thin = opponent(1, "Thin", 0.6, {
      winRate: { value: 0.6, lower: 0.46, upper: 0.74 },
    });
    const solid = opponent(2, "Solid", 0.55);
    expect(
      matchupsModel([thin, solid]).wellAgainst.map((row) => row.name),
    ).toEqual(["Solid", "Thin"]);
  });

  test("lists at most three a side", () => {
    const many = [1, 2, 3, 4, 5].map((id) =>
      opponent(id, `Champ${id.toString()}`, 0.5 + id * 0.01),
    );
    expect(matchupsModel(many).wellAgainst).toHaveLength(3);
  });

  test("notes a lane won with the game lost, and the reverse, only when both clear 50%", () => {
    const model = matchupsModel([
      opponent(1, "Garen", 0.489, { lane: lane(0.552) }),
      opponent(2, "Zed", 0.46, { lane: lane(0.44) }),
      opponent(3, "Orianna", 0.529, { lane: lane(0.45) }),
    ]);
    expect(model.hardAgainst.find((row) => row.name === "Garen")?.note).toBe(
      "Wins lane, loses the game",
    );
    expect(
      model.hardAgainst.find((row) => row.name === "Zed")?.note,
    ).toBeNull();
    expect(model.wellAgainst.find((row) => row.name === "Orianna")?.note).toBe(
      "Loses lane, wins the game",
    );
  });

  test("an opponent without lane data has no lane figure", () => {
    const [row] = matchupsModel([opponent(1, "Yasuo", 0.54)]).wellAgainst;
    expect(row?.lane).toBeNull();
    expect(row?.note).toBeNull();
  });

  test("percent figures are on the 0 to 100 scale", () => {
    const [row] = matchupsModel([
      opponent(1, "Yasuo", 0.542, { lane: lane(0.568, 230) }),
    ]).wellAgainst;
    expect(row?.winRate).toBeCloseTo(54.2);
    expect(row?.lane).toEqual({ aheadRate: expect.closeTo(56.8), games: 230 });
  });
});
