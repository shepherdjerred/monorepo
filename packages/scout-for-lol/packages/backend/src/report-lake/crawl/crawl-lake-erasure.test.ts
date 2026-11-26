import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { puuidHash } from "#src/league/crawl/crawl-config.ts";
import type { EncodedSegment } from "#src/league/crawl/crawl-segment.ts";
import { foldCrawlInbox } from "#src/report-lake/crawl/crawl-fold.ts";
import { writeCrawlInboxSegment } from "#src/report-lake/crawl/crawl-inbox.ts";
import {
  applySegmentReplacements,
  eraseCrawlMatchesInBuild,
} from "#src/report-lake/crawl/crawl-lake-erasure.ts";
import {
  CRAWL_LAKE_TABLES,
  type CrawlLakeTable,
} from "#src/report-lake/crawl/crawl-lake-schema.ts";
import { readCrawlManifest } from "#src/report-lake/crawl/crawl-manifest.ts";
import { linkTreeContents } from "#src/report-lake/link-tree.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  crawlSegmentOf,
  distinctCrawlPuuid,
} from "#src/testing/report-lake/crawl-segments.ts";

/**
 * Lake day-file erasure inside an unpublished build, against temp build
 * directories and DuckDB only. The "published" build is folded first and the
 * new build hardlinks it, as `runReportLakeFold` does.
 */

const NOW = new Date("2026-11-14T03:00:00.000Z");
const TODAY = "2026-11-14";
const YESTERDAY = "2026-11-13";
const ERASED = distinctCrawlPuuid("erased");
const ERASED_SET = new Set([puuidHash(ERASED)]);
const VICTIM_MATCH = "NA1_9600000002";

let tempRoot: string;
let lakeDir: string;
let published: string;
let build: string;
let yesterday: EncodedSegment;

const RowSchema = z.record(z.string(), z.unknown());

function files(buildDir: string, table: CrawlLakeTable): string[] {
  return [
    ...new Bun.Glob(`${table}/ingest_day=*/*.parquet`).scanSync({
      cwd: buildDir,
      absolute: true,
    }),
  ].toSorted();
}

/** Each file's rows in stored order, keyed by the file's path inside its build. */
async function rowsByFile(
  buildDir: string,
  table: CrawlLakeTable,
): Promise<Record<string, Record<string, unknown>[]>> {
  const result: Record<string, Record<string, unknown>[]> = {};
  for (const file of files(buildDir, table)) {
    const rows = await withDuckDBConnection(
      async (session) =>
        await session.run(
          `SELECT * FROM read_parquet($1, hive_partitioning = false)`,
          [file],
        ),
    );
    result[path.relative(buildDir, file)] = rows.map((row) =>
      RowSchema.parse(row),
    );
  }
  return result;
}

async function checkpointRows(buildDir: string) {
  return Object.values(
    await rowsByFile(buildDir, "timeline_checkpoints_crawl"),
  ).flat();
}

async function snapshot(buildDir: string) {
  const tables: Record<string, Record<string, Record<string, unknown>[]>> = {};
  for (const table of CRAWL_LAKE_TABLES) {
    tables[table] = await rowsByFile(buildDir, table);
  }
  return tables;
}

async function inodes(buildDir: string): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const table of CRAWL_LAKE_TABLES) {
    for (const file of files(buildDir, table)) {
      const stats = await stat(file);
      result.set(path.relative(buildDir, file), stats.ino);
    }
  }
  return result;
}

async function fold(buildDir: string, segment: EncodedSegment) {
  await writeCrawlInboxSegment(lakeDir, segment);
  await foldCrawlInbox({
    lakeDir,
    buildDir,
    buildId: segment.sha256.slice(0, 8),
    loadErased: () => Promise.resolve(new Set<string>()),
    now: NOW,
  });
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "crawl-lake-erasure-"));
  lakeDir = tempRoot;
  published = path.join(lakeDir, "builds", "1");
  build = path.join(lakeDir, "builds", "2");
  await mkdir(published, { recursive: true });
  yesterday = await crawlSegmentOf(YESTERDAY, [
    { matchId: "NA1_9600000001" },
    { matchId: VICTIM_MATCH, player: ERASED },
    { matchId: "NA1_9600000003", player: distinctCrawlPuuid("other") },
  ]);
  await fold(published, yesterday);
  await fold(
    published,
    await crawlSegmentOf(TODAY, [{ matchId: "NA1_9600000004" }]),
  );
  await mkdir(build, { recursive: true });
  await linkTreeContents(published, build);
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("eraseCrawlMatchesInBuild", () => {
  test("removes the player's match from every crawl table and keeps every other row as it was", async () => {
    const before = await snapshot(build);
    const linked = await inodes(build);

    const summary = await eraseCrawlMatchesInBuild({
      buildDir: build,
      buildId: "2",
      erased: ERASED_SET,
    });

    expect(summary.matchesRemoved).toBe(1);
    expect(summary.filesRewritten).toBeGreaterThan(0);
    const after = await snapshot(build);
    for (const table of CRAWL_LAKE_TABLES) {
      const expected = Object.fromEntries(
        Object.entries(before[table] ?? {})
          .map(([file, rows]): [string, Record<string, unknown>[]] => [
            file,
            rows.filter((row) => row["match_id"] !== VICTIM_MATCH),
          ])
          .filter(([, rows]) => rows.length > 0),
      );
      // Same files, same rows in the same order, minus the erased match.
      expect(after[table], table).toEqual(expected);
    }
    const flattened = JSON.stringify(after, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(flattened).not.toContain(ERASED);
    expect(flattened).not.toContain(VICTIM_MATCH);

    // Today's files held no erased match: they are the same inodes as before.
    const rewritten = await inodes(build);
    for (const [file, inode] of linked) {
      if (file.includes(`ingest_day=${TODAY}`)) {
        expect(rewritten.get(file), file).toBe(inode);
      }
    }
    // The published build it was linked from still has its own copy.
    expect(await snapshot(published)).toEqual(before);
  });

  test("removes the erased player's checkpoint rows and keeps every other player's", async () => {
    const before = await checkpointRows(build);
    const victim = before.filter((row) => row["match_id"] === VICTIM_MATCH);
    // Ten participants at two checkpoints, one of them the erased player.
    expect(victim).toHaveLength(20);
    expect(victim.filter((row) => row["puuid"] === ERASED)).toHaveLength(2);
    expect(before).toHaveLength(4 * 20);

    await eraseCrawlMatchesInBuild({
      buildDir: build,
      buildId: "2",
      erased: ERASED_SET,
    });

    const after = await checkpointRows(build);
    expect(after).toHaveLength(3 * 20);
    expect(after.some((row) => row["match_id"] === VICTIM_MATCH)).toBe(false);
    expect(after.some((row) => row["puuid"] === ERASED)).toBe(false);
    // The other players' checkpoints in other matches are untouched.
    expect(
      after.filter((row) => row["puuid"] === distinctCrawlPuuid("other")),
    ).toHaveLength(2);
  });

  test("a second run finds nothing and changes no file", async () => {
    await eraseCrawlMatchesInBuild({
      buildDir: build,
      buildId: "2",
      erased: ERASED_SET,
    });
    const settled = await snapshot(build);
    const settledInodes = await inodes(build);

    const again = await eraseCrawlMatchesInBuild({
      buildDir: build,
      buildId: "2",
      erased: ERASED_SET,
    });

    expect(again).toEqual({
      matchesRemoved: 0,
      filesRewritten: 0,
      filesRemoved: 0,
      daysTouched: [],
    });
    expect(await snapshot(build)).toEqual(settled);
    expect(await inodes(build)).toEqual(settledInodes);
  });

  test("removes a file whose only match was erased", async () => {
    const only = await crawlSegmentOf(TODAY, [
      { matchId: "NA1_9600000010", player: ERASED },
    ]);
    // A lake of its own, so its inbox holds only this segment.
    lakeDir = path.join(lakeDir, "isolated");
    const isolated = path.join(lakeDir, "builds", "3");
    await mkdir(isolated, { recursive: true });
    await fold(isolated, only);

    const summary = await eraseCrawlMatchesInBuild({
      buildDir: isolated,
      buildId: "3",
      erased: ERASED_SET,
    });

    expect(summary).toMatchObject({ matchesRemoved: 1, filesRewritten: 0 });
    for (const table of CRAWL_LAKE_TABLES) {
      expect(files(isolated, table), table).toEqual([]);
    }
  });

  test("changes nothing with no erasure pending", async () => {
    const linked = await inodes(build);
    expect(
      await eraseCrawlMatchesInBuild({
        buildDir: build,
        buildId: "2",
        erased: new Set<string>(),
      }),
    ).toEqual({
      matchesRemoved: 0,
      filesRewritten: 0,
      filesRemoved: 0,
      daysTouched: [],
    });
    expect(await inodes(build)).toEqual(linked);
  });
});

describe("applySegmentReplacements", () => {
  test("points the ledger at the rewritten segment and ignores one it does not list", async () => {
    const replacement = "f".repeat(64);
    const applied = await applySegmentReplacements(build, [
      { dt: YESTERDAY, oldSha256: yesterday.sha256, newSha256: replacement },
      { dt: YESTERDAY, oldSha256: "e".repeat(64), newSha256: null },
    ]);
    expect(applied).toBe(1);
    const manifest = await readCrawlManifest(build);
    expect(manifest?.days[YESTERDAY]).toEqual([replacement]);
    // The published build's ledger is a separate file.
    const publishedManifest = await readCrawlManifest(published);
    expect(publishedManifest?.days[YESTERDAY]).toEqual([yesterday.sha256]);
  });

  test("drops a segment that was deleted outright", async () => {
    await applySegmentReplacements(build, [
      { dt: YESTERDAY, oldSha256: yesterday.sha256, newSha256: null },
    ]);
    const manifest = await readCrawlManifest(build);
    expect(manifest?.days[YESTERDAY]).toEqual([]);
  });
});
