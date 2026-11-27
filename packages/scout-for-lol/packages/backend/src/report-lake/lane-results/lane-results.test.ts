import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, test } from "vitest";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type {
  TimelineCoverageLakeRow,
  TimelineParticipantFrameLakeRow,
} from "@scout-for-lol/data";
import {
  LAKE_PREDECESSOR_SCHEMA_FINGERPRINT,
  lakeMonth,
  lakeSchemaFingerprint,
  lakeTimestamp,
} from "#src/report-lake/schema.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import { timelineStagingFilePath } from "#src/report-lake/staging.ts";
import {
  writeLaneResultsParquet,
  type LaneResultsWritten,
} from "#src/report-lake/lane-results/derive-lane-results.ts";
import type { LaneResultReadRow } from "#src/report-lake/lane-results/lane-result-columns.ts";
import {
  fetchFullMatch,
  fetchTimelineCheckpointFrames,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import { fetchLaneResultsForMatches } from "#src/reports/duckdb/lake/lane-results-reads.ts";
import { resolveLakeFiles } from "#src/reports/duckdb/lake.ts";
import {
  buildRoleMatchups,
  LANE_DELTA_CHECKPOINT_MS,
  type RoleCheckpoint,
  type RoleMatchup,
} from "#src/reports/lanes/role-matchups.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";
import { testFrameRow } from "#src/testing/report-lake/test-timeline-rows.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";

/**
 * `lane_results` against the match page's own lane read: the same lake, read
 * through `fetchFullMatch` + `fetchTimelineCheckpointFrames` +
 * `buildRoleMatchups`, must say the same thing about every laner at 15:00.
 */

const serverId = testGuildId("7300");
const createdAt = new Date("2026-11-20T18:00:00.000Z");
const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
/** Riot stamps each minute's frame this far past the minute. */
const RIOT_FRAME_JITTER_MS = 303;

const ranked = RiotMatchIdSchema.parse("NA1_7300000001");
const surrendered = RiotMatchIdSchema.parse("NA1_7300000002");
const noTimeline = RiotMatchIdSchema.parse("NA1_7300000003");
const aram = RiotMatchIdSchema.parse("NA1_7300000004");
const withBot = RiotMatchIdSchema.parse("NA1_7300000005");
const partialFrame = RiotMatchIdSchema.parse("NA1_7300000006");
const ALL_MATCHES = [
  ranked,
  surrendered,
  noTimeline,
  aram,
  withBot,
  partialFrame,
];

function matchFacts(
  matchId: RiotMatchId,
  context: Partial<TestLakeMatchFact> = {},
): TestLakeMatchFact[] {
  return POSITIONS.flatMap((position, index) =>
    [100, 200].map((teamId) => {
      const participantId = teamId === 100 ? index + 1 : index + 6;
      return {
        playerId: participantId,
        playerAlias: `${matchId}-${participantId.toString()}`,
        matchId,
        puuid: testPuuid(`${matchId}-${participantId.toString()}`),
        queue: "solo",
        win: teamId === 100,
        surrendered: false,
        kills: 1,
        deaths: 1,
        assists: 1,
        teamId,
        teamPosition: position,
        championId: 100 + participantId,
        gameCreationAt: createdAt,
        ...context,
      };
    }),
  );
}

/** Gold, CS and XP at `minute` for one participant of a fixture match. */
function frame(
  matchId: RiotMatchId,
  participantId: number,
  minute: number,
  stats: { gold: number; cs: number; xp: number },
): TimelineParticipantFrameLakeRow {
  return {
    ...testFrameRow({
      matchId,
      gameCreationAt: createdAt,
      puuid: testPuuid(`${matchId}-${participantId.toString()}`),
      participantId,
      minute,
      totalGold: stats.gold,
      minions: stats.cs,
      jungle: 0,
    }),
    frame_timestamp_ms: minute * 60_000 + RIOT_FRAME_JITTER_MS,
    xp: stats.xp,
  };
}

/**
 * Every participant's frames up to `lastMinute`. At 14:00 blue leads every
 * lane; at 15:00 the lanes differ — blue ahead top and mid, level jungle,
 * behind bot and support — so reading the 14:00 frame flips three results.
 */
function frames(
  matchId: RiotMatchId,
  lastMinute: number,
): TimelineParticipantFrameLakeRow[] {
  const at15BlueLead = [400, 0, 250, -300, -50];
  return Array.from({ length: lastMinute + 1 }, (_, minute) => minute).flatMap(
    (minute) =>
      POSITIONS.flatMap((_, index) => {
        const lead = minute === 15 ? (at15BlueLead[index] ?? 0) : 100;
        const base = 300 * minute;
        return [
          frame(matchId, index + 1, minute, {
            gold: base + lead,
            cs: 8 * minute + Math.sign(lead) * 3,
            xp: 400 * minute + lead,
          }),
          frame(matchId, index + 6, minute, {
            gold: base,
            cs: 8 * minute,
            xp: 400 * minute,
          }),
        ];
      }),
  );
}

function coverage(matchId: RiotMatchId, frameCount: number) {
  return {
    match_id: matchId,
    month: lakeMonth(createdAt.getTime()),
    observed_at: lakeTimestamp(createdAt.getTime()),
    coverage_state: "complete",
    data_version: "2",
    frame_interval_ms: 60_000,
    frame_count: frameCount,
    event_count: 0,
    participant_count: 10,
    first_frame_timestamp_ms: 0,
    last_frame_timestamp_ms: (frameCount - 1) * 60_000 + RIOT_FRAME_JITTER_MS,
  } satisfies TimelineCoverageLakeRow;
}

/** The fixture lake, minus the ranked match's timeline when `lateTimeline`. */
async function writeFixtureLake(options: {
  lateTimeline: boolean;
}): Promise<string> {
  const lakeDir = await mkdtemp(path.join(tmpdir(), "scout-lane-results-"));
  const botFacts = matchFacts(withBot).map((fact) =>
    fact.playerId === 10 ? { ...fact, participantKind: "bot" as const } : fact,
  );
  await writeTestLake(lakeDir, {
    serverId,
    matchFacts: [
      ...matchFacts(ranked),
      // Ended at 14:30: the last frame is 14:00, so there is no checkpoint.
      ...matchFacts(surrendered, { gameDurationSeconds: 870 }),
      ...matchFacts(noTimeline),
      ...matchFacts(aram, { queueId: 450, gameMode: "ARAM", mapId: 12 }),
      ...botFacts,
      ...matchFacts(partialFrame),
    ],
    timelineFrames: [
      ...(options.lateTimeline ? [] : frames(ranked, 20)),
      ...frames(surrendered, 14),
      ...frames(aram, 16),
      ...frames(withBot, 18),
      // Riot's 15:00 frame for this match omits participant 7.
      ...frames(partialFrame, 18).filter(
        (row) => !(row.frame_index === 15 && row.participant_id === 7),
      ),
    ],
    timelineCoverage: [
      ...(options.lateTimeline ? [] : [coverage(ranked, 21)]),
      coverage(surrendered, 15),
      coverage(aram, 17),
      coverage(withBot, 19),
      coverage(partialFrame, 19),
    ],
  });
  return lakeDir;
}

async function currentBuild(lakeDir: string): Promise<string> {
  const buildDir = await readCurrentBuildDir(lakeDir);
  if (buildDir === undefined) throw new Error("test lake has no build");
  return buildDir;
}

async function recordFingerprint(
  lakeDir: string,
  schemaFingerprint: string,
): Promise<void> {
  await Bun.write(
    path.join(await currentBuild(lakeDir), "manifest.json"),
    JSON.stringify({ schemaFingerprint }),
  );
}

/** Derive into the published build from everything the lake holds now. */
async function derive(
  lakeDir: string,
  scope: "all" | readonly string[],
  derivedAt: Date,
  foldBuildId?: string,
): Promise<LaneResultsWritten> {
  return await writeLaneResultsParquet({
    buildDir: await currentBuild(lakeDir),
    inputs: await resolveLakeFiles(lakeDir),
    scope,
    derivedAt,
    ...(foldBuildId === undefined ? {} : { foldBuildId }),
    timeoutMs: 60_000,
  });
}

async function laneRows(lakeDir: string): Promise<LaneResultReadRow[]> {
  const read = await fetchLaneResultsForMatches({
    matchIds: ALL_MATCHES,
    lakeDir,
  });
  if (read.status === "unavailable") throw new Error("lane results gated");
  return read.rows;
}

type LaneVerdict = {
  matchId: RiotMatchId;
  participantId: number;
  checkpoint: RoleCheckpoint;
  ahead: boolean | null;
  gold: number | null;
  cs: number | null;
  xp: number | null;
};

/** One side of a pairing, in the laner's own terms (`sign` -1 for red). */
function sideVerdict(
  matchId: RiotMatchId,
  participantId: number,
  sign: 1 | -1,
  matchup: RoleMatchup,
): LaneVerdict {
  const { at15, checkpoint } = matchup;
  if (at15 === null) {
    return {
      matchId,
      participantId,
      checkpoint,
      ahead: null,
      gold: null,
      cs: null,
      xp: null,
    };
  }
  return {
    matchId,
    participantId,
    checkpoint,
    ahead: sign * at15.goldDelta > 0,
    gold: sign * at15.goldDelta + 0,
    cs: sign * at15.creepScoreDelta + 0,
    xp: sign * at15.xpDelta + 0,
  };
}

/** What the match page says about each laner, from its own lake reads. */
async function matchPageVerdicts(lakeDir: string): Promise<LaneVerdict[]> {
  const verdicts: LaneVerdict[] = [];
  for (const matchId of ALL_MATCHES) {
    const matchups = buildRoleMatchups({
      rows: await fetchFullMatch({ matchId, lakeDir }),
      frames: await fetchTimelineCheckpointFrames({
        matchId,
        checkpointMs: LANE_DELTA_CHECKPOINT_MS,
        lakeDir,
      }),
    });
    for (const matchup of matchups ?? []) {
      verdicts.push(
        sideVerdict(matchId, matchup.blueParticipantId, 1, matchup),
        sideVerdict(matchId, matchup.redParticipantId, -1, matchup),
      );
    }
  }
  return verdicts.toSorted(
    (left, right) =>
      left.matchId.localeCompare(right.matchId) ||
      left.participantId - right.participantId,
  );
}

function tableCheckpoint(complete: boolean | null): RoleCheckpoint {
  if (complete === null) return "missing";
  return complete ? "complete" : "incomplete";
}

function tableVerdicts(rows: readonly LaneResultReadRow[]): LaneVerdict[] {
  return rows.map((row) => ({
    matchId: row.match_id,
    participantId: row.participant_id,
    checkpoint: tableCheckpoint(row.checkpoint_complete),
    ahead: row.gold_diff_at_15 === null ? null : row.gold_diff_at_15 > 0,
    gold: row.gold_diff_at_15,
    cs: row.cs_diff_at_15,
    xp: row.xp_diff_at_15,
  }));
}

const lakes: string[] = [];
async function fixtureLake(options: { lateTimeline: boolean }) {
  const lakeDir = await writeFixtureLake(options);
  lakes.push(lakeDir);
  return lakeDir;
}

afterAll(async () => {
  await Promise.all(
    lakes.map(async (lakeDir) => rm(lakeDir, { recursive: true, force: true })),
  );
});

describe("lane_results", () => {
  test("agrees with the match page's buildRoleMatchups for every laner", async () => {
    const lakeDir = await fixtureLake({ lateTimeline: false });
    await recordFingerprint(lakeDir, lakeSchemaFingerprint());
    expect(await derive(lakeDir, "all", new Date())).toEqual({
      rows: 50,
      incompleteCheckpointMatches: 1,
    });

    const rows = await laneRows(lakeDir);
    const page = await matchPageVerdicts(lakeDir);
    expect(page).toHaveLength(50);
    expect(tableVerdicts(rows)).toEqual(page);

    // The 15:00 frame is stamped at 900303 ms, so the checkpoint is that
    // frame and not the 14:00 one, where blue led every lane by 100.
    const ranked15 = rows.filter((row) => row.match_id === ranked);
    expect(
      ranked15
        .filter((row) => row.team_id === 100)
        .map((row) => [
          row.role,
          row.gold_diff_at_15,
          row.checkpoint_timestamp_ms,
        ]),
    ).toEqual([
      ["top", 400, 900_303],
      ["jungle", 0, 900_303],
      ["middle", 250, 900_303],
      ["adc", -300, 900_303],
      ["support", -50, 900_303],
    ]);
    // Level gold is not ahead for either side.
    expect(
      ranked15
        .filter((row) => row.role === "jungle")
        .map((row) => row.gold_diff_at_15 !== null && row.gold_diff_at_15 > 0),
    ).toEqual([false, false]);
  });

  test("states each laner's opponent, and nulls without a checkpoint", async () => {
    const lakeDir = await fixtureLake({ lateTimeline: false });
    await recordFingerprint(lakeDir, lakeSchemaFingerprint());
    await derive(lakeDir, "all", new Date());
    const rows = await laneRows(lakeDir);
    const byMatch = (matchId: RiotMatchId) =>
      rows.filter((row) => row.match_id === matchId);

    // ARAM has no lanes.
    expect(byMatch(aram)).toEqual([]);
    const top = byMatch(ranked).find((row) => row.participant_id === 6);
    expect(top).toMatchObject({
      role: "top",
      team_id: 200,
      champion_id: 106,
      opponent_participant_id: 1,
      opponent_champion_id: 101,
      opponent_puuid: testPuuid(`${ranked}-1`),
      win: false,
      has_timeline: true,
      queue_id: 420,
      game_created_ms: createdAt.getTime(),
      gold_diff_at_15: -400,
    });
    // A game shorter than 15 minutes has a timeline but no checkpoint.
    expect(
      byMatch(surrendered).map((row) => [
        row.has_timeline,
        row.checkpoint_timestamp_ms,
        row.gold_diff_at_15,
      ]),
    ).toEqual(Array.from({ length: 10 }, () => [true, null, null]));
    // A match without a timeline still names every laner.
    expect(
      byMatch(noTimeline).map((row) => [row.has_timeline, row.gold_diff_at_15]),
    ).toEqual(Array.from({ length: 10 }, () => [false, null]));
    // A 15:00 frame missing one participant is a stated state: every lane of
    // the match keeps its row and its checkpoint, with no difference.
    expect(
      byMatch(partialFrame).map((row) => [
        row.has_timeline,
        row.checkpoint_timestamp_ms,
        row.checkpoint_complete,
        row.gold_diff_at_15,
      ]),
    ).toEqual(Array.from({ length: 10 }, () => [true, 900_303, false, null]));
    expect(
      byMatch(ranked).every((row) => row.checkpoint_complete === true),
    ).toBe(true);
    expect(
      byMatch(surrendered).every((row) => row.checkpoint_complete === null),
    ).toBe(true);
    // A bot laner keeps its slot with no PUUID.
    const bot = byMatch(withBot).find((row) => row.participant_id === 10);
    expect(bot?.puuid).toBeNull();
    expect(
      byMatch(withBot).find((row) => row.participant_id === 5)?.opponent_puuid,
    ).toBeNull();
  });

  test("folding a late timeline reads the same rows as one rebuild", async () => {
    const rebuilt = await fixtureLake({ lateTimeline: false });
    await recordFingerprint(rebuilt, lakeSchemaFingerprint());
    await derive(rebuilt, "all", new Date("2026-11-21T00:00:00.000Z"));

    // First fold: every match, but the ranked timeline has not arrived.
    const folded = await fixtureLake({ lateTimeline: true });
    await recordFingerprint(folded, lakeSchemaFingerprint());
    const foldBuildId = path.basename(await currentBuild(folded));
    await derive(folded, ALL_MATCHES, new Date("2026-11-21T00:00:00.000Z"));
    const beforeTimeline = await laneRows(folded);
    expect(
      beforeTimeline
        .filter((row) => row.match_id === ranked)
        .every((row) => !row.has_timeline && row.gold_diff_at_15 === null),
    ).toBe(true);

    // Second fold: the timeline is staged and only its match re-derived.
    for (const [table, rows] of [
      ["timeline_participant_frames", frames(ranked, 20)],
      ["timeline_coverage", [coverage(ranked, 21)]],
    ] as const) {
      await Bun.write(
        timelineStagingFilePath(folded, table, ranked),
        rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      );
    }
    expect(
      await derive(
        folded,
        [ranked],
        new Date("2026-11-21T00:05:00.000Z"),
        foldBuildId,
      ),
    ).toEqual({ rows: 10, incompleteCheckpointMatches: 0 });

    expect(await laneRows(folded)).toEqual(await laneRows(rebuilt));
  });

  test("is unavailable until a build at the current schema publishes it", async () => {
    const lakeDir = await fixtureLake({ lateTimeline: false });
    // A build with no recorded schema, or the migration's predecessor.
    expect(
      await fetchLaneResultsForMatches({ matchIds: [ranked], lakeDir }),
    ).toEqual({ status: "unavailable" });
    await recordFingerprint(lakeDir, LAKE_PREDECESSOR_SCHEMA_FINGERPRINT);
    expect(
      await fetchLaneResultsForMatches({ matchIds: [ranked], lakeDir }),
    ).toEqual({ status: "unavailable" });
    // The current schema with nothing derived yet is available and empty.
    await recordFingerprint(lakeDir, lakeSchemaFingerprint());
    expect(
      await fetchLaneResultsForMatches({ matchIds: [ranked], lakeDir }),
    ).toEqual({ status: "available", rows: [] });
  });
});
