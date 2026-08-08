import type {
  ApplyMemoryCandidatesInput,
  MemoryApplicationContext,
  MemoryCandidateEnvelope,
} from "@shepherdjerred/birmel/memory/schemas.ts";
import { deserializeDiscordIds } from "@shepherdjerred/birmel/memory/serialization.ts";
import type { StoredMemoryClaim } from "@shepherdjerred/birmel/memory/stored.ts";

export type RevisionProvenance = {
  authorUserId: string;
  channelId: string;
  extractorModel: string;
};

export type PreparedMemoryApplication = {
  envelope: MemoryCandidateEnvelope;
  context: MemoryApplicationContext;
  provenance: RevisionProvenance;
};

function latestClaimSourceOrder(claim: StoredMemoryClaim): bigint | null {
  let latest: bigint | null = null;
  for (const revision of claim.revisions) {
    for (const messageId of deserializeDiscordIds(
      revision.sourceDiscordMessageIds,
    )) {
      const order = BigInt(messageId);
      if (latest === null || order > latest) {
        latest = order;
      }
    }
  }
  return latest;
}

function claimEvidenceIds(claim: StoredMemoryClaim): Set<string> {
  return new Set(
    claim.revisions.flatMap((revision) =>
      deserializeDiscordIds(revision.sourceDiscordMessageIds),
    ),
  );
}

export function hasEnvelopeEvidenceNotInClaim(
  envelope: MemoryCandidateEnvelope,
  claim: StoredMemoryClaim,
): boolean {
  const existingEvidence = claimEvidenceIds(claim);
  return envelope.candidate.sourceDiscordMessageIds.some(
    (messageId) => !existingEvidence.has(messageId),
  );
}

export function isEnvelopeOlderThanClaim(
  envelope: MemoryCandidateEnvelope,
  claim: StoredMemoryClaim,
): boolean {
  const sourceOrder = envelope.provenance?.sourceOrder;
  const existing = latestClaimSourceOrder(claim);
  return (
    sourceOrder != null && existing !== null && BigInt(sourceOrder) < existing
  );
}

export function isEnvelopeSameSourceAsClaim(
  envelope: MemoryCandidateEnvelope,
  claim: StoredMemoryClaim,
): boolean {
  const sourceOrder = envelope.provenance?.sourceOrder;
  const existing = latestClaimSourceOrder(claim);
  return (
    sourceOrder != null && existing !== null && BigInt(sourceOrder) === existing
  );
}

function compareEnvelopes(
  left: { envelope: MemoryCandidateEnvelope; index: number },
  right: { envelope: MemoryCandidateEnvelope; index: number },
): number {
  const leftOrder = left.envelope.provenance?.sourceOrder;
  const rightOrder = right.envelope.provenance?.sourceOrder;
  if (leftOrder == null || rightOrder == null) {
    return left.index - right.index;
  }
  const leftValue = BigInt(leftOrder);
  const rightValue = BigInt(rightOrder);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export function prepareMemoryApplications(
  input: ApplyMemoryCandidatesInput,
): PreparedMemoryApplication[] {
  return input.candidates
    .map((envelope, index) => ({ envelope, index }))
    .toSorted(compareEnvelopes)
    .map(({ envelope }) => {
      const candidateProvenance = envelope.provenance;
      if (
        candidateProvenance != null &&
        !envelope.candidate.sourceDiscordMessageIds.includes(
          candidateProvenance.sourceOrder,
        )
      ) {
        throw new Error(
          "Memory candidate source order must cite its source ID",
        );
      }
      const provenance: RevisionProvenance = {
        authorUserId:
          candidateProvenance?.authorUserId ?? input.context.authorUserId,
        channelId: candidateProvenance?.channelId ?? input.context.channelId,
        extractorModel: input.context.extractorModel,
      };
      return {
        envelope,
        provenance,
        context: {
          ...input.context,
          channelId: provenance.channelId,
          userId: candidateProvenance?.authorUserId ?? input.context.userId,
          authorUserId: provenance.authorUserId,
        },
      };
    });
}
