import type { StyleEvidenceChunk } from "./glitter-context-refresh-chunks.ts";
import { requireKnownEvidence } from "./glitter-context-refresh-evidence.ts";
import {
  StyleChunkSummarySchema,
  type StyleChunkSummary,
} from "./glitter-context-refresh-style-schemas.ts";

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
