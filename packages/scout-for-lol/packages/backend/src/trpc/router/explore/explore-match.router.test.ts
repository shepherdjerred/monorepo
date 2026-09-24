import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  LakeMatchParticipantRow,
  TimelineChartFrame,
} from "#src/reports/duckdb/consumer-profile-lake-reads.ts";
import * as lakeReads from "#src/reports/duckdb/consumer-profile-lake-reads.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { testGuildId } from "#src/testing/test-ids.ts";

const MATCH_ID = "EUW1_7988647427";

function matchRow(
  participantId: number,
  teamId: number,
): LakeMatchParticipantRow {
  return {
    match_id: MATCH_ID,
    game_creation_ms: 1_700_000_000_000,
    game_duration_seconds: 1800,
    queue: "SWIFTPLAY",
    queue_id: 880,
    game_mode: "SWIFTPLAY",
    game_type: "MATCHED_GAME",
    game_version: "15.1.1",
    map_id: 11,
    puuid: `puuid-${String(participantId)}`,
    participant_id: participantId,
    team_id: teamId,
    riot_id_game_name: `player-${String(participantId)}`,
    riot_id_tagline: "NA1",
    champion_id: 1,
    champion_name: "Annie",
    team_position: "MIDDLE",
    win: teamId === 100,
    kills: 1,
    deaths: 1,
    assists: 1,
    creep_score: 100,
    gold_earned: 1000,
    vision_score: 10,
    total_damage_dealt_to_champions: 1000,
    turret_kills: 0,
    inhibitor_kills: 0,
    baron_kills: 0,
    dragon_kills: 0,
  };
}

function chartFrame(
  participantId: number,
  totalGold = 1000,
): TimelineChartFrame {
  return {
    frame_timestamp_ms: 60_000,
    participant_id: participantId,
    total_gold: totalGold,
    xp: 500,
  };
}

// Observed prod shape: 6 stored rows, 10 frame participants.
const swiftplayRows = [1, 2, 3, 4, 5, 6].map((participantId) =>
  matchRow(participantId, participantId <= 5 ? 100 : 200),
);
const fullFrames = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((participantId) =>
  chartFrame(participantId),
);

const fetchFullMatch = vi.fn(async () => swiftplayRows);
const fetchTimelineChartFrames = vi.fn(async () => fullFrames);

vi.doMock("#src/reports/duckdb/consumer-profile-lake-reads.ts", () => ({
  ...lakeReads,
  fetchFullMatch,
  fetchTimelineChartFrames,
}));

/**
 * Module mocks must be installed before the router loads (see the harness
 * docblock); the lake mock above runs before this dynamic import chain.
 */
const trpc = await createOfflineTrpcHarness("explore-match-router-test");

const ALLOWED_GUILD = testGuildId("111111");

function setAllowlist(value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = value;
  }
  resetConfigurationForTests();
}

beforeEach(() => {
  trpc.setMembership([{ guildId: ALLOWED_GUILD, asAdmin: false }]);
  setAllowlist(ALLOWED_GUILD);
  fetchFullMatch.mockClear();
  fetchTimelineChartFrames.mockClear();
});

afterAll(async () => {
  setAllowlist(undefined);
  await trpc.prisma.$disconnect();
});

describe("exploreMatch.chartSeries", () => {
  test("attributes frames for participants missing from match rows", async () => {
    const caller = trpc.authedCaller();
    const result = await caller.exploreMatch.chartSeries({
      matchId: MATCH_ID,
    });
    expect(result.points).toEqual([
      {
        timestampMs: 60_000,
        teamGold: [
          { teamId: 100, gold: 5000 },
          { teamId: 200, gold: 5000 },
        ],
        selectedGold: null,
        selectedXp: null,
      },
    ]);
  });

  test("fails typed when rows cannot confirm the team split", async () => {
    fetchFullMatch.mockResolvedValueOnce(
      swiftplayRows.map((row) => ({ ...row, team_id: 100 })),
    );
    const caller = trpc.authedCaller();
    await expect(
      caller.exploreMatch.chartSeries({ matchId: MATCH_ID }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
