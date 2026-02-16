import { describe, expect, test, mock } from "bun:test";
import {
  MatchIdSchema,
  type ArenaMatch,
  type CompletedMatch,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";

import { testAccountId, testPuuid } from "@scout-for-lol/backend/testing/test-ids.ts";

// Test match ID for all tests
const TEST_MATCH_ID = MatchIdSchema.parse("NA1_1234567890");

// Minimal raw match fixture for testing (function returns early when API keys are not configured)
// Using `as unknown as RawMatch` since we only need type compatibility, not a valid match
// eslint-disable-next-line custom-rules/no-type-assertions -- not worth fully defining the type
const MINIMAL_RAW_MATCH = {
  metadata: {
    matchId: "NA1_1234567890",
    participants: ["test-puuid"],
    dataVersion: "2",
  },
  info: {
    gameId: 1234567890,
    gameCreation: Date.now(),
    gameDuration: 1800,
    gameEndTimestamp: Date.now(),
    gameMode: "CLASSIC",
    gameName: "test",
    gameStartTimestamp: Date.now() - 1800000,
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
} as unknown as RawMatch;

// Minimal raw timeline fixture for testing (function returns early when API keys are not configured)
// eslint-disable-next-line custom-rules/no-type-assertions -- not worth fully defining the type
const MINIMAL_RAW_TIMELINE = {
  metadata: {
    matchId: "NA1_1234567890",
    participants: ["test-puuid"],
    dataVersion: "2",
  },
  info: {
    frameInterval: 60000,
    frames: [],
    gameId: 1234567890,
    participants: [],
  },
} as unknown as RawTimeline;

// Mock the configuration module to prevent API calls
// Use a factory function to read env vars at runtime so other tests can override
void mock.module("../../../configuration.js", () => ({
  default: {
    version: Bun.env["VERSION"] ?? "test",
    gitSha: Bun.env["GIT_SHA"] ?? "test",
    sentryDsn: Bun.env["SENTRY_DSN"],
    environment: Bun.env["ENVIRONMENT"] ?? "dev",
    discordToken: Bun.env["DISCORD_TOKEN"] ?? "test",
    applicationId: Bun.env["APPLICATION_ID"] ?? "test",
    riotApiToken: Bun.env["RIOT_API_TOKEN"] ?? "test",
    databaseUrl: Bun.env["DATABASE_URL"] ?? "test.db",
    port: Number.parseInt(Bun.env["PORT"] ?? "3000"),
    s3BucketName: Bun.env["S3_BUCKET_NAME"],
    openaiApiKey: undefined, // Always undefined for this test to prevent API calls
    geminiApiKey: undefined, // Always undefined for this test to prevent API calls
  },
}));

import { generateMatchReview } from "@scout-for-lol/backend/league/review/generator.ts";
describe("generateMatchReview", () => {
  describe("when API keys are not configured", () => {
    test("returns undefined for regular match", async () => {
      // Use minimal type-safe fixture - only testing review generation logic
      const match = {
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
            rankBeforeMatch: { tier: "gold", division: 2, lp: 50, wins: 25, losses: 23 },
            rankAfterMatch: { tier: "gold", division: 2, lp: 65, wins: 26, losses: 23 },
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
              gold: 12000,
              runes: [],
              creepScore: 200,
              visionScore: 45,
              damage: 35000,
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
              damage: 25000,
              lane: "adc",
            },
          },
        ],
        teams: {
          blue: [],
          red: [],
        },
      } satisfies CompletedMatch;

      const review = await generateMatchReview(match, TEST_MATCH_ID, MINIMAL_RAW_MATCH, MINIMAL_RAW_TIMELINE);

      expect(review).toBeUndefined();
    });

    test("returns undefined for arena match", async () => {
      const match = {
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
              gold: 10000,
              damage: 50000,
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
            teammate: {
              championName: "Talon",
              riotIdGameName: "Teammate#NA1",
              kills: 12,
              deaths: 3,
              assists: 11,
              level: 18,
              items: [],
              gold: 9500,
              damage: 45000,
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
          },
        ],
        teams: [],
      } satisfies ArenaMatch;

      const review = await generateMatchReview(match, TEST_MATCH_ID, MINIMAL_RAW_MATCH, MINIMAL_RAW_TIMELINE);

      expect(review).toBeUndefined();
    });
  });
});
