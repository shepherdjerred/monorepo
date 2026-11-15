import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { puuidHash } from "#src/league/crawl/crawl-config.ts";
import { foldCrawlInbox } from "#src/report-lake/crawl/crawl-fold.ts";
import {
  listCrawlInbox,
  writeCrawlInboxSegment,
} from "#src/report-lake/crawl/crawl-inbox.ts";
import {
  readCrawlManifest,
  writeCrawlManifest,
} from "#src/report-lake/crawl/crawl-manifest.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  crawlFixturePuuids,
  crawlSegment,
} from "#src/testing/report-lake/crawl-segments.ts";

/**
 * The crawl inbox fold, against temp lake directories and DuckDB only: no
 * PostgreSQL, no S3. The erased-PUUID list is handed in as the fold's loader.
 */

const NOW = new Date("2026-11-14T18:00:00.000Z");
const DAY = "2026-11-14";
const NO_ERASURES = () => Promise.resolve(new Set<string>());

let lakeDir: string;
let buildDir: string;

beforeEach(async () => {
  lakeDir = await mkdtemp(path.join(tmpdir(), "crawl-fold-"));
  buildDir = path.join(lakeDir, "builds", "b1");
  await mkdir(buildDir, { recursive: true });
});

afterEach(async () => {
  await rm(lakeDir, { recursive: true, force: true });
});

async function rows(
  table: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const files = [
    ...new Bun.Glob(`${table}/ingest_day=*/*.parquet`).scanSync({
      cwd: buildDir,
      absolute: true,
    }),
  ];
  if (files.length === 0) return [];
  const raw = await withDuckDBConnection(
    async (session) =>
      await session.run(
        sql.replace("{files}", "read_parquet($1, hive_partitioning = false)"),
        [session.list(files)],
      ),
  );
  return raw.map((row) => z.record(z.string(), z.unknown()).parse(row));
}

describe("foldCrawlInbox", () => {
  test("folds an inbox segment into ingest-day Parquet and records it in the ledger", async () => {
    const segment = await crawlSegment(DAY, ["NA1_9000000001"]);
    await writeCrawlInboxSegment(lakeDir, segment);

    const { summary, consumed } = await foldCrawlInbox({
      lakeDir,
      buildDir,
      buildId: "b1",
      loadErased: NO_ERASURES,
      now: NOW,
    });

    expect(summary).toMatchObject({
      status: "folded",
      segments: 1,
      erasedMatches: 0,
      invalidMatches: 0,
      rows: {
        matches_crawl: 10,
        match_teams_crawl: 2,
        match_team_bans_crawl: 10,
        timeline_events_crawl: 2,
        timeline_event_participants_crawl: 2,
      },
    });
    expect(consumed.map((entry) => entry.sha256)).toEqual([segment.sha256]);
    expect(await readdir(path.join(buildDir, "matches_crawl"))).toEqual([
      `ingest_day=${DAY}`,
    ]);
    const manifest = await readCrawlManifest(buildDir);
    expect(manifest?.days).toEqual({ [DAY]: [segment.sha256] });

    const [match] = await rows(
      "matches_crawl",
      "SELECT count(*) AS n, count(DISTINCT puuid) AS players, any_value(ingest_day) AS day, any_value(bracket_tier) AS tier, any_value(crawl_depth) AS depth, any_value(queue_id) AS queue FROM {files}",
    );
    expect(match).toEqual({
      n: 10n,
      players: 10n,
      day: DAY,
      tier: "GOLD",
      depth: 1,
      queue: 420,
    });
    const events = await rows(
      "timeline_events_crawl",
      "SELECT event_id, event_type, item_id, skill_slot FROM {files} ORDER BY event_index",
    );
    expect(events).toEqual([
      {
        event_id: "NA1_9000000001:r:0",
        event_type: "ITEM_PURCHASED",
        item_id: 1055,
        skill_slot: null,
      },
      {
        event_id: "NA1_9000000001:r:1",
        event_type: "SKILL_LEVEL_UP",
        item_id: null,
        skill_slot: 1,
      },
    ]);
  });

  test("never folds a segment twice, even when the inbox file outlived a publish", async () => {
    const segment = await crawlSegment(DAY, ["NA1_9000000002"]);
    await writeCrawlInboxSegment(lakeDir, segment);
    await foldCrawlInbox({
      lakeDir,
      buildDir,
      buildId: "b1",
      loadErased: NO_ERASURES,
      now: NOW,
    });

    const again = await foldCrawlInbox({
      lakeDir,
      buildDir,
      buildId: "b2",
      loadErased: NO_ERASURES,
      now: NOW,
    });

    expect(again.summary).toMatchObject({ segments: 0, alreadyFolded: 1 });
    expect(again.consumed).toHaveLength(1);
    const [count] = await rows(
      "matches_crawl",
      "SELECT count(*) AS n FROM {files}",
    );
    expect(count).toEqual({ n: 10n });
  });

  test("drops a match that names an erased player at fold", async () => {
    const [erasedPuuid] = await crawlFixturePuuids();
    if (erasedPuuid === undefined) throw new Error("fixture has no players");
    const segment = await crawlSegment(DAY, ["NA1_9000000003"]);
    await writeCrawlInboxSegment(lakeDir, segment);

    const { summary } = await foldCrawlInbox({
      lakeDir,
      buildDir,
      buildId: "b1",
      loadErased: () => Promise.resolve(new Set([puuidHash(erasedPuuid)])),
      now: NOW,
    });

    expect(summary).toMatchObject({ segments: 1, erasedMatches: 1 });
    expect(summary.rows.matches_crawl).toBe(0);
    expect(await rows("matches_crawl", "SELECT * FROM {files}")).toEqual([]);
  });

  test("refuses an inbox file whose bytes do not match its name", async () => {
    const segment = await crawlSegment(DAY, ["NA1_9000000004"]);
    const other = await crawlSegment(DAY, ["NA1_9000000005"]);
    await writeCrawlInboxSegment(lakeDir, {
      ...segment,
      bytes: other.bytes,
    });

    await expect(
      foldCrawlInbox({
        lakeDir,
        buildDir,
        buildId: "b1",
        loadErased: NO_ERASURES,
        now: NOW,
      }),
    ).rejects.toThrow(/does not match its bytes/u);
  });

  test("leaves the inbox for the rebuild when the build's crawl schema differs", async () => {
    await writeCrawlManifest(buildDir, {
      crawlSchemaFingerprint: "0000000000000000",
      days: {},
    });
    await writeCrawlInboxSegment(
      lakeDir,
      await crawlSegment(DAY, ["NA1_9000000006"]),
    );

    const { summary, consumed } = await foldCrawlInbox({
      lakeDir,
      buildDir,
      buildId: "b1",
      loadErased: NO_ERASURES,
      now: NOW,
    });

    expect(summary.status).toBe("schema-pending");
    expect(consumed).toEqual([]);
    expect(await listCrawlInbox(lakeDir)).toHaveLength(1);
  });

  test("consumes without folding a segment for a day retention already dropped", async () => {
    await writeCrawlInboxSegment(
      lakeDir,
      await crawlSegment("2026-09-01", ["NA1_9000000007"]),
    );

    const { summary, consumed } = await foldCrawlInbox({
      lakeDir,
      buildDir,
      buildId: "b1",
      loadErased: NO_ERASURES,
      now: NOW,
    });

    expect(summary).toMatchObject({ segments: 0, expired: 1 });
    expect(consumed).toHaveLength(1);
    expect(await readCrawlManifest(buildDir)).toBeUndefined();
  });

  test("an empty inbox reads no erasures and writes nothing", async () => {
    let loaded = false;
    const { summary } = await foldCrawlInbox({
      lakeDir,
      buildDir,
      buildId: "b1",
      loadErased: () => {
        loaded = true;
        return Promise.resolve(new Set<string>());
      },
      now: NOW,
    });
    expect(summary.segments).toBe(0);
    expect(loaded).toBe(false);
    expect(await readdir(buildDir)).toEqual([]);
  });
});
