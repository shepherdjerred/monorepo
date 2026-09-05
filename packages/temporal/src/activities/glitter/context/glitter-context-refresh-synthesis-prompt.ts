import type { StyleCard } from "@shepherdjerred/glitter-context/schema";
import type { CurrentMessage } from "#shared/glitter-corpus.ts";
import type { StyleRefreshCandidate } from "./glitter-context-refresh-selection.ts";
import type { SummarizedChunk } from "./glitter-context-refresh-style-generation-cost.ts";
import { priorFieldValues } from "./glitter-context-refresh-style-finalize.ts";
import {
  STYLE_ARRAY_FIELDS,
  type StyleSynthesis,
} from "./glitter-context-refresh-style-schemas.ts";

function messageEvidence(message: CurrentMessage): {
  messageId: string;
  timestamp: string;
  content: string;
} {
  return {
    messageId: message.messageId,
    timestamp: message.timestamp,
    content: message.content,
  };
}

export function synthesisPrompt(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
  chunks: readonly SummarizedChunk[];
  directRecentMessages: readonly CurrentMessage[];
  repair: { previous: StyleSynthesis; error: string } | null;
  includeRepairPrevious: boolean;
}): string {
  const base = [
    "Patch this human-reviewed style card from bounded safe-corpus evidence.",
    "Return one patch for every listed array field and one decision for every prior index.",
    "Also patch every prior summary item and every prior League entry by index.",
    "Retain prior observations unless contradicted or explicitly judged low-confidence.",
    "Retained observations are copied by the application; do not rewrite them.",
    "Contradicted removals require corpus evidence. Low-confidence removals must use",
    "confidence <= 0.3 and explain the judgment.",
    "Additions require confidence >= 0.7 and cited message IDs.",
    "Choose 20 unique quote IDs and 30 unique sample IDs from the safe evidence.",
    "Situational examples are synthetic and must contain exactly three per mood.",
    "Keep descriptive prose close to the prior card; application validation enforces 85-115%.",
    "Do not infer sensitive traits, diagnoses, identity, or private facts.",
    "",
    JSON.stringify({
      person: {
        id: input.candidate.person.id,
        displayName: input.candidate.person.displayName,
      },
      patchFields: STYLE_ARRAY_FIELDS.map((field) => ({
        field,
        prior: priorFieldValues(input.existingCard, field).map(
          (value, priorIndex) => ({ priorIndex, value }),
        ),
      })),
      summaryPatch: {
        prior:
          typeof input.existingCard.summary === "string"
            ? [{ priorIndex: 0, value: input.existingCard.summary }]
            : input.existingCard.summary.map((value, priorIndex) => ({
                priorIndex,
                value,
              })),
      },
      leaguePatch: {
        prior: Object.entries(input.existingCard.league).map(
          ([key, value], priorIndex) => ({ priorIndex, key, value }),
        ),
      },
      chunkSummaries: input.chunks,
      directRecentMessages: input.directRecentMessages.map((message) =>
        messageEvidence(message),
      ),
    }),
  ].join("\n");
  return input.repair === null
    ? base
    : [
        base,
        "",
        "Repair the prior structured output so it passes deterministic validation.",
        JSON.stringify({
          previous: input.includeRepairPrevious
            ? input.repair.previous
            : "omitted because the prior invalid response exceeded the bounded request budget",
          error: input.repair.error,
        }),
      ].join("\n");
}
