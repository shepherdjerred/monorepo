import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { z } from "zod";
import {
  RawMatchSchema,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  reportLakeMigrationPending,
  runReportLakeFold,
  runReportLakeRebuild,
} from "#src/report-lake/compactor.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import {
  LAKE_PREDECESSOR_SCHEMA_FINGERPRINT,
  lakeSchemaFingerprint,
} from "#src/report-lake/schema.ts";
import {
  writeMatchStagingFile,
  writeTimelineStagingFiles,
} from "#src/report-lake/staging.ts";
import { LANE_RESULTS_TABLE } from "#src/report-lake/lane-results/lane-result-columns.ts";
import {
  matchObjectKey,
  timelineObjectKey,
} from "#src/report-store/s3-raw-source.ts";
import {
  fetchFullMatch,
  fetchTimelineCheckpointFrames,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import {
  fetchLaneResultsForMatches,
  type LaneResultsRead,
} from "#src/reports/duckdb/lake/lane-results-reads.ts";
import {
  buildRoleMatchups,
  LANE_DELTA_CHECKPOINT_MS,
} from "#src/trpc/router/consumer/consumer-match-role-matchups.ts";
import { dareSqlTimelineForMatch } from "#src/dares/sql/dare-sql-test-fixture.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

/**
 * `lane_results` through the real fold and rebuild tiers: a match folded
 * before its timeline, then the timeline folded, holds the same rows as one
 * rebuild from S3; and a lake published at the predecessor schema is migrated
 * by the next fold.
 */

const { prisma } = createTestDatabase("lane-results-test");
const s3Mock = mockClient(S3Client);
const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
/** At 15:00 blue leads top and mid, is level in jungle, trails bot lane. */
const BLUE_LEAD_AT_15 = [400, 0, 250, -300, -50];

/** The Arena fixture reshaped into a ranked Summoner's Rift game. */
async function rankedRiftMatch(): Promise<RawMatch> {
  const fixture = RawMatchSchema.parse(
    await Bun.file(
      new URL(
        "../../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
        import.meta.url,
      ),
    ).json(),
  );
  const participants = fixture.info.participants
    .slice(0, 10)
    .map((participant, index) => {
      const teamId = index < 5 ? 100 : 200;
      return {
        ...participant,
        participantId: index + 1,
        teamId,
        teamPosition: POSITIONS[index % 5] ?? "",
        individualPosition: POSITIONS[index % 5] ?? "",
        win: teamId === 100,
        playerSubteamId: 0,
        subteamPlacement: 0,
        placement: 0,
      };
    });
  const team = fixture.info.teams[0];
  if (team === undefined) throw new Error("fixture has no team");
  return RawMatchSchema.parse({
    ...fixture,
    metadata: {
      ...fixture.metadata,
      matchId: "NA1_7400000001",
      participants: participants.map((participant) => participant.puuid),
    },
    info: {
      ...fixture.info,
      queueId: 420,
      mapId: 11,
      gameMode: "CLASSIC",
      gameType: "MATCHED_GAME",
      participants,
      teams: [
        { ...team, teamId: 100, win: true, bans: [] },
        { ...team, teamId: 200, win: false, bans: [] },
      ],
    },
  });
}

/** Frames through 20:00, each stamped 303 ms past its minute as Riot does. */
function timelineFor(match: RawMatch): RawTimeline {
  const frames = Array.from({ length: 21 }, (_, minute) => ({
    timestamp: minute === 0 ? 0 : minute * 60_000 + 303,
    events: [],
    participantFrames: Object.fromEntries(
      match.info.participants.map((participant) => {
        const lane = (participant.participantId - 1) % 5;
        const blue = participant.teamId === 100;
        const lead = minute === 15 ? (BLUE_LEAD_AT_15[lane] ?? 0) : 100;
        return [
          participant.participantId.toString(),
          {
            participantId: participant.participantId,
            currentGold: 0,
            totalGold: 300 * minute + (blue ? lead : 0),
            goldPerSecond: 0,
            jungleMinionsKilled: 0,
            minionsKilled: 8 * minute + (blue ? Math.sign(lead) * 3 : 0),
            level: 1,
            xp: 400 * minute + (blue ? lead : 0),
            position: { x: 0, y: 0 },
            timeEnemySpentControlled: 0,
          },
        ];
      }),
    ),
  }));
  return dareSqlTimelineForMatch(match, frames);
}

function seedS3(objects: { key: string; body: string }[]): void {
  s3Mock.reset();
  s3Mock
    .on(ListObjectsV2Command, { Prefix: "games/" })
    .resolves({ Contents: objects.map((object) => ({ Key: object.key })) });
  for (const prefix of ["prematch/", "leaderboards/"]) {
    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [],
    });
  }
  for (const object of objects) {
    s3Mock.on(GetObjectCommand, { Key: object.key }).callsFake(() => ({
      Body: { transformToString: () => Promise.resolve(object.body) },
      $metadata: {},
    }));
  }
}

function seedS3Game(match: RawMatch, timeline: RawTimeline): void {
  const keyDate = new Date(match.info.gameCreation);
  seedS3([
    {
      key: matchObjectKey(match.metadata.matchId, keyDate),
      body: JSON.stringify(match),
    },
    {
      key: timelineObjectKey(match.metadata.matchId, keyDate),
      body: JSON.stringify(timeline),
    },
  ]);
}

const lakes: string[] = [];
async function makeLakeDir(): Promise<string> {
  const lakeDir = await mkdtemp(path.join(tmpdir(), "lane-results-int-"));
  lakes.push(lakeDir);
  return lakeDir;
}

async function readLane(
  lakeDir: string,
  match: RawMatch,
): Promise<LaneResultsRead> {
  return await fetchLaneResultsForMatches({
    matchIds: [match.metadata.matchId],
    lakeDir,
  });
}

async function availableRows(lakeDir: string, match: RawMatch) {
  const read = await readLane(lakeDir, match);
  if (read.status === "unavailable") throw new Error("lane results gated");
  return read.rows;
}

const ManifestSchema = z.looseObject({
  schemaFingerprint: z.string(),
  laneResultRows: z.number(),
});

async function publishedManifest(lakeDir: string) {
  const buildDir = await readCurrentBuildDir(lakeDir);
  if (buildDir === undefined) throw new Error("no published build");
  return ManifestSchema.parse(
    await Bun.file(path.join(buildDir, "manifest.json")).json(),
  );
}

/**
 * Rewrite the published build into the predecessor's layout: no
 * `lane_results`, and a manifest naming that schema. This is the build Beta
 * and Prod have published when the migration deploys.
 */
async function downgradeToPredecessor(lakeDir: string): Promise<string> {
  const buildDir = await readCurrentBuildDir(lakeDir);
  if (buildDir === undefined) throw new Error("no published build");
  await rm(path.join(buildDir, LANE_RESULTS_TABLE), {
    recursive: true,
    force: true,
  });
  const manifestPath = path.join(buildDir, "manifest.json");
  const manifest = z.looseObject({}).parse(await Bun.file(manifestPath).json());
  await Bun.write(
    manifestPath,
    JSON.stringify({
      ...manifest,
      schemaFingerprint: LAKE_PREDECESSOR_SCHEMA_FINGERPRINT,
    }),
  );
  return buildDir;
}

beforeEach(() => {
  Bun.env["S3_BUCKET_NAME"] = "test-bucket";
  resetConfigurationForTests();
  seedS3([]);
});

afterAll(async () => {
  s3Mock.reset();
  await Promise.all(
    lakes.map(async (lakeDir) => rm(lakeDir, { recursive: true, force: true })),
  );
  await prisma.$disconnect();
});

describe("lane_results through fold and rebuild", () => {
  test("a match folded before its timeline ends with the rebuild's rows", async () => {
    const match = await rankedRiftMatch();
    const timeline = timelineFor(match);

    const folded = await makeLakeDir();
    await runReportLakeRebuild({ prisma, lakeDir: folded });
    expect(await writeMatchStagingFile(folded, match)).toBe(true);
    const matchFold = await runReportLakeFold({ prisma, lakeDir: folded });
    expect(matchFold.tier).toBe("fold");
    expect(matchFold.laneResultRows).toBe(10);
    const beforeTimeline = await availableRows(folded, match);
    expect(
      beforeTimeline.map((row) => [row.has_timeline, row.gold_diff_at_15]),
    ).toEqual(Array.from({ length: 10 }, () => [false, null]));

    expect(
      await writeTimelineStagingFiles(
        folded,
        timeline,
        new Date(match.info.gameEndTimestamp),
      ),
    ).toBe(true);
    const timelineFold = await runReportLakeFold({ prisma, lakeDir: folded });
    expect(timelineFold.laneResultRows).toBe(10);

    const rebuilt = await makeLakeDir();
    seedS3Game(match, timeline);
    const rebuild = await runReportLakeRebuild({ prisma, lakeDir: rebuilt });
    expect(rebuild.laneResultRows).toBe(10);
    expect(await publishedManifest(rebuilt)).toMatchObject({
      schemaFingerprint: lakeSchemaFingerprint(),
      laneResultRows: 10,
    });

    const rebuiltRows = await availableRows(rebuilt, match);
    expect(await availableRows(folded, match)).toEqual(rebuiltRows);

    // The match page reads the same verdict from the same lake.
    const matchups = buildRoleMatchups({
      rows: await fetchFullMatch({
        matchId: match.metadata.matchId,
        lakeDir: rebuilt,
      }),
      frames: await fetchTimelineCheckpointFrames({
        matchId: match.metadata.matchId,
        checkpointMs: LANE_DELTA_CHECKPOINT_MS,
        lakeDir: rebuilt,
      }),
    });
    expect(
      rebuiltRows
        .filter((row) => row.team_id === 100)
        .map((row) => row.gold_diff_at_15),
    ).toEqual(matchups?.map((matchup) => matchup.at15?.goldDelta));
    expect(
      rebuiltRows
        .filter((row) => row.team_id === 100)
        .map((row) => row.gold_diff_at_15),
    ).toEqual(BLUE_LEAD_AT_15);
  });

  test("a predecessor-schema lake is unavailable until the next fold rebuilds it", async () => {
    const match = await rankedRiftMatch();
    seedS3Game(match, timelineFor(match));
    const lakeDir = await makeLakeDir();
    await runReportLakeRebuild({ prisma, lakeDir });
    const before = await availableRows(lakeDir, match);
    const predecessor = await downgradeToPredecessor(lakeDir);

    expect(await readLane(lakeDir, match)).toEqual({ status: "unavailable" });
    // Inline folders (boot, imports) see the pending migration and skip.
    expect(await reportLakeMigrationPending(lakeDir)).toBe(true);

    const migrated = await runReportLakeFold({ prisma, lakeDir });

    expect(migrated.tier).toBe("rebuild");
    expect(migrated.laneResultRows).toBe(10);
    expect(await reportLakeMigrationPending(lakeDir)).toBe(false);
    expect(await readCurrentBuildDir(lakeDir)).not.toBe(predecessor);
    expect(await availableRows(lakeDir, match)).toEqual(before);
    // The migration is one-time: the next fold is an ordinary fold.
    const next = await runReportLakeFold({ prisma, lakeDir });
    expect(next.tier).toBe("fold");
  });
});
