import type { PipelineTraces, StageTrace } from "@scout-for-lol/data";
import { describe, expect, test } from "bun:test";

import {
  buildMaterializedGeneration,
  freezeRenderedPrompts,
} from "#materialization/materialize-case.ts";

function stageTrace(stage: string): StageTrace {
  return {
    request: {
      systemPrompt: `${stage} system`,
      userPrompt: `${stage} user`,
    },
    response: { text: `${stage} response` },
    model: { maxTokens: 1000, model: "gpt-test" },
    durationMs: 10,
  };
}

function multiChunkTraces(): PipelineTraces {
  return {
    matchSummary: stageTrace("match-summary"),
    timelineChunks: [
      {
        chunkIndex: 0,
        timeRange: "0:00 - 10:00",
        trace: stageTrace("timeline-chunk-0"),
      },
      {
        chunkIndex: 1,
        timeRange: "10:00 - 20:00",
        trace: stageTrace("timeline-chunk-1"),
      },
    ],
    timelineSummary: stageTrace("timeline-aggregate"),
    reviewText: stageTrace("review-text"),
  };
}

describe("freezeRenderedPrompts", () => {
  test("preserves every rendered prompt and ordered timeline chunk", () => {
    expect(freezeRenderedPrompts(multiChunkTraces())).toEqual({
      matchSummary: {
        systemPrompt: "match-summary system",
        userPrompt: "match-summary user",
      },
      timeline: {
        mode: "chunked",
        chunks: [
          {
            chunkIndex: 0,
            timeRange: "0:00 - 10:00",
            systemPrompt: "timeline-chunk-0 system",
            userPrompt: "timeline-chunk-0 user",
          },
          {
            chunkIndex: 1,
            timeRange: "10:00 - 20:00",
            systemPrompt: "timeline-chunk-1 system",
            userPrompt: "timeline-chunk-1 user",
          },
        ],
        aggregate: {
          systemPrompt: "timeline-aggregate system",
          userPrompt: "timeline-aggregate user",
        },
      },
      reviewText: {
        systemPrompt: "review-text system",
        userPrompt: "review-text user",
      },
    });
  });

  test("rejects timeline chunks that are not in contiguous index order", () => {
    const traces = multiChunkTraces();
    if (traces.timelineChunks === undefined) {
      throw new Error("Multi-chunk trace fixture has no timeline chunks");
    }
    traces.timelineChunks.reverse();

    expect(() => freezeRenderedPrompts(traces)).toThrow(
      "Timeline chunk index 1 must match its array position 0",
    );
  });
});

describe("buildMaterializedGeneration", () => {
  test("carries the initial materialization prompts into the generation", () => {
    const traces = multiChunkTraces();
    const renderedPrompts = freezeRenderedPrompts(traces);

    expect(
      buildMaterializedGeneration({
        outputText: "A generated review.",
        renderedPrompts,
        trace: traces.reviewText,
      }),
    ).toMatchObject({
      outputText: "A generated review.",
      promptRevision:
        "ea74739b82bee79254c160ca4b2df5a1c3322a417ea3da1d8e7c0b4dfbfd0d20",
      renderedPrompts,
    });
  });
});
