import { afterAll, beforeEach, describe, expect, test } from "vitest";
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
  CachedLeaderboardSchema,
  CompetitionIdSchema,
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
import {
  flattenMatch,
  flattenMatchTeamBans,
  flattenMatchTeams,
  flattenPrematch,
} from "#src/report-lake/flatten.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import { matchObjectKey } from "#src/report-store/s3-raw-source.ts";
import {
  listStagingFiles,
  writeCompetitionRankHistoryStagingFile,
  writeMatchStagingFile,
} from "#src/report-lake/staging.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { fetchCompetitionRankHistory } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  buildMatchTeamBansSource,
  buildMatchTeamsSource,
  resolveLakeFiles,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

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
  s3Mock.on(ListObjectsV2Command, { Prefix: "leaderboards/" }).resolves({
    Contents: [],
  });
  for (const object of objects) {
    s3Mock
      .on(GetObjectCommand, { Key: object.key })
      .callsFake(() => mockGetObjectResponse(object.body));
  }
}

function seedS3Leaderboard(key: string, body: string): void {
  s3Mock.on(ListObjectsV2Command, { Prefix: "leaderboards/" }).resolves({
    Contents: [{ Key: key }],
  });
  s3Mock
    .on(GetObjectCommand, { Key: key })
    .callsFake(() => mockGetObjectResponse(body));
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

const ManifestFingerprintSchema = z.looseObject({
  schemaFingerprint: z.string().optional(),
});

/**
 * Rewrite the published build's recorded fingerprint.
 *
 * Standing in for "the column set moved" this way keeps the test honest about
 * what it exercises: the constants cannot be mutated at runtime, and the guard
 * compares a recorded value against the live one, so forcing them apart is the
 * real condition rather than a proxy for it.
 */
async function rewritePublishedFingerprint(
  lakeDir: string,
  fingerprint: string,
): Promise<void> {
  const buildDir = await readCurrentBuildDir(lakeDir);
  if (buildDir === undefined) {
    throw new Error("no published build to rewrite");
  }
  const manifestPath = path.join(buildDir, "manifest.json");
  const manifest = ManifestFingerprintSchema.parse(
    await Bun.file(manifestPath).json(),
  );
  await Bun.write(
    manifestPath,
    JSON.stringify({ ...manifest, schemaFingerprint: fingerprint }),
  );
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

async function countSourceRows(source: SqlFragment): Promise<number> {
  return await withDuckDBConnection(async (session) => {
    const rows = await session.run(
      `SELECT COUNT(*)::BIGINT AS n FROM (${source.sql})`,
      source.params.map((param) =>
        param.kind === "list" ? session.list(param.values) : param.value,
      ),
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
  s3Mock.on(ListObjectsV2Command, { Prefix: "leaderboards/" }).resolves({
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
  test("keeps Classic and Classic ARAM Mayhem queue values distinct", async () => {
    const match = await loadMatchFixture();
    const variants = [
      { queueId: 4310, gameMode: "CLASSIC", expected: "classic" },
      {
        queueId: 2450,
        gameMode: "CLASSIC ARAM MAYHEM",
        expected: "classic aram mayhem",
      },
    ] as const;

    for (const variant of variants) {
      const rows = flattenMatch(
        RawMatchSchema.parse({
          ...match,
          info: {
            ...match.info,
            queueId: variant.queueId,
            gameMode: variant.gameMode,
            mapId: variant.expected === "classic" ? 453 : 35,
          },
        }),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((row) => row.queue))).toEqual(
        new Set([variant.expected]),
      );
    }
  });

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

  test("flattens normalized teams and bans for ordinary SQL joins", async () => {
    const match = await loadMatchFixture();
    const ordinaryMatch = RawMatchSchema.parse({
      ...match,
      info: { ...match.info, queueId: 420, gameMode: "CLASSIC", mapId: 11 },
    });
    const teams = flattenMatchTeams(ordinaryMatch);
    const bans = flattenMatchTeamBans(ordinaryMatch);

    expect(teams).toHaveLength(ordinaryMatch.info.teams.length);
    expect(teams.map((team) => team.team_id)).toEqual(
      ordinaryMatch.info.teams.map((team) => team.teamId),
    );
    expect(teams[0]?.champion_kills).toBe(
      ordinaryMatch.info.teams[0]?.objectives.champion.kills,
    );
    expect(bans).toHaveLength(
      ordinaryMatch.info.teams.reduce(
        (total, team) => total + team.bans.length,
        0,
      ),
    );
    expect(bans[0]).toMatchObject({
      match_id: ordinaryMatch.metadata.matchId,
      team_id: ordinaryMatch.info.teams[0]?.teamId,
    });
  });

  test("omits Arena team aggregates that cannot join player subteams", async () => {
    const match = await loadMatchFixture();
    const arenaMatch = RawMatchSchema.parse({
      ...match,
      info: { ...match.info, queueId: 1700 },
    });

    expect(flattenMatchTeams(arenaMatch)).toEqual([]);
    expect(flattenMatchTeamBans(arenaMatch)).toEqual([]);
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

describe("rank-history compaction", () => {
  test("rebuild represents an empty supported rank-history source", async () => {
    const lakeDir = await makeLakeDir();
    try {
      const summary = await runReportLakeRebuild({ prisma, lakeDir });
      expect(summary?.competitionRankHistoryRows).toBe(0);
      expect(
        await fetchCompetitionRankHistory({
          competitionId: CompetitionIdSchema.parse(42),
          lakeDir,
        }),
      ).toEqual([]);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test("rebuild materializes authoritative leaderboard snapshots", async () => {
    const competitionId = CompetitionIdSchema.parse(42);
    const key = "leaderboards/competition-42/snapshots/2026-08-01.json";
    seedS3Leaderboard(
      key,
      JSON.stringify({
        version: "v1",
        competitionId,
        calculatedAt: "2026-08-01T12:00:00.000Z",
        entries: [
          { playerId: 1, playerName: "Astra", score: 2400, rank: 1 },
          { playerId: 2, playerName: "Dragon", score: 2300, rank: 2 },
        ],
      }),
    );
    const lakeDir = await makeLakeDir();
    try {
      const summary = await runReportLakeRebuild({ prisma, lakeDir });
      expect(summary?.competitionRankHistoryRows).toBe(2);
      const history = await fetchCompetitionRankHistory({
        competitionId,
        lakeDir,
      });
      expect(history).toHaveLength(1);
      expect(history?.[0]?.entries.map((entry) => entry.playerName)).toEqual([
        "Astra",
        "Dragon",
      ]);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
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
      expect(fold?.matchTeamRows).toBe(0);

      const buildDir = await readCurrentBuildDir(lakeDir);
      if (buildDir === undefined) {
        throw new Error("no build dir");
      }
      const rows = await countParquetRows(
        path.join(buildDir, "matches", "**", "*.parquet"),
      );
      expect(rows).toBe(match.info.participants.length);
      const files = await resolveLakeFiles(lakeDir);
      const teamSource = buildMatchTeamsSource(files, { sql: "", params: [] });
      const banSource = buildMatchTeamBansSource(files, {
        sql: "",
        params: [],
      });
      const [teamRows, banRows] = await Promise.all([
        teamSource === undefined
          ? Promise.resolve(0)
          : countSourceRows(teamSource),
        banSource === undefined
          ? Promise.resolve(0)
          : countSourceRows(banSource),
      ]);
      expect(teamRows).toBe(0);
      expect(banRows).toBe(0);
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
});

describe("compactor idempotency and schema transitions", () => {
  test("re-importing a folded match remains one logical row per participant", async () => {
    const match = await loadMatchFixture();
    const lakeDir = await makeLakeDir();
    try {
      await runReportLakeRebuild({ prisma, lakeDir });
      expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
      await runReportLakeFold({ prisma, lakeDir });

      // A later cooldown refetch can stage the same immutable Match-V5 ID.
      expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
      await runReportLakeFold({ prisma, lakeDir });

      const source = buildMatchesSource(await resolveLakeFiles(lakeDir), {
        sql: "",
        params: [],
      });
      if (source === undefined) throw new Error("missing match lake source");
      const rowCount = await withDuckDBConnection(async (session) => {
        const rows = await session.run(
          `SELECT COUNT(*)::BIGINT AS n FROM (${source.sql})`,
          source.params.map((param) =>
            param.kind === "list" ? session.list(param.values) : param.value,
          ),
        );
        return CountRowSchema.parse(rows[0]).n;
      });
      expect(rowCount).toBe(match.info.participants.length);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test("rebuild records the current lake schema fingerprint", async () => {
    const lakeDir = await makeLakeDir();
    try {
      await runReportLakeRebuild({ prisma, lakeDir });
      const buildDir = await readCurrentBuildDir(lakeDir);
      if (buildDir === undefined) {
        throw new Error("no build dir");
      }
      const manifest = ManifestFingerprintSchema.parse(
        await Bun.file(path.join(buildDir, "manifest.json")).json(),
      );
      expect(manifest.schemaFingerprint).toBe(lakeSchemaFingerprint());
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  // A fold hardlinks the published build's parquet and appends fold files at
  // the current column set. Reads select an explicit column list across all of
  // them, so a mixed build does not degrade — it raises a DuckDB Binder Error
  // and takes down every report. The fold must notice and rebuild instead.
  test("fold rebuilds instead of hardlinking when the column set changed", async () => {
    const match = await loadMatchFixture();
    const lakeDir = await makeLakeDir();
    try {
      const seeded = await runReportLakeRebuild({ prisma, lakeDir });
      expect(seeded?.tier).toBe("rebuild");
      await rewritePublishedFingerprint(lakeDir, "stale-fingerprint");

      expect(await writeMatchStagingFile(lakeDir, match)).toBe(true);
      const fold = await runReportLakeFold({ prisma, lakeDir });
      expect(fold?.tier).toBe("rebuild");

      // And the rebuilt build is recorded at the current schema, so the next
      // fold proceeds normally rather than rebuilding forever.
      const buildDir = await readCurrentBuildDir(lakeDir);
      if (buildDir === undefined) {
        throw new Error("no build dir");
      }
      const manifest = ManifestFingerprintSchema.parse(
        await Bun.file(path.join(buildDir, "manifest.json")).json(),
      );
      expect(manifest.schemaFingerprint).toBe(lakeSchemaFingerprint());
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  // Every build published before the fingerprint existed carries no such field.
  // That is the state of the lake on the first deploy of this change, and it
  // must self-heal into a rebuild rather than publishing a mixed build.
  test("fold rebuilds when the published manifest predates the fingerprint", async () => {
    const lakeDir = await makeLakeDir();
    try {
      await runReportLakeRebuild({ prisma, lakeDir });
      const buildDir = await readCurrentBuildDir(lakeDir);
      if (buildDir === undefined) {
        throw new Error("no build dir");
      }
      const manifestPath = path.join(buildDir, "manifest.json");
      const existing = ManifestFingerprintSchema.parse(
        await Bun.file(manifestPath).json(),
      );
      const { schemaFingerprint: _dropped, ...withoutFingerprint } = existing;
      await Bun.write(manifestPath, JSON.stringify(withoutFingerprint));

      const fold = await runReportLakeFold({ prisma, lakeDir });
      expect(fold?.tier).toBe("rebuild");
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });

  test("fold materializes only staged rank history without replaying S3", async () => {
    const competitionId = CompetitionIdSchema.parse(77);
    const lakeDir = await makeLakeDir();
    try {
      await runReportLakeRebuild({ prisma, lakeDir });
      const leaderboard = CachedLeaderboardSchema.parse({
        version: "v1",
        competitionId,
        calculatedAt: "2026-08-08T12:00:00.000Z",
        entries: [
          { playerId: 1, playerName: "Astra", score: 2400, rank: 1 },
          { playerId: 2, playerName: "Dragon", score: 2300, rank: 2 },
        ],
      });
      expect(
        await writeCompetitionRankHistoryStagingFile(lakeDir, leaderboard),
      ).toBe(true);
      const listCallsBefore = s3Mock.commandCalls(ListObjectsV2Command, {
        Prefix: "leaderboards/",
      }).length;

      const fold = await runReportLakeFold({ prisma, lakeDir });

      expect(fold?.competitionRankHistoryRows).toBe(2);
      expect(
        s3Mock.commandCalls(ListObjectsV2Command, {
          Prefix: "leaderboards/",
        }),
      ).toHaveLength(listCallsBefore);
      expect(
        await listStagingFiles(lakeDir, "competition_rank_history"),
      ).toHaveLength(0);
      const history = await fetchCompetitionRankHistory({
        competitionId,
        lakeDir,
      });
      expect(history).toEqual([leaderboard]);
    } finally {
      await rm(lakeDir, { recursive: true, force: true });
    }
  });
});

describe("compactor rank replacement and invalid input", () => {
  test("a newer daily rank snapshot atomically replaces every prior entry", async () => {
    const competitionId = CompetitionIdSchema.parse(78);
    const lakeDir = await makeLakeDir();
    try {
      await runReportLakeRebuild({ prisma, lakeDir });
      const original = CachedLeaderboardSchema.parse({
        version: "v1",
        competitionId,
        calculatedAt: "2026-08-08T12:00:00.000Z",
        entries: [
          { playerId: 1, playerName: "Astra", score: 2400, rank: 1 },
          { playerId: 2, playerName: "Dragon", score: 2300, rank: 2 },
        ],
      });
      const replacement = CachedLeaderboardSchema.parse({
        version: "v1",
        competitionId,
        calculatedAt: "2026-08-08T13:00:00.000Z",
        entries: [{ playerId: 1, playerName: "Astra", score: 2500, rank: 1 }],
      });
      expect(
        await writeCompetitionRankHistoryStagingFile(lakeDir, original),
      ).toBe(true);
      await runReportLakeFold({ prisma, lakeDir });
      expect(
        await writeCompetitionRankHistoryStagingFile(lakeDir, replacement),
      ).toBe(true);
      await runReportLakeFold({ prisma, lakeDir });

      expect(
        await fetchCompetitionRankHistory({ competitionId, lakeDir }),
      ).toEqual([replacement]);
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
