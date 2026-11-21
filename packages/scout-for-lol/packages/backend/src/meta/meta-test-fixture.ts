import { assembleMetaServing } from "#src/meta/meta-assemble.ts";
import type { RollupRow } from "#src/meta/meta-entries.ts";
import type { MetaReader } from "#src/meta/meta-reader.ts";
import { DEFAULT_META_THRESHOLDS } from "@scout-for-lol/data/meta/meta-serving.ts";

/**
 * A small hand-written meta for database-free route and tool tests: three
 * champions over two patches, assembled by the real roll-up assembly and read
 * through the real reader interface, with no lake or DuckDB.
 *
 * Aatrox (1) TOP 600 games 330 wins, Ahri (2) MIDDLE 500/300 and Annie (3)
 * MIDDLE 150/60 on patch 16.3 ranked solo, bracket all, 1000 matches; Ahri
 * also has 200 games on 16.2. Ahri has been banned 100 times and has 80 games
 * against Annie.
 */

function row(
  kind: RollupRow["kind"],
  championId: number,
  role: string,
  fields: Partial<RollupRow> & { games: number; wins: number },
): RollupRow {
  return {
    kind,
    patch: "16.3",
    queue_id: 420,
    bracket: "all",
    role,
    champion_id: championId,
    key1: "",
    key2: "",
    kind_total: fields.games,
    ...fields,
  };
}

export const FIXTURE_ROWS: readonly RollupRow[] = [
  row("matches", 0, "", { games: 1000, wins: 0 }),
  row("matches", 0, "", { patch: "16.2", games: 400, wins: 0 }),
  row("champion", 1, "TOP", { key1: "Aatrox", games: 600, wins: 330 }),
  row("champion", 2, "MIDDLE", { key1: "Ahri", games: 500, wins: 300 }),
  row("champion", 3, "MIDDLE", { key1: "Annie", games: 150, wins: 60 }),
  row("champion", 2, "MIDDLE", {
    patch: "16.2",
    key1: "Ahri",
    games: 200,
    wins: 100,
  }),
  // Below the slice floor: never served.
  row("champion", 4, "TOP", { key1: "Akali", games: 99, wins: 80 }),
  row("ban", 2, "", { games: 100, wins: 0 }),
  row("item", 2, "MIDDLE", { key1: "6655", games: 300, wins: 190 }),
  row("item", 2, "MIDDLE", { key1: "3020", games: 450, wins: 270 }),
  row("build_path", 2, "MIDDLE", {
    key1: "6655>3020>3089",
    games: 40,
    wins: 28,
    kind_total: 100,
  }),
  row("start_items", 2, "MIDDLE", {
    key1: "1056+2003x2",
    games: 60,
    wins: 36,
    kind_total: 100,
  }),
  row("rune", 2, "MIDDLE", {
    key1: "8100:8112,8126,8138,8135",
    key2: "8200:8226,8210",
    games: 400,
    wins: 250,
    kind_total: 500,
  }),
  row("spells", 2, "MIDDLE", {
    key1: "4,14",
    games: 480,
    wins: 290,
    kind_total: 500,
  }),
  row("skill_order", 2, "MIDDLE", {
    key1: "QEW",
    games: 80,
    wins: 50,
    kind_total: 100,
  }),
  row("trait_base", 2, "MIDDLE", {
    key2: "enemy_ap_heavy",
    games: 200,
    wins: 120,
  }),
  row("item_trait", 2, "MIDDLE", {
    key1: "3157",
    key2: "enemy_ap_heavy",
    games: 90,
    wins: 70,
  }),
  row("matchup", 2, "MIDDLE", { key1: "3", games: 80, wins: 50 }),
  row("matchup", 3, "MIDDLE", { key1: "2", games: 80, wins: 30 }),
];

export const FIXTURE_NOW = new Date("2026-11-14T03:00:00.000Z");

/** An in-memory reader over the fixture, serving exactly what the roll-up assembles. */
export function fixtureMetaReader(
  rows: readonly RollupRow[] = FIXTURE_ROWS,
): MetaReader {
  const serving = assembleMetaServing({
    rows,
    days: ["2026-11-12", "2026-11-13"],
    buildId: "fixture-build",
    now: FIXTURE_NOW,
    thresholds: DEFAULT_META_THRESHOLDS,
  });
  return {
    manifest: () => Promise.resolve(serving.manifest),
    tier: (relativePath) => Promise.resolve(serving.tiers.get(relativePath)),
    champion: (id) => Promise.resolve(serving.champions.get(id)),
    matchups: (id) => Promise.resolve(serving.matchups.get(id)),
  };
}

/** A reader for a lake that has never published meta. */
export const EMPTY_META_READER: MetaReader = {
  manifest: () => Promise.resolve(undefined),
  tier: () => Promise.resolve(undefined),
  champion: () => Promise.resolve(undefined),
  matchups: () => Promise.resolve(undefined),
};
