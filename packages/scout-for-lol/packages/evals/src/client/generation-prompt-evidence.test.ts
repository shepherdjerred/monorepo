import { describe, expect, test } from "bun:test";

import {
  generationPromptEvidence,
  type GenerationPromptEvidence,
} from "#client/generation-prompt-evidence.ts";
import { FrozenRenderedPromptsSchema } from "#shared/schema.ts";

const matchSummary = {
  systemPrompt: "match-summary system",
  userPrompt: "match-summary user",
};
const reviewText = {
  systemPrompt: "final-review system",
  userPrompt: "final-review user",
};
const matchSummaryEvidence: GenerationPromptEvidence[] = [
  {
    key: "match-summary-system",
    label: "Match summary system prompt",
    value: "match-summary system",
  },
  {
    key: "match-summary-user",
    label: "Match summary user prompt",
    value: "match-summary user",
  },
];
const finalReviewEvidence: GenerationPromptEvidence[] = [
  {
    key: "final-review-system",
    label: "Final review system prompt",
    value: "final-review system",
  },
  {
    key: "final-review-user",
    label: "Final review user prompt",
    value: "final-review user",
  },
];

describe("generationPromptEvidence", () => {
  test("orders and preserves normal summary prompts before the final review", () => {
    const prompts = FrozenRenderedPromptsSchema.parse({
      matchSummary,
      timeline: {
        mode: "single",
        summary: {
          systemPrompt: "timeline-summary system",
          userPrompt: "timeline-summary user",
        },
      },
      reviewText,
    });

    expect(generationPromptEvidence(prompts)).toEqual([
      ...matchSummaryEvidence,
      {
        key: "timeline-summary-system",
        label: "Timeline summary system prompt",
        value: "timeline-summary system",
      },
      {
        key: "timeline-summary-user",
        label: "Timeline summary user prompt",
        value: "timeline-summary user",
      },
      ...finalReviewEvidence,
    ]);
  });

  test("orders and preserves every timeline chunk and aggregate prompt", () => {
    const prompts = FrozenRenderedPromptsSchema.parse({
      matchSummary,
      timeline: {
        mode: "chunked",
        chunks: [
          {
            chunkIndex: 0,
            timeRange: "0:00 - 10:00",
            systemPrompt: "chunk-0 system",
            userPrompt: "chunk-0 user",
          },
          {
            chunkIndex: 1,
            timeRange: "10:00 - 20:00",
            systemPrompt: "chunk-1 system",
            userPrompt: "chunk-1 user",
          },
        ],
        aggregate: {
          systemPrompt: "timeline-aggregate system",
          userPrompt: "timeline-aggregate user",
        },
      },
      reviewText,
    });

    expect(generationPromptEvidence(prompts)).toEqual([
      ...matchSummaryEvidence,
      {
        key: "timeline-chunk-0-system",
        label: "Timeline chunk 1 (0:00 - 10:00) system prompt",
        value: "chunk-0 system",
      },
      {
        key: "timeline-chunk-0-user",
        label: "Timeline chunk 1 (0:00 - 10:00) user prompt",
        value: "chunk-0 user",
      },
      {
        key: "timeline-chunk-1-system",
        label: "Timeline chunk 2 (10:00 - 20:00) system prompt",
        value: "chunk-1 system",
      },
      {
        key: "timeline-chunk-1-user",
        label: "Timeline chunk 2 (10:00 - 20:00) user prompt",
        value: "chunk-1 user",
      },
      {
        key: "timeline-aggregate-system",
        label: "Timeline aggregate system prompt",
        value: "timeline-aggregate system",
      },
      {
        key: "timeline-aggregate-user",
        label: "Timeline aggregate user prompt",
        value: "timeline-aggregate user",
      },
      ...finalReviewEvidence,
    ]);
  });
});
