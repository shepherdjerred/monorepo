import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RawMatch } from "@scout-for-lol/data";
import { testPuuid } from "#src/testing/test-ids.ts";

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    evaluateHallMatch: vi.fn(async () => {
      calls.push("hall");
    }),
    prepareChallengeRunsForMatch: vi.fn(async () => {
      calls.push("prepare");
      return [{ runId: "run-id", revision: 2, timelineRequired: true }];
    }),
    fetchTimelineForProgression: vi.fn(async () => {
      calls.push("fetch-timeline");
    }),
    launchPreparedChallengeRuns: vi.fn(async () => {
      calls.push("launch");
    }),
    queuePreparedChallengeRuns: vi.fn(async () => {
      calls.push("queue");
    }),
    duelMatchNeedsTimeline: vi.fn(async () => false),
    processDuelResult: vi.fn(async () => {
      calls.push("duel");
    }),
  };
});

vi.mock("#src/configuration.ts", () => ({
  default: { environment: "beta" },
}));
vi.mock("#src/progression/hall/evaluate-match.ts", () => ({
  evaluateHallMatch: mocks.evaluateHallMatch,
}));
vi.mock("#src/progression/challenges/postmatch.ts", () => ({
  launchPreparedChallengeRuns: mocks.launchPreparedChallengeRuns,
  prepareChallengeRunsForMatch: mocks.prepareChallengeRunsForMatch,
  queuePreparedChallengeRuns: mocks.queuePreparedChallengeRuns,
}));
vi.mock("#src/league/tasks/postmatch/match-report-standard.ts", () => ({
  fetchTimelineForProgression: mocks.fetchTimelineForProgression,
  persistTimelineForProgression: vi.fn(),
}));
vi.mock("#src/progression/duels/results.ts", () => ({
  duelMatchNeedsTimeline: mocks.duelMatchNeedsTimeline,
  processDuelResult: mocks.processDuelResult,
}));

const { processCompetitiveProgressionMatch } =
  await import("#src/progression/postmatch.ts");

function matchFixture(): RawMatch {
  return {
    metadata: {
      dataVersion: "2",
      matchId: "NA1_1234567890",
      participants: [testPuuid("timeline-participant")],
    },
    info: {
      endOfGameResult: "GameComplete",
      gameCreation: 1_000_000,
      gameDuration: 1800,
      gameEndTimestamp: 2_000_000,
      gameId: 123_456_789,
      gameMode: "CLASSIC",
      gameName: "progression-race-fixture",
      gameStartTimestamp: 1_000_000,
      gameType: "MATCHED_GAME",
      gameVersion: "14.1.1",
      mapId: 11,
      participants: [],
      platformId: "NA1",
      queueId: 420,
      teams: [],
      tournamentCode: "",
    },
  };
}

describe("competitive progression post-match ordering", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    vi.clearAllMocks();
  });

  test("stages timeline evidence before queueing and launching revisions", async () => {
    await processCompetitiveProgressionMatch({
      match: matchFixture(),
      timeline: null,
      trackedPlayers: [],
    });

    expect(mocks.calls).toEqual([
      "duel",
      "hall",
      "prepare",
      "fetch-timeline",
      "prepare",
      "queue",
      "launch",
    ]);
  });
});
