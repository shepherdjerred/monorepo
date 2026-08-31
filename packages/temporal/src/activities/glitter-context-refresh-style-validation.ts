import type { StyleEvidenceChunk } from "./glitter-context-refresh-chunks.ts";
import { requireKnownEvidence } from "./glitter-context-refresh-evidence.ts";
import type { ChunkExtractionRepair } from "./glitter-context-refresh-requests.ts";
import type { SummarizedChunk } from "./glitter-context-refresh-style-generation-cost.ts";
import {
  StyleChunkSummarySchema,
  type StyleChunkSummary,
} from "./glitter-context-refresh-style-schemas.ts";

/** The degraded result for a chunk the model never summarized validly. */
export const EMPTY_CHUNK_SUMMARY: StyleChunkSummary = {
  observations: [],
  representativeMessages: [],
};

/** How much citable evidence a summary carries, used to rank repair attempts. */
export function verifiableContent(summary: StyleChunkSummary): number {
  return summary.observations.length + summary.representativeMessages.length;
}

/**
 * A chunk contributes its messages to the card's coverage only when it yielded
 * usable evidence. A chunk that yielded none influenced nothing, so counting it
 * would make the card advertise a month it silently omits.
 */
export function summarizedMessageCount(
  chunk: StyleEvidenceChunk,
  summary: StyleChunkSummary,
): number {
  return verifiableContent(summary) === 0 ? 0 : chunk.messages.length;
}

/**
 * Carries the repair context forward across extraction attempts. A parse
 * failure has no previous summary to repair against, so the first one records
 * the empty summary and later ones keep the last real failure's context.
 */
export function nextParseFailureRepair(
  prior: ChunkExtractionRepair | null,
  error: string,
  rawContent: string | null,
): ChunkExtractionRepair {
  if (prior === null || prior.previous === EMPTY_CHUNK_SUMMARY) {
    return { previous: EMPTY_CHUNK_SUMMARY, error, rawContent };
  }
  return { previous: prior.previous, error: prior.error, rawContent: null };
}

/**
 * Reduces a chunk's repair attempts to the one worth keeping.
 *
 * No attempt parsed at all: there is nothing to sanitize, so the chunk degrades
 * to {@link EMPTY_CHUNK_SUMMARY} rather than stranding the whole run — observed
 * live when the model degenerates into a repetition loop on one chunk and the
 * resulting failure artifact is cached, replaying forever.
 *
 * Otherwise the model could not produce a fully valid summary even after
 * repairs (it deterministically cites an unverifiable in-content ID), so every
 * attempt is sanitized and the one retaining the most verifiable evidence wins:
 * an earlier attempt's valid observations are not lost to a worse final repair.
 * The winner is re-validated to prove it now satisfies the contract.
 */
export function selectBestChunkSummary(
  chunk: StyleEvidenceChunk,
  attempts: readonly StyleChunkSummary[],
): StyleChunkSummary {
  if (attempts.length === 0) {
    return EMPTY_CHUNK_SUMMARY;
  }
  const best = attempts
    .map((attempt) => sanitizeChunkSummary(chunk, attempt))
    .reduce((strongest, candidate) =>
      verifiableContent(candidate) > verifiableContent(strongest)
        ? candidate
        : strongest,
    );
  validateChunkSummary(chunk, best);
  return best;
}

/** Pairs a chunk with its summary for synthesis, carrying its time span. */
export function toSummarizedChunk(
  chunk: StyleEvidenceChunk,
  summary: StyleChunkSummary,
): SummarizedChunk {
  const firstMessage = chunk.messages[0];
  const lastMessage = chunk.messages.at(-1);
  if (firstMessage === undefined || lastMessage === undefined) {
    throw new Error(`style evidence chunk ${chunk.key} is empty`);
  }
  return {
    key: chunk.key,
    month: chunk.month,
    startTimestamp: firstMessage.timestamp,
    endTimestamp: lastMessage.timestamp,
    summary,
    summarizedMessageCount: summarizedMessageCount(chunk, summary),
  };
}

export function validateChunkSummary(
  chunk: StyleEvidenceChunk,
  summary: StyleChunkSummary,
): void {
  const messagesById = new Map(
    chunk.messages.map((message) => [message.messageId, message]),
  );
  const knownIds = new Set(messagesById.keys());
  for (const observation of summary.observations) {
    requireKnownEvidence(
      observation.evidenceMessageIds,
      knownIds,
      `chunk ${chunk.key} observation`,
    );
  }
  const representativeIds = new Set<string>();
  for (const representative of summary.representativeMessages) {
    const message = messagesById.get(representative.messageId);
    if (message?.content !== representative.content) {
      throw new Error(
        `chunk ${chunk.key} returned non-verbatim representative message ${representative.messageId}`,
      );
    }
    if (representativeIds.has(representative.messageId)) {
      throw new Error(
        `chunk ${chunk.key} returned duplicate representative message ${representative.messageId}`,
      );
    }
    representativeIds.add(representative.messageId);
  }
}

// Boundary sanitizer for untrusted model output. Drops any observation that
// cites a message ID which is not a top-level message in this chunk (the model
// sometimes surfaces an ID embedded in another message's content), and drops
// non-verbatim or duplicate representative messages. An observation is dropped
// whole rather than having its unknown IDs stripped: if the claim was actually
// supported by the removed message, keeping it against the surviving citation
// would launder an unsupported claim into a "verified" one. The result satisfies
// `validateChunkSummary` by construction. Used as the convergence fallback once
// the repair loop is exhausted, so a chunk the model can never cite cleanly
// degrades to its fully-verifiable subset instead of failing the whole run.
export function sanitizeChunkSummary(
  chunk: StyleEvidenceChunk,
  summary: StyleChunkSummary,
): StyleChunkSummary {
  const messagesById = new Map(
    chunk.messages.map((message) => [message.messageId, message]),
  );
  const knownIds = new Set(messagesById.keys());
  const observations = summary.observations.filter((observation) =>
    observation.evidenceMessageIds.every((id) => knownIds.has(id)),
  );
  const seenRepresentatives = new Set<string>();
  const representativeMessages = summary.representativeMessages.filter(
    (representative) => {
      const message = messagesById.get(representative.messageId);
      if (message?.content !== representative.content) {
        return false;
      }
      if (seenRepresentatives.has(representative.messageId)) {
        return false;
      }
      seenRepresentatives.add(representative.messageId);
      return true;
    },
  );
  return StyleChunkSummarySchema.parse({
    observations,
    representativeMessages,
  });
}
