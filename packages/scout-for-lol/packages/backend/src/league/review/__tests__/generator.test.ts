import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  MatchIdSchema,
  RawMatchSchema,
  RawTimelineSchema,
  type ArenaMatch,
  type CompletedMatch,
  type OpenAIClient,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";

import { testAccountId, testPuuid } from "#src/testing/test-ids.ts";
import { aiProviderIssueActive } from "#src/metrics/index.ts";
import {
  PROVIDER_ISSUE_KINDS,
  resolveProviderIssue,
  type ProviderIssueKind,
} from "#src/alerts/provider-metrics.ts";

let openaiClient: OpenAIClient | undefined;
let geminiClient: unknown;
const capturedExceptionInputs: unknown[] = [];
const savedPipelineArtifacts: string[] = [];
const captureException = mock((error: unknown) => {
  capturedExceptionInputs.push(error);
});

void mock.module("../ai-clients.ts", () => ({
  getOpenAIClient: () => openaiClient,
  getGeminiClient: () => geminiClient,
}));

void mock.module("#src/storage/pipeline-s3.ts", () => ({
  savePipelineTracesToS3: async () => {
    savedPipelineArtifacts.push("traces");
  },
  savePipelineDebugToS3: async () => {
    savedPipelineArtifacts.push("debug");
  },
}));

void mock.module("@sentry/bun", () => ({
  captureException,
}));

// Test match ID for all tests
const TEST_MATCH_ID = MatchIdSchema.parse("NA1_1234567890");

// Minimal raw match fixture for testing (function returns early when API keys are not configured)
const MINIMAL_RAW_MATCH: RawMatch = RawMatchSchema.parse({
  metadata: {
    matchId: "NA1_1234567890",
    participants: ["test-puuid"],
    dataVersion: "2",
  },
  info: {
    gameId: 1_234_567_890,
    gameCreation: Date.now(),
    gameDuration: 1800,
    gameEndTimestamp: Date.now(),
    gameMode: "CLASSIC",
    gameName: "test",
    gameStartTimestamp: Date.now() - 1_800_000,
    gameType: "MATCHED_GAME",
    gameVersion: "14.1.1",
    mapId: 11,
    platformId: "NA1",
    queueId: 420,
    teams: [],
    participants: [],
    endOfGameResult: "GameComplete",
    tournamentCode: "",
  },
});

// Minimal raw timeline fixture for testing (function returns early when API keys are not configured)
const MINIMAL_RAW_TIMELINE: RawTimeline = RawTimelineSchema.parse({
  metadata: {
    matchId: "NA1_1234567890",
    participants: ["test-puuid"],
    dataVersion: "2",
  },
  info: {
    frameInterval: 60_000,
    frames: [],
    gameId: 1_234_567_890,
    participants: [],
  },
});

function buildThrowingOpenAIClient(error: unknown): OpenAIClient {
  return {
    chat: {
      completions: {
        create: async () => {
          throw error;
        },
      },
    },
  };
}

async function getProviderIssueActiveValue(
  kind: ProviderIssueKind,
): Promise<number | undefined> {
  const metric = await aiProviderIssueActive.get();
  return metric.values.find((value) => {
    return (
      value.labels.app === "scout-for-lol" &&
      value.labels.provider === "openai" &&
      value.labels.kind === kind &&
      value.labels.source === "match_review"
    );
  })?.value;
}

beforeEach(() => {
  openaiClient = undefined;
  geminiClient = undefined;
  capturedExceptionInputs.length = 0;
  savedPipelineArtifacts.length = 0;
  captureException.mockClear();
  for (const kind of PROVIDER_ISSUE_KINDS) {
    resolveProviderIssue({
      app: "scout-for-lol",
      provider: "openai",
      kind,
      source: "match_review",
    });
  }
});

function buildCompletedMatchFixture(): CompletedMatch {
  return {
    queueType: "solo",
    durationInSeconds: 1800,
    players: [
      {
        playerConfig: {
          alias: "TestPlayer",
          discordAccount: { id: testAccountId("12300000000000000") },
          league: {
            leagueAccount: {
              puuid: testPuuid("test-puuid"),
              region: "AMERICA_NORTH",
            },
          },
        },
        rankBeforeMatch: {
          tier: "gold",
          division: 2,
          lp: 50,
          wins: 25,
          losses: 23,
        },
        rankAfterMatch: {
          tier: "gold",
          division: 2,
          lp: 65,
          wins: 26,
          losses: 23,
        },
        wins: 50,
        losses: 48,
        champion: {
          riotIdGameName: "TestPlayer#NA1",
          championName: "Jinx",
          kills: 10,
          deaths: 3,
          assists: 8,
          level: 18,
          items: [],
          spells: [4, 7],
          gold: 12_000,
          runes: [],
          creepScore: 200,
          visionScore: 45,
          damage: 35_000,
          lane: "adc",
        },
        outcome: "Victory",
        team: "blue",
        lane: "adc",
        laneOpponent: {
          riotIdGameName: "Caitlyn#NA1",
          championName: "Caitlyn",
          kills: 3,
          deaths: 10,
          assists: 5,
          level: 17,
          items: [],
          spells: [4, 7],
          gold: 9000,
          runes: [],
          creepScore: 180,
          visionScore: 30,
          damage: 25_000,
          lane: "adc",
        },
      },
    ],
    teams: {
      blue: [],
      red: [],
    },
  };
}

function buildArenaMatchFixture(): ArenaMatch {
  return {
    queueType: "arena",
    durationInSeconds: 1200,
    players: [
      {
        playerConfig: {
          alias: "ArenaPlayer",
          discordAccount: { id: testAccountId("78900000000000000") },
          league: {
            leagueAccount: {
              puuid: testPuuid("arena-puuid"),
              region: "AMERICA_NORTH",
            },
          },
        },
        placement: 1,
        champion: {
          championName: "Zed",
          riotIdGameName: "ArenaPlayer#NA1",
          kills: 15,
          deaths: 2,
          assists: 10,
          level: 18,
          items: [],
          gold: 10_000,
          damage: 50_000,
          augments: [],
          arenaMetrics: {
            playerScore0: 0,
            playerScore1: 0,
            playerScore2: 0,
            playerScore3: 0,
            playerScore4: 0,
            playerScore5: 0,
            playerScore6: 0,
            playerScore7: 0,
            playerScore8: 0,
            playerScore9: 0,
            playerScore10: 0,
            playerScore11: 0,
          },
          teamSupport: {
            damageShieldedOnTeammate: 0,
            healsOnTeammate: 0,
            damageTakenPercentage: 0,
          },
        },
        teamId: 1,
        teammates: [
          {
            championName: "Talon",
            riotIdGameName: "Teammate#NA1",
            kills: 12,
            deaths: 3,
            assists: 11,
            level: 18,
            items: [],
            gold: 9500,
            damage: 45_000,
            augments: [],
            arenaMetrics: {
              playerScore0: 0,
              playerScore1: 0,
              playerScore2: 0,
              playerScore3: 0,
              playerScore4: 0,
              playerScore5: 0,
              playerScore6: 0,
              playerScore7: 0,
              playerScore8: 0,
              playerScore9: 0,
              playerScore10: 0,
              playerScore11: 0,
            },
            teamSupport: {
              damageShieldedOnTeammate: 0,
              healsOnTeammate: 0,
              damageTakenPercentage: 0,
            },
          },
        ],
      },
    ],
    teams: [],
  };
}

const { generateMatchReview } = await import("#src/league/review/generator.ts");
describe("generateMatchReview", () => {
  describe("when API keys are not configured", () => {
    test("returns undefined for regular match", async () => {
      const review = await generateMatchReview(
        buildCompletedMatchFixture(),
        TEST_MATCH_ID,
        MINIMAL_RAW_MATCH,
        MINIMAL_RAW_TIMELINE,
      );

      expect(review).toBeUndefined();
    });

    test("returns undefined for arena match", async () => {
      const review = await generateMatchReview(
        buildArenaMatchFixture(),
        TEST_MATCH_ID,
        MINIMAL_RAW_MATCH,
        MINIMAL_RAW_TIMELINE,
      );

      expect(review).toBeUndefined();
    });
  });

  describe("when OpenAI operational errors occur", () => {
    test("records budget-exceeded provider issues without capturing to Sentry", async () => {
      const error = new Error(
        "OpenAI hourly token budget exceeded: 2000000 / 2000000",
      );
      error.name = "OpenAIBudgetExceeded";
      openaiClient = buildThrowingOpenAIClient(error);

      const review = await generateMatchReview(
        buildCompletedMatchFixture(),
        TEST_MATCH_ID,
        MINIMAL_RAW_MATCH,
        MINIMAL_RAW_TIMELINE,
      );

      expect(review).toBeUndefined();
      expect(await getProviderIssueActiveValue("budget_exceeded")).toBe(1);
      expect(captureException).not.toHaveBeenCalled();
    });

    test("records context-limit provider issues without capturing to Sentry", async () => {
      openaiClient = buildThrowingOpenAIClient({
        status: 400,
        error: {
          message:
            "Input tokens exceed the configured limit of 272000 tokens. Your messages resulted in 305127 tokens.",
          type: "invalid_request_error",
        },
      });

      const review = await generateMatchReview(
        buildCompletedMatchFixture(),
        TEST_MATCH_ID,
        MINIMAL_RAW_MATCH,
        MINIMAL_RAW_TIMELINE,
      );

      expect(review).toBeUndefined();
      expect(await getProviderIssueActiveValue("context_limit")).toBe(1);
      expect(captureException).not.toHaveBeenCalled();
    });
  });
});
