import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { puuidHash } from "#src/league/crawl/crawl-config.ts";
import { encodeSegment } from "#src/league/crawl/crawl-segment.ts";
import { eraseCrawlMatchesInBuild } from "#src/report-lake/crawl/crawl-lake-erasure.ts";
import {
  compactCrawlDay,
  maintainCrawlTables,
  rebuildCrawlDay,
} from "#src/report-lake/crawl/crawl-maintenance.ts";
import {
  emptyCrawlManifest,
  writeCrawlManifest,
} from "#src/report-lake/crawl/crawl-manifest.ts";
import {
  BOOTS_ITEM_IDS,
  currentDayPartialFiles,
  hasAnyPartials,
  hasCurrentPartials,
  META_PARTIALS_TABLE,
  META_PARTIALS_VERSION,
  metaPartialsDayDir,
  writeDayPartials,
} from "#src/report-lake/crawl/meta-partials.ts";
import { items } from "@scout-for-lol/data/data-dragon/item.ts";
import { createLakeMetaReader } from "#src/meta/meta-reader.ts";
import { rollUpMeta } from "#src/meta/meta-rollup.ts";
import { wilsonInterval } from "#src/meta/wilson.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  crawlRecord,
  crawlSegment,
  distinctCrawlPuuid,
  memoryCrawlSegmentSource,
} from "#src/testing/report-lake/crawl-segments.ts";

/**
 * Daily partials and the roll-up against temp build directories and DuckDB
 * only. Every fixture match is the same real Summoner's Rift game under a
 * different match id, so N matches give each of its ten champions N games.
 */

const NOW = new Date("2026-11-14T03:00:00.000Z");
const DAY = "2026-11-13";
const OLD_DAY = "2026-09-20";
const NO_ERASURES = new Set<string>();
const SMALL = { minSliceGames: 1, minEntryGames: 1, minMatchupGames: 1 };

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "meta-pipeline-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function newBuild(id: string): Promise<string> {
  const dir = path.join(root, "builds", id);
  await mkdir(dir, { recursive: true });
  return dir;
}

const MatchShapeSchema = z.looseObject({
  info: z.looseObject({
    participants: z.array(z.looseObject({})),
  }),
});

/** A fixture match with its document edited, for queues and modes the crawl may still hold. */
async function variantSegment(
  day: string,
  matchId: string,
  edit: (info: Record<string, unknown>) => Record<string, unknown>,
) {
  const record = await crawlRecord(matchId);
  const match = MatchShapeSchema.parse(record.match);
  return encodeSegment({
    route: "na1",
    dt: day,
    records: [
      { ...record, match: { ...match, info: edit({ ...match.info }) } },
    ],
  });
}

/** Fold the segments into a build as one ingest day, compacted with partials. */
async function buildWithDay(
  id: string,
  day: string,
  segments: Awaited<ReturnType<typeof crawlSegment>>[],
  erased: ReadonlySet<string> = NO_ERASURES,
): Promise<string> {
  const buildDir = await newBuild(id);
  const manifest = emptyCrawlManifest();
  await rebuildCrawlDay({
    buildDir,
    buildId: `${id}-day`,
    day,
    manifest,
    segments: segments.map((segment) => ({ ...segment })),
    source: memoryCrawlSegmentSource(segments),
    erased,
  });
  await writeCrawlManifest(buildDir, manifest);
  await compactCrawlDay({ buildDir, buildId: `${id}-c`, day, erased });
  return buildDir;
}

const PartialRowSchema = z.object({
  kind: z.string(),
  champion_id: z.number(),
  role: z.string(),
  key1: z.string(),
  key2: z.string(),
  games: z.union([z.bigint(), z.number()]).transform(Number),
  wins: z.union([z.bigint(), z.number()]).transform(Number),
});

async function partialRows(buildDir: string, day = DAY) {
  const raw = await withDuckDBConnection(
    async (session) =>
      await session.run(
        `SELECT kind, champion_id, role, key1, key2, games, wins FROM read_parquet($1, hive_partitioning = false) ORDER BY ALL`,
        [
          session.list([
            ...new Bun.Glob(
              `${META_PARTIALS_TABLE}/ingest_day=${day}/*.parquet`,
            ).scanSync({ cwd: buildDir, absolute: true }),
          ]),
        ],
      ),
  );
  return raw.map((row) => PartialRowSchema.parse(row));
}

async function matchCount(buildDir: string): Promise<number | undefined> {
  const rows = await partialRows(buildDir);
  return rows.find((row) => row.kind === "matches")?.games;
}

async function rolledUp(id: string, matchIds: string[]) {
  const buildDir = await buildWithDay(id, DAY, [
    await crawlSegment(DAY, matchIds),
  ]);
  const summary = await rollUpMeta({
    buildDir,
    buildId: id,
    now: NOW,
    thresholds: SMALL,
  });
  return { buildDir, summary, meta: reader(buildDir) };
}

function reader(buildDir: string) {
  return createLakeMetaReader(() => Promise.resolve(buildDir));
}

describe("daily partials", () => {
  test("compaction derives partials for a completed day once, and counts each participant", async () => {
    const buildDir = await buildWithDay("1", DAY, [
      await crawlSegment(DAY, ["NA1_9700000001", "NA1_9700000002"]),
    ]);
    expect(await hasCurrentPartials(buildDir, DAY)).toBe(true);

    const rows = await partialRows(buildDir);
    expect(rows.find((row) => row.kind === "matches")?.games).toBe(2);
    const champions = rows.filter((row) => row.kind === "champion");
    expect(champions).toHaveLength(10);
    expect(champions.every((row) => row.games === 2)).toBe(true);
    expect(new Set(champions.map((row) => row.role))).toEqual(
      new Set(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]),
    );
    // Each champion has exactly one same-role opponent per match.
    const matchups = rows.filter((row) => row.kind === "matchup");
    expect(matchups).toHaveLength(10);
    expect(matchups.every((row) => row.games === 2)).toBe(true);
    // Wins on both sides of a matchup add up to the games played.
    for (const row of matchups) {
      const opposite = matchups.find(
        (other) => other.champion_id === Number(row.key1),
      );
      expect((opposite?.wins ?? -1) + row.wins).toBe(row.games);
    }
    expect(rows.some((row) => row.kind === "rune")).toBe(true);
    expect(rows.some((row) => row.kind === "spells")).toBe(true);
    expect(rows.some((row) => row.kind === "item")).toBe(true);
    expect(rows.some((row) => row.kind === "item_trait")).toBe(true);
    expect(rows.some((row) => row.kind === "trait_base")).toBe(true);

    const again = await compactCrawlDay({
      buildDir,
      buildId: "again",
      day: DAY,
      erased: NO_ERASURES,
    });
    expect(again).toEqual({
      compacted: false,
      erasedMatches: 0,
      partialsWritten: false,
    });
  });

  test("a day with no crawl matches has no partials", async () => {
    const buildDir = await newBuild("empty");
    expect(
      await writeDayPartials({ buildDir, buildId: "x", day: DAY }),
    ).toEqual({ rows: 0 });
    expect(await hasCurrentPartials(buildDir, DAY)).toBe(false);
  });

  test("excludes Arena, augment games and queues outside the crawl allowlist", async () => {
    const kept = await crawlSegment(DAY, ["NA1_9700000010"]);
    const arena = await variantSegment(DAY, "NA1_9700000011", (info) => ({
      ...info,
      queueId: 1700,
    }));
    const brawl = await variantSegment(DAY, "NA1_9700000012", (info) => ({
      ...info,
      queueId: 2300,
    }));
    const classic = await variantSegment(DAY, "NA1_9700000013", (info) => ({
      ...info,
      queueId: 4310,
    }));
    const augmented = await variantSegment(DAY, "NA1_9700000014", (info) => ({
      ...info,
      participants: MatchShapeSchema.shape.info
        .parse(info)
        .participants.map((participant) => ({
          ...participant,
          playerAugment1: 77,
        })),
    }));
    const buildDir = await buildWithDay("excl", DAY, [
      kept,
      arena,
      brawl,
      classic,
      augmented,
    ]);
    const rows = await partialRows(buildDir);
    expect(rows.find((row) => row.kind === "matches")?.games).toBe(1);
    expect(
      rows
        .filter((row) => row.kind === "champion")
        .every((row) => row.games === 1),
    ).toBe(true);
  });

  test("re-derives after erasure: a rewritten day loses the erased match from its counts", async () => {
    const victim = distinctCrawlPuuid("erased-meta");
    const segments = [
      await crawlSegment(DAY, ["NA1_9700000020"]),
      await crawlSegment(DAY, ["NA1_9700000021"]),
    ];
    const buildDir = await buildWithDay("pre", DAY, segments);
    const withVictim = await buildWithDay("victim", DAY, [
      ...segments,
      await (async () => {
        const record = await crawlRecord("NA1_9700000022", { player: victim });
        return encodeSegment({ route: "na1", dt: DAY, records: [record] });
      })(),
    ]);
    expect(await matchCount(withVictim)).toBe(3);
    expect(await matchCount(buildDir)).toBe(2);

    // What the erasure step does inside a build: rewrite the day's files,
    // then re-derive the partials of every day it touched.
    const erasure = await eraseCrawlMatchesInBuild({
      buildDir: withVictim,
      buildId: "erase",
      erased: new Set([puuidHash(victim)]),
    });
    expect(erasure.matchesRemoved).toBe(1);
    expect(erasure.daysTouched).toEqual([DAY]);
    await writeDayPartials({
      buildDir: withVictim,
      buildId: "erase",
      day: DAY,
    });

    const after = await partialRows(withVictim);
    expect(after.find((row) => row.kind === "matches")?.games).toBe(2);
    expect(await partialRows(withVictim)).toEqual(await partialRows(buildDir));
  });

  test("compaction with an erased player drops the match from the partials it writes", async () => {
    const victim = distinctCrawlPuuid("erased-compact");
    const segment = await crawlSegment(DAY, ["NA1_9700000030"]);
    const withVictim = encodeSegment({
      route: "na1",
      dt: DAY,
      records: [await crawlRecord("NA1_9700000031", { player: victim })],
    });
    const buildDir = await newBuild("c");
    const manifest = emptyCrawlManifest();
    const both = [segment, withVictim];
    await rebuildCrawlDay({
      buildDir,
      buildId: "c-day",
      day: DAY,
      manifest,
      segments: both.map((one) => ({ ...one })),
      source: memoryCrawlSegmentSource(both),
      erased: NO_ERASURES,
    });
    const result = await compactCrawlDay({
      buildDir,
      buildId: "c-compact",
      day: DAY,
      erased: new Set([puuidHash(victim)]),
    });
    expect(result).toMatchObject({ erasedMatches: 1, partialsWritten: true });
    expect(await matchCount(buildDir)).toBe(1);
  });

  test("the nightly step carries partials by hardlink, derives missing ones and drops expired days", async () => {
    const recent = await crawlSegment(DAY, ["NA1_9700000040"]);
    const old = await crawlSegment(OLD_DAY, ["NA1_9700000041"]);
    const previous = await buildWithDay("prev", DAY, [recent]);
    const oldManifest = emptyCrawlManifest();
    await rebuildCrawlDay({
      buildDir: previous,
      buildId: "old",
      day: OLD_DAY,
      manifest: oldManifest,
      segments: [{ ...old }],
      source: memoryCrawlSegmentSource([old]),
      erased: NO_ERASURES,
    });
    await writeDayPartials({
      buildDir: previous,
      buildId: "old",
      day: OLD_DAY,
    });
    expect(await hasCurrentPartials(previous, OLD_DAY)).toBe(true);

    const next = await newBuild("next");
    const source = memoryCrawlSegmentSource([recent, old]);
    const summary = await maintainCrawlTables({
      previousDir: previous,
      buildDir: next,
      buildId: "next",
      source,
      erased: NO_ERASURES,
      now: NOW,
    });
    expect(summary.partialDays).toEqual([]);
    expect(await hasCurrentPartials(next, DAY)).toBe(true);
    expect(await hasCurrentPartials(next, OLD_DAY)).toBe(false);
    expect(await partialRows(next)).toEqual(await partialRows(previous));
    // The published build keeps its own partials.
    expect(await hasCurrentPartials(previous, OLD_DAY)).toBe(true);
  });
});

describe("roll-up", () => {
  const THREE = ["NA1_9700000050", "NA1_9700000051", "NA1_9700000052"];

  test("writes a versioned manifest and tier file the reader parses, with samples", async () => {
    const { summary, meta } = await rolledUp("r1", THREE);
    expect(summary).toMatchObject({ written: true, days: 1, champions: 10 });
    const manifest = await meta.manifest();
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      buildId: "r1",
      generatedAt: NOW.toISOString(),
      source: { firstDay: DAY, lastDay: DAY, days: 1 },
      patches: ["16.3"],
      defaults: { patch: "16.3", queueId: 420, bracket: "all" },
    });
    expect(manifest?.champions).toHaveLength(10);
    expect(manifest?.brackets).toEqual(["all", "mid"]);

    const tierPath = manifest?.tiers.find(
      (tier) => tier.bracket === "all",
    )?.path;
    const tiers = await meta.tier(tierPath ?? "missing");
    expect(tiers?.sample.matches).toBe(3);
    expect(tiers?.context).toEqual({
      patch: "16.3",
      queueId: 420,
      queue: "ranked_solo",
      bracket: "all",
    });
    expect(tiers?.entries).toHaveLength(10);
    // Grades follow the lower bound of the interval, best first.
    const lowers = tiers?.entries.map((entry) => entry.winRate.lower) ?? [];
    expect(lowers).toEqual(lowers.toSorted((left, right) => right - left));
  });

  test("writes champion and matchup files with Wilson intervals", async () => {
    const { meta } = await rolledUp("r1b", THREE);
    const manifest = await meta.manifest();
    const [first] = manifest?.champions ?? [];
    const champion = await meta.champion(first?.id ?? 0);
    const slice = champion?.slices.find(
      (candidate) => candidate.context.bracket === "all",
    );
    expect(slice?.sample).toEqual({ games: 3, matches: 3 });
    const expected = wilsonInterval(slice?.winRate.value === 1 ? 3 : 0, 3);
    expect(slice?.winRate).toEqual(expected);
    expect(slice?.pickRate).toEqual(wilsonInterval(3, 3));
    expect(slice?.banRate).toEqual(wilsonInterval(0, 3));

    const matchups = await meta.matchups(first?.id ?? 0);
    expect(matchups?.slices[0]?.opponents[0]?.games).toBe(3);
  });

  test("writes builds, runes, spells and item lift for a slice", async () => {
    const { meta } = await rolledUp("r1c", THREE);
    const manifest = await meta.manifest();
    const champion = await meta.champion(manifest?.champions[0]?.id ?? 0);
    const slice = champion?.slices.find(
      (candidate) => candidate.context.bracket === "all",
    );
    expect(slice?.runes.length).toBeGreaterThan(0);
    expect(slice?.spells[0]?.spellIds).toHaveLength(2);
    expect(slice?.coreItems.length).toBeGreaterThan(0);
    expect(slice?.itemLift.length).toBeGreaterThan(0);
  });

  test("is idempotent: a second run over the same partials writes identical files", async () => {
    const buildDir = await buildWithDay("r2", DAY, [
      await crawlSegment(DAY, ["NA1_9700000060", "NA1_9700000061"]),
    ]);
    const run = async () =>
      await rollUpMeta({
        buildDir,
        buildId: "r2",
        now: NOW,
        thresholds: SMALL,
      });
    await run();
    const files = [
      ...new Bun.Glob("meta/v1/**/*.json").scanSync({
        cwd: buildDir,
        absolute: true,
      }),
    ].toSorted();
    const first = await Promise.all(
      files.map((file) => readFile(file, "utf8")),
    );
    await run();
    const second = await Promise.all(
      files.map((file) => readFile(file, "utf8")),
    );
    expect(files.length).toBeGreaterThan(20);
    expect(second).toEqual(first);
    expect([
      ...new Bun.Glob("meta/v1/**/*.json").scanSync({ cwd: buildDir }),
    ]).toHaveLength(files.length);
  });

  test("enforces the minimum samples", async () => {
    const buildDir = await buildWithDay("r3", DAY, [
      await crawlSegment(DAY, ["NA1_9700000070", "NA1_9700000071"]),
    ]);
    const atTwo = await rollUpMeta({
      buildDir,
      buildId: "r3",
      now: NOW,
      thresholds: { minSliceGames: 2, minEntryGames: 3, minMatchupGames: 3 },
    });
    expect(atTwo.champions).toBe(10);
    const meta = reader(buildDir);
    const manifest = await meta.manifest();
    const champion = await meta.champion(manifest?.champions[0]?.id ?? 0);
    // Two games meet the slice floor but not the entry or matchup floors.
    expect(champion?.slices[0]?.coreItems).toEqual([]);
    expect(champion?.slices[0]?.runes).toEqual([]);
    expect(await meta.matchups(champion?.championId ?? 0)).toBeUndefined();

    const belowSlice = await rollUpMeta({
      buildDir,
      buildId: "r3",
      now: NOW,
      thresholds: { minSliceGames: 3, minEntryGames: 1, minMatchupGames: 1 },
    });
    expect(belowSlice).toMatchObject({
      written: true,
      champions: 0,
      tierFiles: 0,
    });
    const emptied = await meta.manifest();
    expect(emptied?.defaults).toBeNull();
    expect(emptied?.champions).toEqual([]);
  });

  test("a build with no partials serves no meta, and a carried copy is removed", async () => {
    const buildDir = await buildWithDay("r4", DAY, [
      await crawlSegment(DAY, ["NA1_9700000080"]),
    ]);
    await rollUpMeta({ buildDir, buildId: "r4", now: NOW, thresholds: SMALL });
    expect(await reader(buildDir).manifest()).toBeDefined();
    await rm(path.join(buildDir, META_PARTIALS_TABLE), {
      recursive: true,
      force: true,
    });
    expect(
      await rollUpMeta({
        buildDir,
        buildId: "r4",
        now: NOW,
        thresholds: SMALL,
      }),
    ).toMatchObject({ written: false });
    expect(await reader(buildDir).manifest()).toBeUndefined();
    await expect(stat(path.join(buildDir, "meta"))).rejects.toThrow();
  });

  test("erasure flows through: partials re-derived after an erasure roll up without the match", async () => {
    const victim = distinctCrawlPuuid("erased-rollup");
    const buildDir = await buildWithDay("r5", DAY, [
      await crawlSegment(DAY, ["NA1_9700000090"]),
      encodeSegment({
        route: "na1",
        dt: DAY,
        records: [await crawlRecord("NA1_9700000091", { player: victim })],
      }),
    ]);
    await rollUpMeta({ buildDir, buildId: "r5", now: NOW, thresholds: SMALL });
    const meta = reader(buildDir);
    const tierMatches = async () => {
      const manifest = await meta.manifest();
      const entry = manifest?.tiers.find((tier) => tier.bracket === "all");
      const file = await meta.tier(entry?.path ?? "missing");
      return file?.sample.matches;
    };
    expect(await tierMatches()).toBe(2);

    await eraseCrawlMatchesInBuild({
      buildDir,
      buildId: "r5-erase",
      erased: new Set([puuidHash(victim)]),
    });
    await writeDayPartials({ buildDir, buildId: "r5-erase", day: DAY });
    await rollUpMeta({ buildDir, buildId: "r5b", now: NOW, thresholds: SMALL });
    expect(await tierMatches()).toBe(1);
  });
});

const TWO = ["NA1_9700000100", "NA1_9700000101"];

async function partialsFor(id: string, matchIds: string[]) {
  const buildDir = await buildWithDay(id, DAY, [
    await crawlSegment(DAY, matchIds),
  ]);
  const rows = await partialRows(buildDir);
  const champions = new Map(
    rows
      .filter((row) => row.kind === "champion")
      .map((row) => [row.key1, row.champion_id]),
  );
  const of = (kind: string, name: string) =>
    rows.filter(
      (row) => row.kind === kind && row.champion_id === champions.get(name),
    );
  return { rows, of, champions };
}

describe("partials version", () => {
  test("the partials definition is version 2 and its files say so", async () => {
    expect(META_PARTIALS_VERSION).toBe(2);
    const buildDir = await buildWithDay("v2", DAY, [
      await crawlSegment(DAY, TWO),
    ]);
    const names = [
      ...new Bun.Glob(
        `${META_PARTIALS_TABLE}/ingest_day=${DAY}/*.parquet`,
      ).scanSync({ cwd: buildDir }),
    ];
    expect(names).toHaveLength(1);
    expect(path.basename(names[0] ?? "")).toMatch(/^partials-v2-/u);
  });

  test("a retained day at version 1 counts as missing and the nightly step re-derives it", async () => {
    const previous = await buildWithDay("v1", DAY, [
      await crawlSegment(DAY, TWO),
    ]);
    const directory = metaPartialsDayDir(previous, DAY);
    const [current = "missing"] = await currentDayPartialFiles(previous, DAY);
    await rename(current, path.join(directory, "partials-v1-old.parquet"));
    expect(await hasCurrentPartials(previous, DAY)).toBe(false);
    expect(await hasAnyPartials(previous, DAY)).toBe(true);
    // A roll-up reads only current files: the v1 day contributes nothing.
    expect(
      await rollUpMeta({
        buildDir: previous,
        buildId: "v1",
        now: NOW,
        thresholds: SMALL,
      }),
    ).toMatchObject({ written: false });

    const next = await newBuild("v1-next");
    const summary = await maintainCrawlTables({
      previousDir: previous,
      buildDir: next,
      buildId: "v1-next",
      source: memoryCrawlSegmentSource([await crawlSegment(DAY, TWO)]),
      erased: NO_ERASURES,
      now: NOW,
    });
    expect(summary.partialDays).toEqual([DAY]);
    expect(await hasCurrentPartials(next, DAY)).toBe(true);
    // The v1 file is gone from the new build and untouched in the published one.
    expect(await readdir(metaPartialsDayDir(next, DAY))).toHaveLength(1);
    expect(await readdir(directory)).toContain("partials-v1-old.parquet");
    const rolled = await rollUpMeta({
      buildDir: next,
      buildId: "v1-next",
      now: NOW,
      thresholds: SMALL,
    });
    expect(rolled.written).toBe(true);
  });
});

describe("public champion statistics", () => {
  test("the boots list is the Data Dragon boots on Summoner's Rift", () => {
    const fromDataDragon = Object.entries(items.data)
      .filter(
        ([id, item]) =>
          item.tags.includes("Boots") &&
          item.maps["11"] === true &&
          Number(id) < 100_000,
      )
      .map(([id]) => Number(id))
      .toSorted((left, right) => left - right);
    expect([...BOOTS_ITEM_IDS].toSorted((left, right) => left - right)).toEqual(
      fromDataDragon,
    );
  });

  test("duration, boots, keystone, spell_single and matchup_spell partials count each participant", async () => {
    const { rows, of, champions } = await partialsFor("kinds", TWO);
    // Every participant of the 23-minute fixture game is in the short bucket.
    const durations = rows.filter((row) => row.kind === "duration");
    expect(durations).toHaveLength(10);
    expect(
      durations.every((row) => row.key1 === "lt25" && row.games === 2),
    ).toBe(true);

    const bootsOf = (name: string) =>
      of("boots", name).map((row) => [row.key1, row.games, row.wins]);
    expect(bootsOf("Irelia")).toEqual([["3111", 2, 0]]);
    expect(bootsOf("Volibear")).toEqual([["3009", 2, 2]]);
    expect(bootsOf("Lissandra")).toEqual([["1001", 2, 0]]);
    expect(bootsOf("Seraphine")).toEqual([["3171", 2, 2]]);
    // Tristana and Yunara finish without boots, so they have no boots row.
    expect(bootsOf("Tristana")).toEqual([]);
    expect(bootsOf("Yunara")).toEqual([]);
    expect(
      rows
        .filter((row) => row.kind === "boots")
        .every((row) => BOOTS_ITEM_IDS.includes(Number(row.key1))),
    ).toBe(true);

    expect(
      of("keystone", "Irelia").map((row) => [row.key1, row.games, row.wins]),
    ).toEqual([["8010", 2, 0]]);

    // Each spell is counted on its own whichever slot it sits in.
    expect(
      of("spell_single", "Seraphine").map((row) => [row.key1, row.games]),
    ).toEqual([
      ["12", 2],
      ["4", 2],
    ]);
    expect(
      of("spell_single", "Irelia").map((row) => [row.key1, row.games]),
    ).toEqual([
      ["14", 2],
      ["4", 2],
    ]);

    // Irelia and Volibear met twice in TOP; both took Flash and Ignite.
    const volibear = String(champions.get("Volibear"));
    expect(
      of("matchup_spell", "Irelia").map((row) => [
        row.key1,
        row.key2,
        row.games,
        row.wins,
      ]),
    ).toEqual([[volibear, "4,14", 2, 0]]);
    expect(
      of("matchup_spell", "Volibear").map((row) => [
        row.key1,
        row.key2,
        row.games,
        row.wins,
      ]),
    ).toEqual([[String(champions.get("Irelia")), "4,14", 2, 2]]);
  });

  test("game length buckets split at 25 and 35 minutes", async () => {
    const segments = [];
    for (const [index, gameDuration] of [1499, 1500, 2100, 2101].entries()) {
      segments.push(
        await variantSegment(
          DAY,
          `NA1_97000002${index.toString().padStart(2, "0")}`,
          (info) => ({ ...info, gameDuration }),
        ),
      );
    }
    const buildDir = await buildWithDay("buckets", DAY, segments);
    const rows = await partialRows(buildDir);
    const irelia = rows.find(
      (row) => row.kind === "champion" && row.key1 === "Irelia",
    )?.champion_id;
    expect(
      rows
        .filter((row) => row.kind === "duration" && row.champion_id === irelia)
        .map((row) => [row.key1, row.games]),
    ).toEqual([
      ["25to35", 2],
      ["gt35", 1],
      ["lt25", 1],
    ]);
  });

  test("the roll-up serves the new figures with the entry floor, and spell pairs with the matchup floor", async () => {
    // Two matches share each spell pair; a third swaps the first spell to Smite.
    const swapped = await variantSegment(DAY, "NA1_9700000302", (info) => ({
      ...info,
      participants: MatchShapeSchema.shape.info
        .parse(info)
        .participants.map((participant) => ({
          ...participant,
          summoner1Id: 11,
        })),
    }));
    const buildDir = await buildWithDay("floors", DAY, [
      await crawlSegment(DAY, ["NA1_9700000300", "NA1_9700000301"]),
      swapped,
    ]);
    const serve = async (thresholds: {
      minSliceGames: number;
      minEntryGames: number;
      minMatchupGames: number;
    }) => {
      await rollUpMeta({ buildDir, buildId: "floors", now: NOW, thresholds });
      const meta = reader(buildDir);
      const manifest = await meta.manifest();
      const irelia = manifest?.champions.find((one) => one.name === "Irelia");
      const champion = await meta.champion(irelia?.id ?? 0);
      const matchups = await meta.matchups(irelia?.id ?? 0);
      return {
        slice: champion?.slices.find((one) => one.context.bracket === "all"),
        opponents: matchups?.slices[0]?.opponents ?? [],
      };
    };

    const generous = await serve({
      minSliceGames: 1,
      minEntryGames: 1,
      minMatchupGames: 1,
    });
    expect(generous.slice?.durations).toEqual([
      {
        bucket: "lt25",
        games: 3,
        wins: 0,
        winRate: wilsonInterval(0, 3),
        share: wilsonInterval(3, 3),
        denominator: "games_with_duration",
      },
    ]);
    expect(generous.slice?.boots).toEqual([
      expect.objectContaining({ itemId: 3111, games: 3, wins: 0 }),
    ]);
    expect(generous.slice?.keystones).toEqual([
      expect.objectContaining({ perkId: 8010, games: 3, wins: 0 }),
    ]);
    // Irelia took Ignite or Flash in every game and Smite in one.
    expect(
      generous.slice?.singleSpells?.map((spell) => [
        spell.spellId,
        spell.games,
      ]),
    ).toEqual([
      [14, 3],
      [4, 2],
      [11, 1],
    ]);
    expect(generous.opponents[0]?.spells?.map((pair) => pair.games)).toEqual([
      2, 1,
    ]);

    // An entry floor of 3 keeps Ignite alone; the matchup floor of 2 keeps the
    // pair played twice and drops the pair played once, whatever the entry floor.
    const middle = await serve({
      minSliceGames: 1,
      minEntryGames: 3,
      minMatchupGames: 2,
    });
    expect(middle.slice?.singleSpells?.map((spell) => spell.spellId)).toEqual([
      14,
    ]);
    expect(middle.opponents[0]?.spells?.map((pair) => pair.spellIds)).toEqual([
      [4, 14],
    ]);

    // At a matchup floor of 3 neither pair (2 and 1 games) qualifies.
    const strict = await serve({
      minSliceGames: 1,
      minEntryGames: 1,
      minMatchupGames: 3,
    });
    expect(strict.opponents[0]?.spells).toEqual([]);
  });
});
