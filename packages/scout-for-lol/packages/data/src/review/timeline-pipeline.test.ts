import { describe, expect, mock, test } from "bun:test";

import { RawMatchSchema, type RawMatch } from "#src/league/raw-match.schema.ts";
import {
  RawTimelineSchema,
  type RawTimeline,
} from "#src/league/raw-timeline.schema.ts";
import { runTimelineSummaryWithChunks } from "#src/review/timeline-pipeline.ts";
import type {
  OpenAIClient,
  ModelConfig,
  PipelineStageName,
} from "#src/review/pipeline-types.ts";

const MODEL: ModelConfig = {
  model: "gpt-test",
  maxTokens: 8000,
  temperature: 0.3,
};

function buildRawMatchFixture(): RawMatch {
  return RawMatchSchema.parse({
    metadata: {
      dataVersion: "2",
      matchId: "NA1_1234567890",
      participants: [],
    },
    info: {
      endOfGameResult: "GameComplete",
      gameCreation: 0,
      gameDuration: 1800,
      gameEndTimestamp: 1800,
      gameId: 1_234_567_890,
      gameMode: "CLASSIC",
      gameName: "test",
      gameStartTimestamp: 0,
      gameType: "MATCHED_GAME",
      gameVersion: "14.1.1",
      mapId: 11,
      participants: [],
      platformId: "NA1",
      queueId: 420,
      teams: [],
      tournamentCode: "",
    },
  });
}

function buildRawTimelineFixture(): RawTimeline {
  return RawTimelineSchema.parse({
    metadata: {
      dataVersion: "2",
      matchId: "NA1_1234567890",
      participants: [],
    },
    info: {
      frameInterval: 60_000,
      frames: [0, 600_000, 1_200_000, 1_800_000].map((timestamp) => ({
        events: [{ timestamp, type: "CHAMPION_SPECIAL_KILL" }],
        participantFrames: {},
        timestamp,
      })),
      gameId: 1_234_567_890,
      participants: [],
    },
  });
}

type RecordedCall = {
  maxCompletionTokens: number;
};

function buildConcurrencyCheckingClient(): {
  client: OpenAIClient;
  calls: RecordedCall[];
  getMaxConcurrentRequests: () => number;
} {
  const calls: RecordedCall[] = [];
  let activeRequests = 0;
  let maxConcurrentRequests = 0;

  const client: OpenAIClient = {
    chat: {
      completions: {
        create: async (params) => {
          activeRequests++;
          maxConcurrentRequests = Math.max(
            maxConcurrentRequests,
            activeRequests,
          );
          calls.push({ maxCompletionTokens: params.max_completion_tokens });
          await Promise.resolve();
          activeRequests--;
          return {
            choices: [
              {
                message: { content: `summary-${calls.length.toString()}` },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          };
        },
      },
    },
  };

  return {
    client,
    calls,
    getMaxConcurrentRequests: () => maxConcurrentRequests,
  };
}

describe("runTimelineSummaryWithChunks", () => {
  test("processes timeline chunks sequentially with capped chunk output tokens", async () => {
    const { client, calls, getMaxConcurrentRequests } =
      buildConcurrencyCheckingClient();
    const reportedStages: PipelineStageName[] = [];
    const reportProgress = mock((stage: PipelineStageName) => {
      reportedStages.push(stage);
    });

    const result = await runTimelineSummaryWithChunks({
      rawTimeline: buildRawTimelineFixture(),
      rawMatch: buildRawMatchFixture(),
      laneContext: "mid lane",
      client,
      model: MODEL,
      systemPrompt: "timeline system",
      userPrompt: "timeline user {{TIMELINE_DATA}}",
      reportProgress,
    });

    expect(getMaxConcurrentRequests()).toBe(1);
    expect(reportedStages).toEqual(["timeline-chunk", "timeline-aggregate"]);
    expect(calls.map((call) => call.maxCompletionTokens)).toEqual([
      2000, 2000, 2000, 4000,
    ]);
    expect(result?.chunkSummaries).toEqual([
      "summary-1",
      "summary-2",
      "summary-3",
    ]);
    expect(result?.chunkTraces?.map((trace) => trace.chunkIndex)).toEqual([
      0, 1, 2,
    ]);
  });
});
