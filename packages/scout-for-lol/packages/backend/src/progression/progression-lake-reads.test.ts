import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TimelineCoverageLakeRow } from "@scout-for-lol/data";
import { fetchProgressionMatches } from "#src/progression/progression-lake-reads.ts";
import { timelineStagingFilePath } from "#src/report-lake/staging.ts";
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";
import { testPuuid } from "#src/testing/test-ids.ts";

const lakeDir = await mkdtemp(path.join(tmpdir(), "scout-progression-lake-"));
const puuid = testPuuid("progression-coverage");
const matchWithCoverage = "NA1_progression_coverage";
const matchWithoutCoverage = "NA1_progression_missing_coverage";

function matchFact(matchId: string, gameCreationAt: Date) {
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

async function fetchMatch(matchId: string) {
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
});

afterAll(async () => {
  await rm(lakeDir, { recursive: true, force: true });
});

describe("fetchProgressionMatches timeline coverage", () => {
  test("treats a missing match coverage row as false", async () => {
    await writeTestLake(lakeDir, {
      serverId: "guild-progression",
      matchFacts: [
        matchFact(matchWithoutCoverage, new Date("2026-08-20T12:00:00.000Z")),
        matchFact(matchWithCoverage, new Date("2026-08-20T13:00:00.000Z")),
      ],
      timelineCoverage: [coverage],
    });

    await expect(fetchMatch(matchWithoutCoverage)).resolves.toMatchObject({
      timeline_complete: false,
    });
  });

  test("returns false when the coverage lake is absent", async () => {
    await writeTestLake(lakeDir, {
      serverId: "guild-progression",
      matchFacts: [
        matchFact(matchWithoutCoverage, new Date("2026-08-20T12:00:00.000Z")),
      ],
    });

    await expect(fetchMatch(matchWithoutCoverage)).resolves.toMatchObject({
      timeline_complete: false,
    });
  });

  test("returns true for a complete coverage row", async () => {
    await writeTestLake(lakeDir, {
      serverId: "guild-progression",
      matchFacts: [
        matchFact(matchWithCoverage, new Date("2026-08-20T12:00:00.000Z")),
      ],
      timelineCoverage: [coverage],
    });

    await expect(fetchMatch(matchWithCoverage)).resolves.toMatchObject({
      timeline_complete: true,
    });
  });

  test("rejects a malformed present coverage row", async () => {
    await writeTestLake(lakeDir, {
      serverId: "guild-progression",
      matchFacts: [
        matchFact(matchWithCoverage, new Date("2026-08-20T12:00:00.000Z")),
      ],
    });
    await Bun.write(
      timelineStagingFilePath(lakeDir, "timeline_coverage", matchWithCoverage),
      `${JSON.stringify({ ...coverage, coverage_state: null })}\n`,
    );

    await expect(fetchMatch(matchWithCoverage)).rejects.toThrow(
      /timeline_complete/u,
    );
  });
});
