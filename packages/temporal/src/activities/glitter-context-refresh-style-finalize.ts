import { z } from "zod/v4";
import {
  StyleCardV2Schema,
  type StyleCard,
  type StyleCardV2,
} from "@shepherdjerred/glitter-context/schema";
import type { StyleRefreshCandidate } from "./glitter-context-refresh-selection.ts";
import { requireKnownEvidence } from "./glitter-context-refresh-evidence.ts";
import {
  STYLE_ARRAY_FIELDS,
  StyleArrayFieldSchema,
  type GeneratedLeagueValue,
  type PriorDecision,
  type StyleArrayField,
  type StyleSynthesis,
} from "./glitter-context-refresh-style-schemas.ts";

export function priorFieldValues(
  styleCard: StyleCard,
  field: StyleArrayField,
): string[] {
  return styleCard[field] ?? [];
}

function retainedPriorIndexes(input: {
  label: string;
  priorLength: number;
  decisions: readonly PriorDecision[];
  knownEvidenceIds: ReadonlySet<string>;
}): Set<number> {
  const decisionsByIndex = new Map(
    input.decisions.map((decision) => [decision.priorIndex, decision]),
  );
  if (
    decisionsByIndex.size !== input.priorLength ||
    [...decisionsByIndex.keys()].some(
      (index) => index < 0 || index >= input.priorLength,
    )
  ) {
    throw new Error(
      `style synthesis did not decide every prior ${input.label} observation exactly once`,
    );
  }
  const retained = new Set<number>();
  for (let index = 0; index < input.priorLength; index += 1) {
    const decision = decisionsByIndex.get(index);
    if (decision === undefined) {
      throw new Error(
        `style synthesis omitted ${input.label}[${String(index)}]`,
      );
    }
    requireKnownEvidence(
      decision.evidenceMessageIds,
      input.knownEvidenceIds,
      `${input.label}[${String(index)}] decision`,
    );
    if (decision.decision === "retain") {
      if (decision.removalBasis !== null || decision.rationale !== null) {
        throw new Error(
          `retained ${input.label}[${String(index)}] has removal metadata`,
        );
      }
      retained.add(index);
      continue;
    }
    if (decision.removalBasis === null || decision.rationale === null) {
      throw new Error(
        `removed ${input.label}[${String(index)}] lacks a typed rationale`,
      );
    }
    if (
      decision.removalBasis === "contradicted" &&
      decision.evidenceMessageIds.length === 0
    ) {
      throw new Error(
        `contradicted ${input.label}[${String(index)}] lacks evidence`,
      );
    }
    if (
      decision.removalBasis === "explicit-low-confidence-judgment" &&
      decision.confidence > 0.3
    ) {
      throw new Error(
        `low-confidence removal for ${input.label}[${String(index)}] exceeds 0.3`,
      );
    }
  }
  return retained;
}

function requireAdditionEvidence(
  label: string,
  additions: readonly { evidenceMessageIds: readonly string[] }[],
  knownEvidenceIds: ReadonlySet<string>,
): void {
  for (const addition of additions) {
    requireKnownEvidence(
      addition.evidenceMessageIds,
      knownEvidenceIds,
      `${label} addition`,
    );
  }
}

function applyPatches(input: {
  existingCard: StyleCard;
  synthesis: StyleSynthesis;
  knownEvidenceIds: ReadonlySet<string>;
}): Record<StyleArrayField, string[]> {
  const patchesByField = new Map(
    input.synthesis.patches.map((patch) => [patch.field, patch]),
  );
  if (patchesByField.size !== STYLE_ARRAY_FIELDS.length) {
    throw new Error(
      "style synthesis returned duplicate or missing field patches",
    );
  }

  const result = Object.fromEntries(
    STYLE_ARRAY_FIELDS.map((field) => {
      const prior = priorFieldValues(input.existingCard, field);
      const patch = patchesByField.get(field);
      if (patch === undefined) {
        throw new Error(`style synthesis omitted the ${field} patch`);
      }
      const retainedIndexes = retainedPriorIndexes({
        label: field,
        priorLength: prior.length,
        decisions: patch.priorDecisions,
        knownEvidenceIds: input.knownEvidenceIds,
      });
      const retained = prior.filter((_, index) => retainedIndexes.has(index));
      requireAdditionEvidence(field, patch.additions, input.knownEvidenceIds);
      return [
        field,
        [...retained, ...patch.additions.map((addition) => addition.value)],
      ];
    }),
  );
  return z.record(StyleArrayFieldSchema, z.array(z.string())).parse(result);
}

function stringValues(value: unknown): string[] {
  const stringResult = z.string().safeParse(value);
  if (stringResult.success) {
    return [stringResult.data];
  }
  const arrayResult = z.array(z.string()).safeParse(value);
  if (arrayResult.success) {
    return arrayResult.data;
  }
  const lanesResult = z
    .strictObject({ likes: z.array(z.string()), dislikes: z.array(z.string()) })
    .safeParse(value);
  return lanesResult.success
    ? [...lanesResult.data.likes, ...lanesResult.data.dislikes]
    : [];
}

function applySummaryPatch(input: {
  existingCard: StyleCard;
  synthesis: StyleSynthesis;
  knownEvidenceIds: ReadonlySet<string>;
}): string[] {
  const prior = stringValues(input.existingCard.summary);
  const retainedIndexes = retainedPriorIndexes({
    label: "summary",
    priorLength: prior.length,
    decisions: input.synthesis.summaryPatch.priorDecisions,
    knownEvidenceIds: input.knownEvidenceIds,
  });
  requireAdditionEvidence(
    "summary",
    input.synthesis.summaryPatch.additions,
    input.knownEvidenceIds,
  );
  const summary = [
    ...prior.filter((_, index) => retainedIndexes.has(index)),
    ...input.synthesis.summaryPatch.additions.map((addition) => addition.value),
  ];
  if (summary.length === 0) {
    throw new Error("style synthesis removed the complete summary");
  }
  return summary;
}

function applyLeaguePatch(input: {
  existingCard: StyleCard;
  synthesis: StyleSynthesis;
  knownEvidenceIds: ReadonlySet<string>;
}): Record<string, GeneratedLeagueValue> {
  const prior = Object.entries(input.existingCard.league);
  const retainedIndexes = retainedPriorIndexes({
    label: "league",
    priorLength: prior.length,
    decisions: input.synthesis.leaguePatch.priorDecisions,
    knownEvidenceIds: input.knownEvidenceIds,
  });
  requireAdditionEvidence(
    "league",
    input.synthesis.leaguePatch.additions,
    input.knownEvidenceIds,
  );
  const league: Record<string, GeneratedLeagueValue> = {};
  for (const [index, entry] of prior.entries()) {
    if (retainedIndexes.has(index)) {
      const [key, value] = entry;
      league[key] = value;
    }
  }
  for (const addition of input.synthesis.leaguePatch.additions) {
    if (Object.hasOwn(league, addition.key)) {
      throw new Error("style synthesis returned duplicate league keys");
    }
    league[addition.key] = addition.value;
  }
  return league;
}

function descriptiveWordCount(card: StyleCard): number {
  const fields = STYLE_ARRAY_FIELDS.flatMap((field) =>
    priorFieldValues(card, field),
  );
  const summary = stringValues(card.summary);
  const league = Object.values(card.league).flatMap((value) =>
    stringValues(value),
  );
  return [...fields, ...summary, ...league]
    .join(" ")
    .split(/\s+/u)
    .filter((word) => word.length > 0).length;
}

export function finalizeStyleSynthesis(input: {
  candidate: StyleRefreshCandidate;
  existingCard: StyleCard;
  sourceSnapshotSha256: string;
  chunkCount: number;
  synthesis: StyleSynthesis;
}): StyleCardV2 {
  const allMessagesById = new Map(
    input.candidate.safeMessages.map((message) => [message.messageId, message]),
  );
  const knownEvidenceIds = new Set(allMessagesById.keys());
  const fields = applyPatches({
    existingCard: input.existingCard,
    synthesis: input.synthesis,
    knownEvidenceIds,
  });
  const summary = applySummaryPatch({
    existingCard: input.existingCard,
    synthesis: input.synthesis,
    knownEvidenceIds,
  });
  const league = applyLeaguePatch({
    existingCard: input.existingCard,
    synthesis: input.synthesis,
    knownEvidenceIds,
  });
  const quoteIds = new Set(input.synthesis.quoteMessageIds);
  const sampleIds = new Set(input.synthesis.sampleMessageIds);
  if (quoteIds.size !== 20 || sampleIds.size !== 30) {
    throw new Error("style synthesis returned duplicate quote or sample IDs");
  }
  requireKnownEvidence(
    input.synthesis.quoteMessageIds,
    knownEvidenceIds,
    "quotes",
  );
  requireKnownEvidence(
    input.synthesis.sampleMessageIds,
    knownEvidenceIds,
    "sample messages",
  );
  const firstCorpusMessage = input.candidate.messages[0];
  const lastCorpusMessage = input.candidate.messages.at(-1);
  const firstSafeMessage = input.candidate.safeMessages[0];
  const lastSafeMessage = input.candidate.safeMessages.at(-1);
  if (
    firstCorpusMessage === undefined ||
    lastCorpusMessage === undefined ||
    firstSafeMessage === undefined ||
    lastSafeMessage === undefined
  ) {
    throw new Error(
      `style refresh candidate ${input.candidate.person.id} lacks coverage messages`,
    );
  }
  const contentForIds = (messageIds: readonly string[]): string[] =>
    messageIds.map((messageId) => {
      const message = allMessagesById.get(messageId);
      if (message === undefined) {
        throw new Error(`missing safe message ${messageId}`);
      }
      return message.content;
    });
  const card = StyleCardV2Schema.parse({
    schemaVersion: 2,
    author: input.existingCard.author,
    coverage: {
      source_snapshot_sha256: input.sourceSnapshotSha256,
      corpus: {
        messages: input.candidate.totalMessageCount,
        date_range: {
          start: firstCorpusMessage.timestamp,
          end: lastCorpusMessage.timestamp,
        },
      },
      evidence: {
        safe_messages: input.candidate.safeMessages.length,
        summarized_messages: input.candidate.safeMessages.length,
        chunks: input.chunkCount,
        direct_recent_messages: input.candidate.directRecentMessages.length,
        date_range: {
          start: firstSafeMessage.timestamp,
          end: lastSafeMessage.timestamp,
        },
        strategy: "all-safe-monthly-chunks-plus-latest-500",
      },
      notes:
        "Generated from the checksum-verified Discord corpus; human review required.",
    },
    ...fields,
    summary,
    league,
    quotes: contentForIds(input.synthesis.quoteMessageIds),
    sample_messages: contentForIds(input.synthesis.sampleMessageIds),
    situational_examples: input.synthesis.situational_examples,
  });
  const priorWords = descriptiveWordCount(input.existingCard);
  const generatedWords = descriptiveWordCount(card);
  const minimumWords = Math.ceil(priorWords * 0.85);
  const maximumWords = Math.floor(priorWords * 1.15);
  if (
    priorWords > 0 &&
    (generatedWords < minimumWords || generatedWords > maximumWords)
  ) {
    throw new Error(
      `style synthesis prose length ${String(generatedWords)} is outside ${String(minimumWords)}-${String(maximumWords)} words`,
    );
  }
  return card;
}
