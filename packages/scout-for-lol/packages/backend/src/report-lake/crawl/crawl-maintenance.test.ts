import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { puuidHash } from "#src/league/crawl/crawl-config.ts";
import type { EncodedSegment } from "#src/league/crawl/crawl-segment.ts";
import {
  crawlSchemaFingerprint,
  type CrawlLakeTable,
} from "#src/report-lake/crawl/crawl-lake-schema.ts";
import { foldCrawlInbox } from "#src/report-lake/crawl/crawl-fold.ts";
import { writeCrawlInboxSegment } from "#src/report-lake/crawl/crawl-inbox.ts";
import {
  applyCrawlRetention,
  compactCrawlDay,
  maintainCrawlTables,
  rebuildCrawlDay,
} from "#src/report-lake/crawl/crawl-maintenance.ts";
import {
  emptyCrawlManifest,
  readCrawlManifest,
  writeCrawlManifest,
} from "#src/report-lake/crawl/crawl-manifest.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  crawlFixturePuuids,
  crawlSegment,
  memoryCrawlSegmentSource,
} from "#src/testing/report-lake/crawl-segments.ts";

/**
 * Crawl-day compaction, rebuild and retention against temp build directories
 * and DuckDB only. Committed segments come from an in-memory source standing
 * in for `CrawlSegment` rows and the S3 objects they name.
 */

const NOW = new Date("2026-11-14T03:00:00.000Z");
const TODAY = "2026-11-14";
const YESTERDAY = "2026-11-13";
const OLD_DAY = "2026-09-20";
const NO_ERASURES = new Set<string>();

let lakeDir: string;

beforeEach(async () => {
  lakeDir = await mkdtemp(path.join(tmpdir(), "crawl-maintenance-"));
});

afterEach(async () => {
  await rm(lakeDir, { recursive: true, force: true });
});

async function newBuild(id: string): Promise<string> {
  const dir = path.join(lakeDir, "builds", id);
  await mkdir(dir, { recursive: true });
  return dir;
}

function files(buildDir: string, table: CrawlLakeTable, day = "*") {
  return [
    ...new Bun.Glob(`${table}/ingest_day=${day}/*.parquet`).scanSync({
      cwd: buildDir,
      absolute: true,
    }),
  ].toSorted();
}

/** Every row of a table, ordered, as a stable value to compare builds by. */
async function tableRows(
  buildDir: string,
  table: CrawlLakeTable,
): Promise<unknown[]> {
  const list = files(buildDir, table);
  if (list.length === 0) return [];
  const raw = await withDuckDBConnection(
    async (session) =>
      await session.run(
        `SELECT * FROM read_parquet($1, hive_partitioning = false) ORDER BY ALL`,
        [session.list(list)],
      ),
  );
  return raw.map((row) => z.record(z.string(), z.unknown()).parse(row));
}

async function manifestDays(buildDir: string) {
  const manifest = await readCrawlManifest(buildDir);
  return manifest?.days;
}

async function fold(
  buildDir: string,
  buildId: string,
  segment: EncodedSegment,
) {
  await writeCrawlInboxSegment(lakeDir, segment);
  return await foldCrawlInbox({
    lakeDir,
    buildDir,
    buildId,
    loadErased: () => Promise.resolve(NO_ERASURES),
    now: NOW,
  });
}

describe("compaction and retention round trip", () => {
  test("merges fold fragments into one file per table without changing a row, and drops expired days", async () => {
    const first = await crawlSegment(YESTERDAY, ["NA1_9100000001"]);
    const second = await crawlSegment(YESTERDAY, ["NA1_9100000002"]);
    const old = await crawlSegment(OLD_DAY, ["NA1_9100000003"]);

    // Build one: two folds of yesterday, plus a day that is now past retention.
    const previous = await newBuild("1");
    await fold(previous, "1a", first);
    await fold(previous, "1b", second);
    const manifest =
      (await readCrawlManifest(previous)) ?? emptyCrawlManifest();
    await rebuildCrawlDay({
      buildDir: previous,
      buildId: "1c",
      day: OLD_DAY,
      manifest,
      segments: [{ ...old }],
      source: memoryCrawlSegmentSource([old]),
      erased: NO_ERASURES,
    });
    await writeCrawlManifest(previous, manifest);
    expect(files(previous, "matches_crawl", YESTERDAY).length).toBeGreaterThan(
      1,
    );
    const before = await tableRows(previous, "matches_crawl");
    const beforeEvents = await tableRows(previous, "timeline_events_crawl");
    const previousFiles = files(previous, "matches_crawl");

    // Build two: the nightly step.
    const next = await newBuild("2");
    const source = memoryCrawlSegmentSource([first, second, old]);
    const summary = await maintainCrawlTables({
      previousDir: previous,
      buildDir: next,
      buildId: "2",
      source,
      erased: NO_ERASURES,
      now: NOW,
    });

    expect(summary).toMatchObject({
      carried: true,
      rebuiltDays: [],
      compactedDays: [YESTERDAY],
      expiredDays: [OLD_DAY],
    });
    // Nothing was re-read from the object store: the ledger already held both.
    expect(source.reads).toEqual([]);
    for (const table of [
      "matches_crawl",
      "match_teams_crawl",
      "match_team_bans_crawl",
      "timeline_events_crawl",
      "timeline_event_participants_crawl",
      "timeline_checkpoints_crawl",
    ] as const) {
      expect(files(next, table, YESTERDAY), table).toHaveLength(1);
      expect(files(next, table, OLD_DAY), table).toEqual([]);
    }
    const oldRows = before.filter(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "ingest_day" in row &&
        row.ingest_day === OLD_DAY,
    );
    expect(oldRows.length).toBe(10);
    expect(await tableRows(next, "matches_crawl")).toEqual(
      before.filter((row) => !oldRows.includes(row)),
    );
    expect(await tableRows(next, "timeline_events_crawl")).toEqual(
      beforeEvents.filter(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "ingest_day" in row &&
          row.ingest_day === YESTERDAY,
      ),
    );
    expect(await manifestDays(next)).toEqual({
      [YESTERDAY]: [first.sha256, second.sha256].toSorted(),
    });

    // The published build it was carried from is untouched.
    expect(files(previous, "matches_crawl")).toEqual(previousFiles);
    expect(await tableRows(previous, "matches_crawl")).toEqual(before);
  });

  test("leaves today's day in fragments for further folds", async () => {
    const build = await newBuild("1");
    await fold(build, "1a", await crawlSegment(TODAY, ["NA1_9100000010"]));
    await fold(build, "1b", await crawlSegment(TODAY, ["NA1_9100000011"]));
    const next = await newBuild("2");
    const summary = await maintainCrawlTables({
      previousDir: build,
      buildDir: next,
      buildId: "2",
      source: memoryCrawlSegmentSource([]),
      erased: NO_ERASURES,
      now: NOW,
    });
    expect(summary.compactedDays).toEqual([]);
    expect(files(next, "matches_crawl", TODAY).length).toBeGreaterThan(1);
  });

  test("retention drops only days before the 42-day window", async () => {
    const build = await newBuild("1");
    const manifest = emptyCrawlManifest();
    manifest.days["2026-10-04"] = ["a".repeat(64)];
    manifest.days["2026-10-03"] = ["b".repeat(64)];
    await mkdir(path.join(build, "matches_crawl", "ingest_day=2026-10-03"), {
      recursive: true,
    });
    await mkdir(path.join(build, "matches_crawl", "ingest_day=2026-10-04"), {
      recursive: true,
    });
    expect(
      await applyCrawlRetention({ buildDir: build, manifest, now: NOW }),
    ).toEqual(["2026-10-03"]);
    expect(Object.keys(manifest.days)).toEqual(["2026-10-04"]);
    expect(await readdir(path.join(build, "matches_crawl"))).toEqual([
      "ingest_day=2026-10-04",
    ]);
  });
});

describe("day rebuild", () => {
  test("re-derives a day whose committed segment never reached the inbox", async () => {
    const folded = await crawlSegment(YESTERDAY, ["NA1_9200000001"]);
    const missed = await crawlSegment(YESTERDAY, ["NA1_9200000002"]);
    const previous = await newBuild("1");
    await fold(previous, "1a", folded);

    const next = await newBuild("2");
    const source = memoryCrawlSegmentSource([folded, missed]);
    const summary = await maintainCrawlTables({
      previousDir: previous,
      buildDir: next,
      buildId: "2",
      source,
      erased: NO_ERASURES,
      now: NOW,
    });

    expect(summary.rebuiltDays).toEqual([YESTERDAY]);
    expect(source.reads.toSorted()).toEqual(
      [folded.sha256, missed.sha256].toSorted(),
    );
    const rebuilt = await tableRows(next, "matches_crawl");
    const matchIds = new Set(
      rebuilt.map(
        (row) => z.object({ match_id: z.string() }).parse(row).match_id,
      ),
    );
    expect(matchIds).toEqual(new Set(["NA1_9200000001", "NA1_9200000002"]));
    expect(rebuilt).toHaveLength(20);
  });

  test("re-derives every retained day when the crawl schema changed", async () => {
    const segment = await crawlSegment(YESTERDAY, ["NA1_9200000010"]);
    const previous = await newBuild("1");
    await fold(previous, "1a", segment);
    const stale = (await readCrawlManifest(previous)) ?? emptyCrawlManifest();
    await writeCrawlManifest(previous, {
      ...stale,
      crawlSchemaFingerprint: "0000000000000000",
    });

    const next = await newBuild("2");
    const summary = await maintainCrawlTables({
      previousDir: previous,
      buildDir: next,
      buildId: "2",
      source: memoryCrawlSegmentSource([segment]),
      erased: NO_ERASURES,
      now: NOW,
    });

    expect(summary).toMatchObject({
      carried: false,
      rebuiltDays: [YESTERDAY],
    });
    const manifest = await readCrawlManifest(next);
    expect(manifest?.crawlSchemaFingerprint).toBe(crawlSchemaFingerprint());
    expect(await tableRows(next, "matches_crawl")).toHaveLength(10);
  });

  test("drops an erased player's match at day rebuild", async () => {
    const [erasedPuuid] = await crawlFixturePuuids();
    if (erasedPuuid === undefined) throw new Error("fixture has no players");
    const segment = await crawlSegment(YESTERDAY, ["NA1_9200000020"]);
    const build = await newBuild("1");
    const manifest = emptyCrawlManifest();
    const tally = await rebuildCrawlDay({
      buildDir: build,
      buildId: "1",
      day: YESTERDAY,
      manifest,
      segments: [segment],
      source: memoryCrawlSegmentSource([segment]),
      erased: new Set([puuidHash(erasedPuuid)]),
    });
    expect(tally).toMatchObject({ segments: 1, erasedMatches: 1 });
    expect(files(build, "matches_crawl")).toEqual([]);
    // The segment is still recorded, so the nightly step does not re-read it.
    expect(manifest.days[YESTERDAY]).toEqual([segment.sha256]);
  });
});

describe("compactCrawlDay erasure", () => {
  test("removes an erased player's match from every crawl table of the day", async () => {
    const [erasedPuuid] = await crawlFixturePuuids();
    if (erasedPuuid === undefined) throw new Error("fixture has no players");
    const build = await newBuild("1");
    await fold(build, "1a", await crawlSegment(YESTERDAY, ["NA1_9300000001"]));

    const result = await compactCrawlDay({
      buildDir: build,
      buildId: "2",
      day: YESTERDAY,
      erased: new Set([puuidHash(erasedPuuid)]),
    });

    expect(result).toEqual({
      compacted: true,
      erasedMatches: 1,
      partialsWritten: true,
    });
    expect(files(build, "matches_crawl")).toEqual([]);
    expect(files(build, "timeline_events_crawl")).toEqual([]);
  });

  test("leaves a single-file day with no erased player alone", async () => {
    const build = await newBuild("1");
    await fold(build, "1a", await crawlSegment(YESTERDAY, ["NA1_9300000002"]));
    const before = files(build, "matches_crawl");
    // One fold writes one file per table when the rows fit one COPY thread.
    if (before.length > 1) {
      await compactCrawlDay({
        buildDir: build,
        buildId: "c",
        day: YESTERDAY,
        erased: NO_ERASURES,
      });
    }
    const settled = files(build, "matches_crawl");
    const result = await compactCrawlDay({
      buildDir: build,
      buildId: "d",
      day: YESTERDAY,
      erased: NO_ERASURES,
    });
    expect(result).toEqual({
      compacted: false,
      erasedMatches: 0,
      partialsWritten: true,
    });
    expect(files(build, "matches_crawl")).toEqual(settled);
  });
});
