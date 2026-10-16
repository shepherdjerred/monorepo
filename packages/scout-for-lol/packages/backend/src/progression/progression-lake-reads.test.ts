import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TimelineCoverageLakeRow } from "@scout-for-lol/data";
import { timelineStagingFilePath } from "#src/report-lake/staging.ts";
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";
import { testPuuid } from "#src/testing/test-ids.ts";

const lakeDir = await mkdtemp(path.join(tmpdir(), "scout-progression-lake-"));
const puuid = testPuuid("progression-coverage");
const matchWithCoverage = "NA1_9400000000";
const matchWithoutCoverage = "NA1_9400000010";
const { prisma } = createTestDatabase("progression-admitted-matches");
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
const { fetchProgressionMatches } =
  await import("#src/progression/progression-lake-reads.ts");

function matchFact(matchId: RiotMatchId, gameCreationAt: Date) {
  return {
    playerId: 1,
    playerAlias: "progression-test",
    matchId,
    puuid,
    queue: "solo" as const,
    win: true,
    surrendered: false,
    kills: 1,
    deaths: 0,
    assists: 2,
    gameCreationAt,
  };
}

const coverage: TimelineCoverageLakeRow = {
  match_id: matchWithCoverage,
  month: "2026-08",
  observed_at: "2026-08-20 12:30:00.000",
  coverage_state: "complete",
  data_version: "2",
  frame_interval_ms: 60_000,
  frame_count: 2,
  event_count: 0,
  participant_count: 1,
  first_frame_timestamp_ms: 0,
  last_frame_timestamp_ms: 60_000,
};

async function fetchMatch(matchId: RiotMatchId) {
  const rows = await fetchProgressionMatches({
    puuids: [puuid],
    startAt: new Date("2026-08-20T00:00:00.000Z"),
    matchId,
    lakeDir,
  });
  expect(rows).toHaveLength(1);
  return rows[0];
}

beforeEach(async () => {
  await resetTestLake(lakeDir);
  await prisma.matchEvidenceAdmission.deleteMany();
  await prisma.matchEvidenceAdmission.createMany({
    data: [matchWithCoverage, matchWithoutCoverage].map((riotMatchId) => ({
      riotMatchId: RiotMatchIdSchema.parse(riotMatchId),
      policy: "FULL",
      reason: "legacy-live",
      firstDiscoveredAt: new Date("2026-08-20T12:00:00Z"),
      completedAt: new Date("2026-08-20T12:00:00Z"),
    })),
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await rm(lakeDir, { recursive: true, force: true });
});

describe("fetchProgressionMatches timeline coverage", () => {
  test("treats a missing match coverage row as false", async () => {
    await writeTestLake(lakeDir, {
      serverId: DiscordGuildIdSchema.parse("815637401011914312"),
      matchFacts: [
        matchFact(
          RiotMatchIdSchema.parse(matchWithoutCoverage),
          new Date("2026-08-20T12:00:00.000Z"),
        ),
        matchFact(
          RiotMatchIdSchema.parse(matchWithCoverage),
          new Date("2026-08-20T13:00:00.000Z"),
        ),
      ],
      timelineCoverage: [coverage],
    });

    await expect(
      fetchMatch(RiotMatchIdSchema.parse(matchWithoutCoverage)),
    ).resolves.toMatchObject({
      timeline_complete: false,
    });
  });

  test("returns false when the coverage lake is absent", async () => {
    await writeTestLake(lakeDir, {
      serverId: DiscordGuildIdSchema.parse("815637401011914312"),
      matchFacts: [
        matchFact(
          RiotMatchIdSchema.parse(matchWithoutCoverage),
          new Date("2026-08-20T12:00:00.000Z"),
        ),
      ],
    });

    await expect(
      fetchMatch(RiotMatchIdSchema.parse(matchWithoutCoverage)),
    ).resolves.toMatchObject({
      timeline_complete: false,
    });
  });

  test("returns true for a complete coverage row", async () => {
    await writeTestLake(lakeDir, {
      serverId: DiscordGuildIdSchema.parse("815637401011914312"),
      matchFacts: [
        matchFact(
          RiotMatchIdSchema.parse(matchWithCoverage),
          new Date("2026-08-20T12:00:00.000Z"),
        ),
      ],
      timelineCoverage: [coverage],
    });

    await expect(
      fetchMatch(RiotMatchIdSchema.parse(matchWithCoverage)),
    ).resolves.toMatchObject({
      timeline_complete: true,
    });
  });

  test("rejects a malformed present coverage row", async () => {
    await writeTestLake(lakeDir, {
      serverId: DiscordGuildIdSchema.parse("815637401011914312"),
      matchFacts: [
        matchFact(
          RiotMatchIdSchema.parse(matchWithCoverage),
          new Date("2026-08-20T12:00:00.000Z"),
        ),
      ],
    });
    await Bun.write(
      timelineStagingFilePath(
        lakeDir,
        "timeline_coverage",
        RiotMatchIdSchema.parse(matchWithCoverage),
      ),
      `${JSON.stringify({ ...coverage, coverage_state: null })}\n`,
    );

    await expect(
      fetchMatch(RiotMatchIdSchema.parse(matchWithCoverage)),
    ).rejects.toThrow(/timeline_complete/u);
  });
});
