import { describe, expect, test } from "vitest";
import {
  ChampionMetaFileSchema,
  MatchupFileSchema,
  MetaManifestSchema,
} from "@scout-for-lol/data/meta/meta-serving.ts";
import {
  assembleMetaServing,
  comparePatches,
  gradeForLowerBound,
} from "#src/meta/meta-assemble.ts";
import {
  FIXTURE_LANE_DAYS,
  FIXTURE_NOW,
  FIXTURE_ROWS,
  fixtureMetaReader,
} from "#src/meta/meta-test-fixture.ts";
import { DEFAULT_META_THRESHOLDS } from "@scout-for-lol/data/meta/meta-serving.ts";
import { wilsonInterval } from "#src/meta/wilson.ts";

const serving = assembleMetaServing({
  rows: FIXTURE_ROWS,
  days: ["2026-11-12", "2026-11-13"],
  laneDays: FIXTURE_LANE_DAYS,
  buildId: "b1",
  now: FIXTURE_NOW,
  thresholds: DEFAULT_META_THRESHOLDS,
});

describe("assembleMetaServing", () => {
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
    expect(slice?.coreItems.map((item) => item.itemId)).toEqual([
      3020, 6655, 3089, 4645, 3157,
    ]);
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
});

describe("assembleMetaServing slice detail and matchups", () => {
  test("serves game length, boots, keystones and single spells with counts and intervals", () => {
    const slice = serving.champions
      .get(2)
      ?.slices.find((one) => one.context.patch === "16.3");
    expect(slice?.durations?.map((entry) => entry.bucket)).toEqual([
      "lt25",
      "25to35",
      "gt35",
    ]);
    expect(slice?.durations?.[0]).toEqual({
      bucket: "lt25",
      games: 90,
      wins: 60,
      winRate: wilsonInterval(60, 90),
      share: wilsonInterval(90, 500),
      denominator: "games_with_duration",
    });
    expect(slice?.boots?.map((entry) => entry.itemId)).toEqual([3020, 3158]);
    expect(slice?.boots?.[0]).toMatchObject({
      games: 450,
      wins: 270,
      winRate: wilsonInterval(270, 450),
      share: wilsonInterval(450, 490),
      denominator: "games_with_boots",
    });
    expect(slice?.keystones?.[0]).toMatchObject({
      perkId: 8112,
      games: 400,
      share: wilsonInterval(400, 500),
    });
    expect(slice?.singleSpells?.map((entry) => entry.spellId)).toEqual([4, 14]);
    expect(slice?.singleSpells?.[0]?.share).toEqual(wilsonInterval(490, 500));
  });

  test("items after the core drop the top build path and the boots", () => {
    const slice = serving.champions
      .get(2)
      ?.slices.find((one) => one.context.patch === "16.3");
    // 6655, 3020 and 3089 are the top build path; 3020 is also boots.
    expect(slice?.itemsAfterCore?.map((item) => item.itemId)).toEqual([
      4645, 3157,
    ]);
    expect(slice?.itemsAfterCore?.[0]).toMatchObject({
      games: 160,
      wins: 90,
      winRate: wilsonInterval(90, 160),
      share: wilsonInterval(160, 500),
      denominator: "slice_games",
    });
  });

  test("a slice with no build path serves no items after the core", () => {
    const rows = FIXTURE_ROWS.filter((row) => row.kind !== "build_path");
    const slice = assembleMetaServing({
      rows,
      days: ["2026-11-13"],
      laneDays: [],
      buildId: "b2",
      now: FIXTURE_NOW,
      thresholds: DEFAULT_META_THRESHOLDS,
    })
      .champions.get(2)
      ?.slices.find((one) => one.context.patch === "16.3");
    expect(slice?.itemsAfterCore).toEqual([]);
  });

  test("a slice without the new partials serves empty lists", () => {
    const withheld = new Set([
      "duration",
      "boots",
      "keystone",
      "spell_single",
      "matchup_spell",
    ]);
    const files = assembleMetaServing({
      rows: FIXTURE_ROWS.filter((row) => !withheld.has(row.kind)),
      days: ["2026-11-13"],
      laneDays: [],
      buildId: "b3",
      now: FIXTURE_NOW,
      thresholds: DEFAULT_META_THRESHOLDS,
    });
    const slice = files.champions
      .get(2)
      ?.slices.find((one) => one.context.patch === "16.3");
    expect(slice).toMatchObject({
      durations: [],
      boots: [],
      keystones: [],
      singleSpells: [],
    });
    expect(files.matchups.get(2)?.slices[0]?.opponents[0]?.spells).toEqual([]);
  });

  test("files written before the additive fields existed still parse", () => {
    const champion = serving.champions.get(2);
    const {
      durations: _durations,
      boots: _boots,
      keystones: _keystones,
      singleSpells: _singleSpells,
      itemsAfterCore: _itemsAfterCore,
      ...legacySlice
    } = champion?.slices[0] ?? {};
    const legacyChampion = ChampionMetaFileSchema.parse({
      ...champion,
      slices: [legacySlice],
    });
    expect(legacyChampion.slices[0]?.durations).toBeUndefined();
    const matchup = serving.matchups.get(2);
    const legacyMatchup = MatchupFileSchema.parse({
      ...matchup,
      slices: [
        {
          ...matchup?.slices[0],
          opponents: [
            {
              championId: 3,
              championName: "Annie",
              games: 80,
              wins: 50,
              winRate: wilsonInterval(50, 80),
            },
          ],
        },
      ],
    });
    expect(legacyMatchup.slices[0]?.opponents[0]?.spells).toBeUndefined();
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

  test("matchups carry the spell pairs played in them, each with games, wins and its interval", () => {
    const [annie] = serving.matchups.get(2)?.slices[0]?.opponents ?? [];
    expect(annie?.spells).toEqual([
      {
        spellIds: [4, 14],
        games: 50,
        wins: 34,
        winRate: wilsonInterval(34, 50),
        share: wilsonInterval(50, 80),
        denominator: "matchup_games",
      },
      {
        spellIds: [4, 12],
        games: 30,
        wins: 16,
        winRate: wilsonInterval(16, 30),
        share: wilsonInterval(30, 80),
        denominator: "matchup_games",
      },
    ]);
    // Annie's matchup has no spell partials, so none are served for it.
    expect(serving.matchups.get(3)?.slices[0]?.opponents[0]?.spells).toEqual(
      [],
    );
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

describe("assembleMetaServing lane figures", () => {
  test("serves lane figures with their game counts, intervals and the lane window", () => {
    const slice = serving.champions
      .get(2)
      ?.slices.find((one) => one.context.patch === "16.3");
    expect(slice?.lane).toEqual({
      games: 120,
      ahead: 66,
      aheadRate: wilsonInterval(66, 120),
      share: wilsonInterval(120, 500),
      denominator: "slice_games",
    });
    expect(serving.matchups.get(2)?.slices[0]?.opponents[0]?.lane).toEqual({
      games: 36,
      ahead: 24,
      aheadRate: wilsonInterval(24, 36),
      share: wilsonInterval(36, 80),
      denominator: "matchup_games",
    });
    // The 16.2 slice and Annie's side of the matchup have no lane rows.
    expect(
      serving.champions
        .get(2)
        ?.slices.find((one) => one.context.patch === "16.2")?.lane,
    ).toBeUndefined();
    expect(
      serving.matchups.get(3)?.slices[0]?.opponents[0]?.lane,
    ).toBeUndefined();
    expect(serving.manifest.lane).toEqual({
      firstDay: "2026-11-13",
      lastDay: "2026-11-13",
      days: 1,
    });
  });

  test("a lane matchup row under an unlisted matchup is not served", () => {
    const rows = FIXTURE_ROWS.filter(
      (row) => !(row.kind === "matchup" && row.champion_id === 2),
    );
    const files = assembleMetaServing({
      rows,
      days: ["2026-11-13"],
      laneDays: FIXTURE_LANE_DAYS,
      buildId: "b4",
      now: FIXTURE_NOW,
      thresholds: DEFAULT_META_THRESHOLDS,
    });
    expect(files.matchups.get(2)).toBeUndefined();
  });

  test("a v1 file written before lane figures still parses", () => {
    const champion = serving.champions.get(1);
    expect(champion?.slices[0]?.lane).toBeUndefined();
    expect(ChampionMetaFileSchema.parse(champion)).toEqual(champion);
    const manifest = { ...serving.manifest, lane: undefined };
    expect(MetaManifestSchema.parse(manifest).lane).toBeUndefined();
  });
});

describe("comparePatches", () => {
  test("orders as numbers, not text", () => {
    expect(comparePatches("15.10", "15.9")).toBeGreaterThan(0);
    expect(comparePatches("16.1", "15.24")).toBeGreaterThan(0);
    expect(comparePatches("16.3", "16.3")).toBe(0);
  });
});
