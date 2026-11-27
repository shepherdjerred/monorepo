import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { encodeSegment } from "#src/league/crawl/crawl-segment.ts";
import {
  compactCrawlDay,
  rebuildCrawlDay,
} from "#src/report-lake/crawl/crawl-maintenance.ts";
import {
  emptyCrawlManifest,
  writeCrawlManifest,
} from "#src/report-lake/crawl/crawl-manifest.ts";
import {
  META_PARTIALS_TABLE,
  META_PARTIALS_VERSION,
} from "#src/report-lake/crawl/meta-partials.ts";
import { LANE_CHECKPOINT_MS } from "#src/report-lake/crawl/meta-partials-lane.ts";
import { CHECKPOINT_TIMES_MS } from "#src/league/crawl/crawl-records.ts";
import { createLakeMetaReader } from "#src/meta/meta-reader.ts";
import { rollUpMeta } from "#src/meta/meta-rollup.ts";
import { wilsonInterval } from "#src/meta/wilson.ts";
import { MATCH_LOADOUT_LAKE_COLUMNS_SQL } from "#src/report-lake/loadout.ts";
import {
  MatchParticipantRowSchema,
  type LakeMatchParticipantRow,
  type LaneDeltaFrame,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { buildRoleMatchups } from "#src/trpc/router/consumer/consumer-match-role-matchups.ts";
import {
  crawlRecord,
  memoryCrawlSegmentSource,
  type CrawlRecordOptions,
} from "#src/testing/report-lake/crawl-segments.ts";

/**
 * Lane partials (`lane`, `lane_matchup`) and their serving, against temp build
 * directories and DuckDB. Every match is the same real Summoner's Rift game
 * under a different id: blue is participants 1 to 5 (Irelia top, Lissandra
 * mid) and red 6 to 10 (Volibear top, Seraphine mid). Unless a match says
 * otherwise, red has more gold than blue at 15:00 (gold grows with the
 * participant id).
 */

const NOW = new Date("2026-11-14T03:00:00.000Z");
const DAY = "2026-11-13";
const OLDER_DAY = "2026-11-10";
const SMALL = { minSliceGames: 1, minEntryGames: 1, minMatchupGames: 1 };
const NO_ERASURES = new Set<string>();

const FRAME_AT_10 = { atMs: 600_000, frameMs: 600_249 };

const BLUE_TOP = 1;
const RED_TOP = 6;
const DEFAULT_GOLD = (participantId: number, atMs: number) =>
  atMs / 100 + participantId * 50;

type FixtureMatch = { id: string; options: CrawlRecordOptions };

const MATCHES: readonly FixtureMatch[] = [
  // Red is ahead in every lane.
  { id: "NA1_9800000001", options: {} },
  // Blue top is ahead of red top; every other lane is as in the default.
  {
    id: "NA1_9800000002",
    options: {
      goldAt: (participantId, atMs) =>
        participantId === BLUE_TOP ? 20_000 : DEFAULT_GOLD(participantId, atMs),
    },
  },
  // Top lane is tied: neither side is ahead.
  {
    id: "NA1_9800000003",
    options: {
      goldAt: (participantId, atMs) =>
        participantId === BLUE_TOP || participantId === RED_TOP
          ? 9000
          : DEFAULT_GOLD(participantId, atMs),
    },
  },
  // A game under 15 minutes: its timeline ended after the 10:00 checkpoint.
  { id: "NA1_9800000004", options: { checkpoints: [FRAME_AT_10] } },
  // A match whose timeline was not sampled.
  { id: "NA1_9800000005", options: { withTimeline: false } },
];

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "meta-lane-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Fold each day's matches into one build and compact them into v3 partials. */
async function buildWith(
  id: string,
  days: readonly { day: string; matches: readonly FixtureMatch[] }[],
): Promise<string> {
  const buildDir = path.join(root, "builds", id);
  await mkdir(buildDir, { recursive: true });
  const manifest = emptyCrawlManifest();
  for (const { day, matches } of days) {
    const records = await Promise.all(
      matches.map(async (match) => await crawlRecord(match.id, match.options)),
    );
    const segment = encodeSegment({ route: "na1", dt: day, records });
    await rebuildCrawlDay({
      buildDir,
      buildId: `${id}-${day}`,
      day,
      manifest,
      segments: [{ ...segment }],
      source: memoryCrawlSegmentSource([segment]),
      erased: NO_ERASURES,
    });
  }
  await writeCrawlManifest(buildDir, manifest);
  for (const { day } of days) {
    await compactCrawlDay({
      buildDir,
      buildId: `${id}-c-${day}`,
      day,
      erased: NO_ERASURES,
    });
  }
  return buildDir;
}

const PartialRowSchema = z.object({
  kind: z.string(),
  champion_id: z.number(),
  role: z.string(),
  key1: z.string(),
  games: z.union([z.bigint(), z.number()]).transform(Number),
  wins: z.union([z.bigint(), z.number()]).transform(Number),
});

function files(buildDir: string, table: string, day: string): string[] {
  return [
    ...new Bun.Glob(`${table}/ingest_day=${day}/*.parquet`).scanSync({
      cwd: buildDir,
      absolute: true,
    }),
  ];
}

async function partialRows(buildDir: string, day = DAY) {
  const raw = await withDuckDBConnection(
    async (session) =>
      await session.run(
        `SELECT kind, champion_id, role, key1, games, wins FROM read_parquet($1, hive_partitioning = false) ORDER BY ALL`,
        [session.list(files(buildDir, META_PARTIALS_TABLE, day))],
      ),
  );
  return raw.map((row) => PartialRowSchema.parse(row));
}

type Partials = Awaited<ReturnType<typeof partialRows>>;

function championIds(rows: Partials): Map<string, number> {
  return new Map(
    rows
      .filter((row) => row.kind === "champion")
      .map((row) => [row.key1, row.champion_id]),
  );
}

function figure(rows: Partials, kind: string, champion: number, key1?: string) {
  const found = rows.find(
    (row) =>
      row.kind === kind &&
      row.champion_id === champion &&
      (key1 === undefined || row.key1 === key1),
  );
  return found === undefined ? undefined : [found.games, found.wins];
}

function championOf(
  rows: readonly LakeMatchParticipantRow[],
  participantId: number,
): number {
  const found = rows.find((row) => row.participant_id === participantId);
  if (found === undefined)
    throw new Error(`no participant ${participantId.toString()}`);
  return found.champion_id;
}

describe("lane partials", () => {
  test("the lane checkpoint is one the crawl keeps", () => {
    const kept: readonly number[] = CHECKPOINT_TIMES_MS;
    expect(kept).toContain(LANE_CHECKPOINT_MS);
    expect(LANE_CHECKPOINT_MS).toBe(15 * 60_000);
  });

  test("the partials definition is version 3 and its files say so", async () => {
    expect(META_PARTIALS_VERSION).toBe(3);
    const buildDir = await buildWith("version", [
      { day: DAY, matches: MATCHES },
    ]);
    const names = files(buildDir, META_PARTIALS_TABLE, DAY);
    expect(names).toHaveLength(1);
    expect(path.basename(names[0] ?? "")).toMatch(/^partials-v3-/u);
  });

  test("counts games with a 15:00 checkpoint and the games ahead, per champion and per matchup", async () => {
    const buildDir = await buildWith("counts", [
      { day: DAY, matches: MATCHES },
    ]);
    const rows = await partialRows(buildDir);
    const ids = championIds(rows);
    const id = (name: string) => {
      const found = ids.get(name);
      if (found === undefined) throw new Error(`no champion ${name}`);
      return found;
    };

    // Every match is a game; only three have a 15:00 checkpoint.
    expect(figure(rows, "champion", id("Irelia"))).toEqual([5, 0]);
    expect(
      figure(rows, "matchup", id("Irelia"), String(id("Volibear"))),
    ).toEqual([5, 0]);

    // Irelia led once (match 2), tied once (match 3, not ahead) and trailed once.
    expect(figure(rows, "lane", id("Irelia"))).toEqual([3, 1]);
    expect(figure(rows, "lane", id("Volibear"))).toEqual([3, 1]);
    expect(
      figure(rows, "lane_matchup", id("Irelia"), String(id("Volibear"))),
    ).toEqual([3, 1]);
    expect(
      figure(rows, "lane_matchup", id("Volibear"), String(id("Irelia"))),
    ).toEqual([3, 1]);

    // Red is ahead in the other lanes whenever there is a checkpoint.
    expect(figure(rows, "lane", id("Seraphine"))).toEqual([3, 3]);
    expect(figure(rows, "lane", id("Lissandra"))).toEqual([3, 0]);

    // A tie never counts for either side: the two top laners' leads sum to
    // fewer games than they both played.
    const topAhead =
      (figure(rows, "lane", id("Irelia"))?.[1] ?? 0) +
      (figure(rows, "lane", id("Volibear"))?.[1] ?? 0);
    expect(topAhead).toBe(2);
  });

  test("a build with no checkpoints has no lane rows but keeps its games", async () => {
    const buildDir = await buildWith("none", [
      {
        day: DAY,
        matches: MATCHES.filter(
          (match) =>
            match.options.withTimeline === false ||
            match.options.checkpoints !== undefined,
        ),
      },
    ]);
    const rows = await partialRows(buildDir);
    expect(rows.filter((row) => row.kind.startsWith("lane"))).toEqual([]);
    expect(
      figure(rows, "champion", championIds(rows).get("Irelia") ?? 0),
    ).toEqual([2, 0]);
  });

  test("agrees with the app's buildRoleMatchups on the same games", async () => {
    const buildDir = await buildWith("parity", [
      { day: DAY, matches: MATCHES },
    ]);
    const { participants, checkpoints } = await withDuckDBConnection(
      async (session) => ({
        participants: await session.run(
          `SELECT match_id, epoch_ms(game_creation_at)::BIGINT AS game_creation_ms,
             game_duration_seconds, queue, queue_id, game_mode, game_type, game_version, map_id,
             puuid, participant_id, team_id, player_subteam_id, placement, subteam_placement,
             augment_1_id, augment_2_id, augment_3_id, augment_4_id, augment_5_id, augment_6_id,
             riot_id_game_name, riot_id_tagline,
             champion_id, champion_name, team_position, win, kills, deaths, assists, creep_score,
             gold_earned, vision_score, total_damage_dealt_to_champions, turret_kills,
             inhibitor_kills, baron_kills, dragon_kills, ${MATCH_LOADOUT_LAKE_COLUMNS_SQL}
           FROM read_parquet($1, hive_partitioning = false) ORDER BY match_id, participant_id`,
          [session.list(files(buildDir, "matches_crawl", DAY))],
        ),
        checkpoints: await session.run(
          `SELECT match_id, participant_id, frame_timestamp_ms, total_gold, xp, minions
           FROM read_parquet($1, hive_partitioning = false) WHERE checkpoint_ms = ${LANE_CHECKPOINT_MS.toString()}`,
          [session.list(files(buildDir, "timeline_checkpoints_crawl", DAY))],
        ),
      }),
    );
    const matchRows = participants.map((row) =>
      MatchParticipantRowSchema.parse(row),
    );
    const CheckpointSchema = z.object({
      match_id: z.string(),
      participant_id: z.number(),
      frame_timestamp_ms: z.number(),
      total_gold: z.number(),
      xp: z.number(),
      minions: z.number(),
    });
    const frames = checkpoints.map((row) => CheckpointSchema.parse(row));

    // Count, for each champion, the games `buildRoleMatchups` calls a lead.
    const byChampion = new Map<number, { games: number; ahead: number }>();
    const rowsByMatch = Map.groupBy(matchRows, (row) => row.match_id);
    for (const [matchId, rows] of rowsByMatch) {
      const laneFrames: LaneDeltaFrame[] = frames
        .filter((frame) => frame.match_id === matchId)
        .map((frame) => ({
          participant_id: frame.participant_id,
          frame_timestamp_ms: frame.frame_timestamp_ms,
          total_gold: frame.total_gold,
          minions_killed: frame.minions,
          jungle_minions_killed: 0,
          xp: frame.xp,
        }));
      const matchups = buildRoleMatchups({ rows, frames: laneFrames });
      for (const matchup of matchups ?? []) {
        if (matchup.at15 === null) continue;
        for (const [participantId, ahead] of [
          [matchup.blueParticipantId, matchup.at15.goldDelta > 0],
          [matchup.redParticipantId, matchup.at15.goldDelta < 0],
        ] as const) {
          const champion = championOf(rows, participantId);
          const current = byChampion.get(champion) ?? { games: 0, ahead: 0 };
          byChampion.set(champion, {
            games: current.games + 1,
            ahead: current.ahead + (ahead ? 1 : 0),
          });
        }
      }
    }

    const partials = await partialRows(buildDir);
    const lane = partials.filter((row) => row.kind === "lane");
    expect(lane).toHaveLength(10);
    expect(byChampion.size).toBe(10);
    for (const row of lane) {
      expect(byChampion.get(row.champion_id)).toEqual({
        games: row.games,
        ahead: row.wins,
      });
    }
  });
});

async function serve(
  buildDir: string,
  thresholds: {
    minSliceGames: number;
    minEntryGames: number;
    minMatchupGames: number;
  },
) {
  await rollUpMeta({ buildDir, buildId: "lane", now: NOW, thresholds });
  const meta = createLakeMetaReader(() => Promise.resolve(buildDir));
  const manifest = await meta.manifest();
  const irelia = manifest?.champions.find((one) => one.name === "Irelia");
  const champion = await meta.champion(irelia?.id ?? 0);
  const matchups = await meta.matchups(irelia?.id ?? 0);
  return {
    manifest,
    slice: champion?.slices.find((one) => one.context.bracket === "all"),
    opponent: matchups?.slices.find((one) => one.context.bracket === "all")
      ?.opponents[0],
  };
}

describe("lane figures served", () => {
  test("carries the game count and a Wilson interval, over the days that have lane data", async () => {
    const buildDir = await buildWith("served", [
      {
        day: OLDER_DAY,
        matches: [{ id: "NA1_9800000101", options: { withTimeline: false } }],
      },
      { day: DAY, matches: MATCHES },
    ]);
    const served = await serve(buildDir, SMALL);

    expect(served.slice?.lane).toEqual({
      games: 3,
      ahead: 1,
      aheadRate: wilsonInterval(1, 3),
      share: wilsonInterval(3, 6),
      denominator: "slice_games",
    });
    expect(served.opponent?.lane).toEqual({
      games: 3,
      ahead: 1,
      aheadRate: wilsonInterval(1, 3),
      share: wilsonInterval(3, 6),
      denominator: "matchup_games",
    });
    // The counts the figures sit beside are all games, with and without a checkpoint.
    expect(served.slice?.sample.games).toBe(6);
    expect(served.opponent?.games).toBe(6);

    // The older day was crawled without checkpoints: the lane window starts later.
    expect(served.manifest?.source).toMatchObject({
      firstDay: OLDER_DAY,
      lastDay: DAY,
      days: 2,
    });
    expect(served.manifest?.lane).toEqual({
      firstDay: DAY,
      lastDay: DAY,
      days: 1,
    });
  });

  test("omits a lane figure below its floor: entry floor for a slice, matchup floor for a matchup", async () => {
    const buildDir = await buildWith("floors", [
      { day: DAY, matches: MATCHES },
    ]);
    // Three lane games meet an entry floor of 3 but not a matchup floor of 4,
    // and the matchup itself (5 games) is still listed at that floor.
    const split = await serve(buildDir, {
      minSliceGames: 1,
      minEntryGames: 3,
      minMatchupGames: 4,
    });
    expect(split.slice?.lane?.games).toBe(3);
    expect(split.opponent?.games).toBe(5);
    expect(split.opponent?.lane).toBeUndefined();

    const strict = await serve(buildDir, {
      minSliceGames: 1,
      minEntryGames: 4,
      minMatchupGames: 3,
    });
    expect(strict.slice?.lane).toBeUndefined();
    expect(strict.opponent?.lane?.games).toBe(3);
  });

  test("a build with no lane data states no lane window and serves no lane figures", async () => {
    const buildDir = await buildWith("nolane", [
      {
        day: DAY,
        matches: [{ id: "NA1_9800000201", options: { withTimeline: false } }],
      },
    ]);
    const served = await serve(buildDir, SMALL);
    expect(served.manifest?.lane).toBeNull();
    expect(served.slice?.lane).toBeUndefined();
    expect(served.opponent?.lane).toBeUndefined();
  });
});
