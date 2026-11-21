import { describe, expect, test } from "vitest";
import {
  assembleMetaServing,
  comparePatches,
  gradeForLowerBound,
} from "#src/meta/meta-assemble.ts";
import {
  FIXTURE_NOW,
  FIXTURE_ROWS,
  fixtureMetaReader,
} from "#src/meta/meta-test-fixture.ts";
import { DEFAULT_META_THRESHOLDS } from "@scout-for-lol/data/meta/meta-serving.ts";
import { wilsonInterval } from "#src/meta/wilson.ts";

describe("assembleMetaServing", () => {
  const serving = assembleMetaServing({
    rows: FIXTURE_ROWS,
    days: ["2026-11-12", "2026-11-13"],
    buildId: "b1",
    now: FIXTURE_NOW,
    thresholds: DEFAULT_META_THRESHOLDS,
  });

  test("serves only slices at or above the sample floor", () => {
    expect(serving.manifest.champions).toEqual([
      { id: 1, name: "Aatrox" },
      { id: 2, name: "Ahri" },
      { id: 3, name: "Annie" },
    ]);
    // Akali has 99 games: below the 100-game floor.
    expect(serving.champions.has(4)).toBe(false);
  });

  test("grades on the Wilson lower bound, not the point estimate", () => {
    const tiers = [...serving.tiers.values()].find(
      (file) => file.context.patch === "16.3",
    );
    expect(
      tiers?.entries.map((entry) => [entry.championName, entry.tier]),
    ).toEqual([
      ["Ahri", "S"],
      ["Aatrox", "A"],
      ["Annie", "D"],
    ]);
    // 80% over five games is S on its point estimate, D on its interval.
    expect(gradeForLowerBound(wilsonInterval(4, 5).lower)).toBe("D");
    expect(gradeForLowerBound(0.52)).toBe("S");
    expect(gradeForLowerBound(0.519)).toBe("A");
    expect(gradeForLowerBound(0.46)).toBe("C");
    expect(gradeForLowerBound(0.1)).toBe("D");
  });

  test("states sample, patch, queue and bracket on every slice and tier file", () => {
    const ahri = serving.champions.get(2);
    const slice = ahri?.slices.find((one) => one.context.patch === "16.3");
    expect(slice?.context).toEqual({
      patch: "16.3",
      queueId: 420,
      queue: "ranked_solo",
      bracket: "all",
      role: "MIDDLE",
    });
    expect(slice?.sample).toEqual({ games: 500, matches: 1000 });
    expect(slice?.winRate).toEqual(wilsonInterval(300, 500));
    expect(slice?.pickRate).toEqual(wilsonInterval(500, 1000));
    expect(slice?.banRate).toEqual(wilsonInterval(100, 1000));
    for (const file of serving.tiers.values()) {
      expect(file.sample.matches).toBeGreaterThan(0);
      expect(file.context.patch).toMatch(/^\d+\.\d+$/u);
    }
  });

  test("builds, runes, spells, skills and starting items carry their own denominators", () => {
    const slice = serving.champions
      .get(2)
      ?.slices.find((one) => one.context.patch === "16.3");
    expect(slice?.coreItems.map((item) => item.itemId)).toEqual([3020, 6655]);
    expect(slice?.coreItems[0]?.share).toEqual(wilsonInterval(450, 500));
    expect(slice?.buildPaths[0]).toMatchObject({
      itemIds: [6655, 3020, 3089],
      denominator: "games_with_timeline",
    });
    expect(slice?.buildPaths[0]?.share).toEqual(wilsonInterval(40, 100));
    expect(slice?.startingItems[0]?.items).toEqual([
      { itemId: 1056, count: 1 },
      { itemId: 2003, count: 2 },
    ]);
    expect(slice?.runes[0]).toMatchObject({
      primaryStyleId: 8100,
      primaryPerkIds: [8112, 8126, 8138, 8135],
      secondaryStyleId: 8200,
      secondaryPerkIds: [8226, 8210],
    });
    expect(slice?.spells[0]?.spellIds).toEqual([4, 14]);
    expect(slice?.skillOrders[0]?.order).toBe("QEW");
  });

  test("item lift is the item's win rate against a trait minus the baseline, with significance", () => {
    const slice = serving.champions
      .get(2)
      ?.slices.find((one) => one.context.patch === "16.3");
    const [lift] = slice?.itemLift ?? [];
    expect(lift?.trait).toBe("enemy_ap_heavy");
    expect(lift?.baseline).toMatchObject({ games: 200, wins: 120 });
    const item = lift?.items[0];
    expect(item?.itemId).toBe(3157);
    expect(item?.lift).toBeCloseTo(70 / 90 - 0.6, 10);
    expect(item?.significant).toBe(true);
  });

  test("matchups list opponents per slice and role", () => {
    const file = serving.matchups.get(2);
    expect(file?.slices).toHaveLength(1);
    expect(file?.slices[0]?.opponents).toEqual([
      expect.objectContaining({
        championId: 3,
        championName: "Annie",
        games: 80,
        wins: 50,
        winRate: wilsonInterval(50, 80),
      }),
    ]);
  });

  test("defaults to the newest patch, ranked solo, all brackets", () => {
    expect(serving.manifest.defaults).toEqual({
      patch: "16.3",
      queueId: 420,
      bracket: "all",
    });
    expect(serving.manifest.patches).toEqual(["16.3", "16.2"]);
  });

  test("a stricter floor leaves nothing to serve and no default", async () => {
    const reader = fixtureMetaReader(
      FIXTURE_ROWS.filter((row) => row.kind === "matches"),
    );
    const manifest = await reader.manifest();
    expect(manifest?.defaults).toBeNull();
  });
});

describe("comparePatches", () => {
  test("orders as numbers, not text", () => {
    expect(comparePatches("15.10", "15.9")).toBeGreaterThan(0);
    expect(comparePatches("16.1", "15.24")).toBeGreaterThan(0);
    expect(comparePatches("16.3", "16.3")).toBe(0);
  });
});
