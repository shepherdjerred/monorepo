import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import {
  LeaguePuuidSchema,
  RawMatchSchema,
  type DiscordAccountId,
  type LeaguePuuid,
  type RawMatch,
} from "@scout-for-lol/data";
import { z } from "zod";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import {
  runReportLakeFold,
  runReportLakeRebuild,
} from "#src/report-lake/compactor.ts";
import { flattenMatch, flattenPrematch } from "#src/report-lake/flatten.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import { matchObjectKey } from "#src/report-store/s3-raw-source.ts";
import {
  listStagingFiles,
  writeMatchStagingFile,
} from "#src/report-lake/staging.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";

const { prisma } = createTestDatabase("report-lake-test");
const serverId = testGuildId("888");
const creatorDiscordId = testAccountId("888");

// The full rebuild reads canonical raw JSON from S3 (SeaweedFS). Mock it
// in-memory: ListObjectsV2 enumerates the seeded objects for the requested
// prefix, GetObject returns each object's JSON body. A GetObject Body carries an
// SdkStream that can't be constructed in test code, so we return a partial mock
// (Body.transformToString) via callsFake(), which accepts any return type.
const s3Mock = mockClient(S3Client);

function mockGetObjectResponse(content: string) {
  return {
    Body: { transformToString: () => Promise.resolve(content) },
    $metadata: {},
  };
}

/**
 * Seed the S3 mock with raw match objects keyed exactly as the live write path
 * would (games/{yyyy}/{MM}/{dd}/{matchId}/match.json). The rebuild lists the
 * "games/" prefix, then the "prematch/" prefix (unmocked → empty).
 */
function seedS3Matches(objects: { key: string; body: string }[]): void {
  s3Mock.reset();
  // The rebuild lists the "games/" prefix (match objects) then "prematch/".
  // Mock both prefixes explicitly so every call has an exact matcher.
  s3Mock
    .on(ListObjectsV2Command, { Prefix: "games/" })
    .resolves({ Contents: objects.map((o) => ({ Key: o.key })) });
  s3Mock.on(ListObjectsV2Command, { Prefix: "prematch/" }).resolves({
    Contents: [],
  });
  for (const object of objects) {
    s3Mock
      .on(GetObjectCommand, { Key: object.key })
      .callsFake(() => mockGetObjectResponse(object.body));
  }
}

const CountRowSchema = z.object({
  n: z.union([z.bigint(), z.number()]).transform(Number),
});

const ManifestSchema = z.object({
  skippedMatches: z.number(),
  skippedPrematches: z.number(),
});

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(json);
}

async function createTrackedPlayer(params: {
  alias: string;
  puuid: LeaguePuuid;
  discordId: DiscordAccountId;
}) {
  const now = new Date();
  const player = await prisma.player.create({
    data: {
      alias: params.alias,
      discordId: params.discordId,
      serverId,
      creatorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
  await prisma.account.create({
    data: {
      alias: params.alias,
      puuid: params.puuid,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId,
      creatorDiscordId,
      createdTime: now,
      updatedTime: now,
    },
  });
}

async function makeLakeDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "report-lake-int-"));
}

async function countParquetRows(glob: string): Promise<number> {
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      `SELECT COUNT(*)::BIGINT AS n FROM read_parquet($1)`,
      [glob],
    );
    return CountRowSchema.parse(rows[0]).n;
  });
}

beforeEach(async () => {
  Bun.env["S3_BUCKET_NAME"] = "test-bucket";
  resetConfigurationForTests();
  s3Mock.reset();
  // Default: an empty lake (both prefixes). Tests that need seeded objects call
  // seedS3Matches, which resets and re-declares these matchers.
  s3Mock.on(ListObjectsV2Command, { Prefix: "games/" }).resolves({
    Contents: [],
  });
  s3Mock.on(ListObjectsV2Command, { Prefix: "prematch/" }).resolves({
    Contents: [],
  });
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
});

afterAll(async () => {
  s3Mock.reset();
  await prisma.$disconnect();
});

describe("flatten", () => {
  test("flattenMatch produces one row per participant with store.ts derivations", async () => {
    const match = await loadMatchFixture();
    const rows = flattenMatch(match);
    expect(rows.length).toBe(match.info.participants.length);

    for (const [index, participant] of match.info.participants.entries()) {
      const row = rows[index];
      if (row === undefined) {
        throw new Error("row missing");
      }
      expect(row.puuid).toBe(participant.puuid);
      const takedowns = participant.kills + participant.assists;
      expect(row.kda).toBe(
        participant.deaths === 0 ? takedowns : takedowns / participant.deaths,
      );
      expect(row.creep_score).toBe(
        participant.totalMinionsKilled + participant.neutralMinionsKilled,
      );
      expect(row.surrendered).toBe(
        participant.gameEndedInSurrender || participant.teamEarlySurrendered,
      );
      expect(row.early_surrendered).toBe(
        participant.gameEndedInEarlySurrender ||
          participant.teamEarlySurrendered,
      );
      expect(row.month).toBe(
        new Date(match.info.gameCreation).toISOString().slice(0, 7),
      );
    }
  });

  test("flattenPrematch skips privacy-scrubbed (null puuid) participants", () => {
    const observedAt = new Date("2026-07-01T12:00:00Z");
    const rows = flattenPrematch(
      {
        gameId: 123,
        gameStartTime: 0,
        gameMode: "CLASSIC",
        mapId: 11,
        gameType: "MATCHED_GAME",
        gameQueueConfigId: 420,
        gameLength: -30,
        platformId: "NA1",
        participants: [
          {
            championId: 1,
            puuid: "real-puuid",
            teamId: 100,
            riotId: "Player#NA1",
            spell1Id: 4,
            spell2Id: 7,
            lastSelectedSkinIndex: 0,
            bot: false,
            profileIconId: 1,
          },
          {
            championId: 2,
            puuid: null,
            teamId: 200,
            riotId: "Aatrox",
            spell1Id: 4,
            spell2Id: 7,
            lastSelectedSkinIndex: 0,
            bot: false,
            profileIconId: 1,
          },
        ],
        bannedChampions: [],
      },
      observedAt,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.puuid).toBe("real-puuid");
    expect(rows[0]?.game_start_at).toBeNull();
  });
});

describe("compactor", () => {
  test("rebuild publishes a build with parquet, accounts, and manifest", async () => {
    const match = await loadMatchFixture();
    const firstPuuid = match.metadata.participants[0];
    if (firstPuuid === undefined) {
      throw new Error("fixture has no participants");
    }
    await createTrackedPlayer({
      alias: "LakePlayer",
      puuid: LeaguePuuidSchema.parse(firstPuuid),
      discordId: testAccountId("999"),
    });
    seedS3Matches([
      {
        key: matchObjectKey(
          match.metadata.matchId,
          new Date(match.info.gameCreation),
        ),
        body: JSON.stringify(match),
      },
    ]);

    const lakeDir = await makeLakeDir();
    try {
      const summary = await runReportLakeRebuild({ prisma, lakeDir });
      expect(summary).not.toBeNull();
      expect(summary?.tier).toBe("rebuild");
      expect(summary?.matchRows).toBe(match.info.participants.length);
      expect(summary?.skippedMatches).toBe(0);
      expect(summary?.accountRows).toBe(1);

      const buildDir = await readCurrentBuildDir(lakeDir);
      expect(buildDir).toBeDefined();
      if (buildDir === undefined) {
        throw new Error("no build dir");
      }
      const matchRows = await countParquetRows(
        path.join(buildDir, "matches", "**", "*.parquet"),
      );
      expect(matchRows).toBe(match.info.participants.length);
      const accountRows = await countParquetRows(
        path.join(buildDir, "accounts", "accounts.parquet"),
      );
      expect(accountRows).toBe(1);
      expect(
        await Bun.file(path.join(buildDir, "manifest.json")).exists(),
      ).toBe(true);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test("rebuild skips malformed rawJson but still publishes", async () => {
    seedS3Matches([
      {
        key: matchObjectKey("NA1_BROKEN", new Date("2026-07-01T00:00:00Z")),
        body: JSON.stringify({ not: "a match" }),
      },
    ]);

    const lakeDir = await makeLakeDir();
    try {
      const summary = await runReportLakeRebuild({ prisma, lakeDir });
      expect(summary?.skippedMatches).toBe(1);
      expect(summary?.matchRows).toBe(0);
      expect(await readCurrentBuildDir(lakeDir)).toBeDefined();
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test("fold links prior build, folds staging, cleans up, and GCs", async () => {
    const match = await loadMatchFixture();
    const lakeDir = await makeLakeDir();
    try {
      // Build 1: empty rebuild (S3 has no objects — unmocked list → empty).
      const first = await runReportLakeRebuild({ prisma, lakeDir });
      expect(first?.tier).toBe("rebuild");

      // Stage one match, then fold it in.
      const staged = await writeMatchStagingFile(lakeDir, match);
      expect(staged).toBe(true);
      const stagedFiles = await listStagingFiles(lakeDir, "matches");
      expect(stagedFiles.length).toBe(1);

      const fold = await runReportLakeFold({ prisma, lakeDir });
      expect(fold?.tier).toBe("fold");
      expect(fold?.matchRows).toBe(match.info.participants.length);

      const buildDir = await readCurrentBuildDir(lakeDir);
      if (buildDir === undefined) {
        throw new Error("no build dir");
      }
      const rows = await countParquetRows(
        path.join(buildDir, "matches", "**", "*.parquet"),
      );
      expect(rows).toBe(match.info.participants.length);
      // Folded staging file was deleted.
      const remainingFiles = await listStagingFiles(lakeDir, "matches");
      expect(remainingFiles.length).toBe(0);

      // A second fold publishes another build; GC keeps at most 2.
      await runReportLakeFold({ prisma, lakeDir });
      const builds = await readdir(path.join(lakeDir, "builds"));
      expect(builds.length).toBeLessThanOrEqual(2);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test("fold skips malformed staging JSON and records skipped manifest counts", async () => {
    const match = await loadMatchFixture();
    const lakeDir = await makeLakeDir();
    try {
      const first = await runReportLakeRebuild({ prisma, lakeDir });
      expect(first?.tier).toBe("rebuild");

      const staged = await writeMatchStagingFile(lakeDir, match);
      expect(staged).toBe(true);
      const stagedFiles = await listStagingFiles(lakeDir, "matches");
      expect(stagedFiles.length).toBe(1);
      const stagedFile = stagedFiles[0];
      if (stagedFile === undefined) {
        throw new Error("staging file missing");
      }
      await Bun.write(stagedFile, '{"not-valid-json"\n');

      const fold = await runReportLakeFold({ prisma, lakeDir });
      expect(fold?.tier).toBe("fold");
      expect(fold?.matchRows).toBe(0);
      expect(fold?.skippedMatches).toBe(1);

      const buildDir = await readCurrentBuildDir(lakeDir);
      if (buildDir === undefined) {
        throw new Error("no build dir");
      }
      const manifest = ManifestSchema.parse(
        await Bun.file(path.join(buildDir, "manifest.json")).json(),
      );
      expect(manifest.skippedMatches).toBe(1);
      expect(manifest.skippedPrematches).toBe(0);

      const remainingFiles = await listStagingFiles(lakeDir, "matches");
      expect(remainingFiles).toEqual(stagedFiles);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });
});
