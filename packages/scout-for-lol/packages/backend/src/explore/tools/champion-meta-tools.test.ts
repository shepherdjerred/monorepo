import { describe, expect, test } from "vitest";
import {
  createChampionMetaTools,
  listChampionTiersText,
  lookupChampionMetaText,
} from "#src/explore/tools/champion-meta-tools.ts";
import {
  EMPTY_META_READER,
  fixtureMetaReader,
} from "#src/meta/meta-test-fixture.ts";

/** Tool text over the in-memory meta: no lake, DuckDB or database. */

const reader = fixtureMetaReader();

describe("lookup_champion_meta", () => {
  test("names the sample, patch, queue and bracket, with intervals", async () => {
    const text = await lookupChampionMetaText(reader, { champion: "Ahri" });
    expect(text).toContain("Ahri — patch 16.3, ranked_solo, bracket all");
    expect(text).toContain("from 500 games of 1000 matches");
    expect(text).toContain("tier S");
    expect(text).toContain("95% interval 55.6-64.2%");
    expect(text).toContain("QEW");
    expect(text).toContain("vs enemy_ap_heavy");
  });

  test("resolves a champion by id or by loosely typed name", async () => {
    const byId = await lookupChampionMetaText(reader, { champion: "2" });
    const byName = await lookupChampionMetaText(reader, { champion: "AHRI" });
    expect(byId).toBe(byName);
  });

  test("honours patch and role selection", async () => {
    const text = await lookupChampionMetaText(reader, {
      champion: "Ahri",
      patch: "16.2",
      role: "MIDDLE",
    });
    expect(text).toContain("patch 16.2");
    expect(text).toContain("from 200 games of 400 matches");
  });

  test("answers a matchup with its games", async () => {
    const text = await lookupChampionMetaText(reader, {
      champion: "Ahri",
      opponent: "Annie",
    });
    expect(text).toContain("Ahri against Annie");
    expect(text).toContain("from 80 games");
  });

  test("says what is missing instead of guessing", async () => {
    expect(
      await lookupChampionMetaText(reader, { champion: "Nobody" }),
    ).toContain("unknown_champion");
    expect(
      await lookupChampionMetaText(reader, {
        champion: "Aatrox",
        opponent: "Ahri",
      }),
    ).toContain("matchup_not_found");
    expect(
      await lookupChampionMetaText(reader, {
        champion: "Ahri",
        bracket: "gold",
      }),
    ).toContain("invalid_selection");
    expect(
      await lookupChampionMetaText(EMPTY_META_READER, { champion: "Ahri" }),
    ).toContain("meta_unavailable");
  });
});

describe("list_champion_tiers", () => {
  test("lists graded champions with their sample", async () => {
    const text = await listChampionTiersText(reader, {});
    expect(text).toContain(
      "patch 16.3, ranked_solo, bracket all, from 1000 matches",
    );
    const lines = text.split("\n");
    expect(lines[1]).toMatch(/^S Ahri MIDDLE: 500 games/u);
    expect(lines[2]).toMatch(/^A Aatrox TOP: 600 games/u);
    expect(lines[3]).toMatch(/^D Annie MIDDLE: 150 games/u);
  });

  test("filters by role and limits", async () => {
    const middle = await listChampionTiersText(reader, { role: "MIDDLE" });
    expect(middle).not.toContain("Aatrox");
    const one = await listChampionTiersText(reader, { limit: 1 });
    expect(one.split("\n")).toHaveLength(2);
  });

  test("reports a slice without data", async () => {
    expect(await listChampionTiersText(reader, { patch: "15.1" })).toContain(
      "slice_not_found",
    );
  });
});

describe("tool wiring", () => {
  test("registers both tools through the tracker, reading the serving JSON", async () => {
    const tracked: string[] = [];
    const tools = createChampionMetaTools({
      reader,
      track: async (name, work) => {
        tracked.push(name);
        return await work();
      },
    });
    expect(Object.keys(tools).toSorted()).toEqual([
      "list_champion_tiers",
      "lookup_champion_meta",
    ]);
    const output = await tools.list_champion_tiers.execute?.(
      {},
      { toolCallId: "t", messages: [], context: {} },
    );
    expect(output).toContain("Champion tiers");
    expect(tracked).toEqual(["list_champion_tiers"]);
  });
});
