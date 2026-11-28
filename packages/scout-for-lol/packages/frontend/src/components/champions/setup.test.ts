import path from "node:path";
import { describe, expect, test } from "vitest";
import { openSnapshot } from "#src/lib/champion-meta/snapshot-v2-load.ts";
import { countedName, otherOptions, setupRows } from "./setup.ts";
import { laterModel } from "./later.ts";

const FIXTURE_INDEX = path.resolve(
  import.meta.dirname,
  "../../lib/champion-meta/__fixtures__/snapshot-v2/champion-meta/index.json",
);

async function ahriMid() {
  const snapshot = await openSnapshot(FIXTURE_INDEX);
  const champion = await snapshot.champion("ahri");
  const slice = champion.slices.find(
    (entry) => entry.context.role === "MIDDLE",
  );
  if (slice === undefined) throw new Error("fixture Ahri has a mid slice");
  return { champion, slice };
}

describe("countedName", () => {
  test("puts the count in front and pluralises", () => {
    expect(countedName("Health Potion", 2)).toBe("2 Health Potions");
    expect(countedName("Doran's Ring", 1)).toBe("Doran's Ring");
  });
});

describe("setupRows", () => {
  test("lists runes, spells, starting items, skill order and build", async () => {
    const { champion, slice } = await ahriMid();
    const rows = setupRows(champion.id, slice);
    expect(rows.map((row) => row.title)).toEqual([
      "Runes",
      "Summoner spells",
      "Starting items",
      "Skill order",
      "Core build",
    ]);
  });

  test("the rune row marks the keystone and breaks between trees", async () => {
    const { champion, slice } = await ahriMid();
    const [runes] = setupRows(champion.id, slice);
    expect(runes?.items.map((item) => item.label)).toEqual([
      "Electrocute",
      "Cheap Shot",
      "Sixth Sense",
      "Ultimate Hunter",
      "Manaflow Band",
      "Transcendence",
    ]);
    expect(runes?.items.map((item) => item.keystone === true)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(runes?.items[3]?.breakAfter).toBe(true);
    expect(runes?.note).toBe("Domination, with Sorcery second");
  });

  test("the skill order reads in the order it is maxed, with ability icons", async () => {
    const { champion, slice } = await ahriMid();
    const skills = setupRows(champion.id, slice).find(
      (row) => row.title === "Skill order",
    );
    expect(skills?.sequence).toBe(true);
    expect(skills?.items.map((item) => item.label)).toEqual([
      "Q first",
      "then W",
      "then E",
    ]);
    expect(skills?.items.map((item) => item.asset.key)).toEqual([
      "Ahri-Q",
      "Ahri-W",
      "Ahri-E",
    ]);
  });

  test("every proof is the entry's own win rate and games, in percent", async () => {
    const { champion, slice } = await ahriMid();
    const [runes] = setupRows(champion.id, slice);
    const [page] = slice.runes.toSorted((a, b) => b.games - a.games);
    expect(runes?.proof.games).toBe(page?.games);
    expect(runes?.proof.winRate).toBeCloseTo((page?.winRate.value ?? 0) * 100);
  });

  test("a slice with nothing in a step has no row for it", async () => {
    const { champion, slice } = await ahriMid();
    const rows = setupRows(champion.id, { ...slice, spells: [], runes: [] });
    expect(rows.map((row) => row.title)).toEqual([
      "Starting items",
      "Skill order",
      "Core build",
    ]);
  });
});

describe("otherOptions", () => {
  test("lists the next most played of each setup, not the first", async () => {
    const { slice } = await ahriMid();
    const folds = otherOptions(slice);
    expect(folds.map((fold) => fold.summary)).toEqual([
      "Other rune pages",
      "Other spells",
      "Other starting items",
      "Other skill orders",
      "Other builds",
    ]);
    const spells = folds.find((fold) => fold.summary === "Other spells");
    expect(spells?.entries.map((entry) => entry.text)).toEqual([
      "Flash and Teleport",
      "Flash and Exhaust",
    ]);
    const skills = folds.find((fold) => fold.summary === "Other skill orders");
    expect(skills?.entries[0]?.text).toBe("Q, then E, then W");
  });

  test("a setup with one entry has no fold", async () => {
    const { slice } = await ahriMid();
    const folds = otherOptions({
      ...slice,
      runes: slice.runes.slice(0, 1),
      spells: slice.spells.slice(0, 1),
    });
    expect(folds.map((fold) => fold.summary)).not.toContain("Other spells");
    expect(folds.map((fold) => fold.summary)).not.toContain("Other rune pages");
  });
});

describe("laterModel", () => {
  test("states a headline only when the interval gap is clear", async () => {
    const { slice } = await ahriMid();
    expect(laterModel(slice).headline).toBe("Better in shorter games");
    const unclear = {
      ...slice,
      durations: slice.durations?.map((entry) => ({
        ...entry,
        winRate: { value: 0.5, lower: 0.45, upper: 0.55 },
      })),
    };
    expect(laterModel(unclear).headline).toBeNull();
  });

  test("lists game lengths in order and leaves out figures not served", async () => {
    const { slice } = await ahriMid();
    expect(laterModel(slice).lengths.map((row) => row.label)).toEqual([
      "Under 25 minutes",
      "25 to 35 minutes",
      "Over 35 minutes",
    ]);
    const bare = laterModel({
      ...slice,
      durations: undefined,
      itemsAfterCore: undefined,
      boots: undefined,
    });
    expect(bare.lengths).toEqual([]);
    expect(bare.afterCore).toEqual([]);
    expect(bare.boots).toBeNull();
    expect(bare.headline).toBeNull();
  });

  test("names the most bought boots with the games behind them", async () => {
    const { slice } = await ahriMid();
    const { boots } = laterModel(slice);
    expect(boots?.label).toBe("Sorcerer's Shoes");
    expect(boots?.games).toBe(
      Math.max(...(slice.boots ?? []).map((entry) => entry.games)),
    );
  });
});
