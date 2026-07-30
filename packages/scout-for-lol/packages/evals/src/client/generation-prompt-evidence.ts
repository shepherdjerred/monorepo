import type { FrozenRenderedPrompts } from "#shared/schema.ts";

export type GenerationPromptEvidence = {
  key: string;
  label: string;
  value: string;
};

type RenderedPrompt = {
  systemPrompt: string;
  userPrompt: string;
};

function promptEvidence(
  key: string,
  label: string,
  prompt: RenderedPrompt,
): GenerationPromptEvidence[] {
  return [
    {
      key: `${key}-system`,
      label: `${label} system prompt`,
      value: prompt.systemPrompt,
    },
    {
      key: `${key}-user`,
      label: `${label} user prompt`,
      value: prompt.userPrompt,
    },
  ];
}

export function generationPromptEvidence(
  prompts: FrozenRenderedPrompts,
): GenerationPromptEvidence[] {
  const matchSummary = promptEvidence(
    "match-summary",
    "Match summary",
    prompts.matchSummary,
  );
  const timeline =
    prompts.timeline.mode === "single"
      ? promptEvidence(
          "timeline-summary",
          "Timeline summary",
          prompts.timeline.summary,
        )
      : [
          ...prompts.timeline.chunks.flatMap((chunk) =>
            promptEvidence(
              `timeline-chunk-${chunk.chunkIndex.toString()}`,
              `Timeline chunk ${(chunk.chunkIndex + 1).toString()} (${chunk.timeRange})`,
              chunk,
            ),
          ),
          ...promptEvidence(
            "timeline-aggregate",
            "Timeline aggregate",
            prompts.timeline.aggregate,
          ),
        ];
  const finalReview = promptEvidence(
    "final-review",
    "Final review",
    prompts.reviewText,
  );

  return [...matchSummary, ...timeline, ...finalReview];
}
