import type { Prisma } from "#generated/prisma/client/index.js";
import type { MemoryCandidate } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  hasEnvelopeEvidenceNotInClaim,
  isEnvelopeOlderThanClaim,
  isEnvelopeSameSourceAsClaim,
} from "@shepherdjerred/birmel/memory/application-order.ts";
import type {
  MemoryApplicationContext,
  MemoryCandidateEnvelope,
} from "@shepherdjerred/birmel/memory/schemas.ts";
import {
  deserializeDiscordIds,
  serializeDiscordIds,
  serializeEmbedding,
} from "@shepherdjerred/birmel/memory/serialization.ts";
import {
  memoryClaimWithRevisions,
  parseStoredMemoryClaim,
  type StoredMemoryClaim,
} from "@shepherdjerred/birmel/memory/stored.ts";

export type ClaimPersistenceRequest = {
  transaction: Prisma.TransactionClient;
  context: MemoryApplicationContext;
  envelope: MemoryCandidateEnvelope;
  reactivateForgotten: boolean;
  now: Date;
};

export type PersistedIncomingClaim = {
  claimId: string;
  created: boolean;
  previousValue: string | null;
  ignored: boolean;
};

function parseValidity(candidate: MemoryCandidate): {
  validFrom: Date | null;
  validUntil: Date | null;
} {
  const validFrom =
    candidate.validFrom === null ? null : new Date(candidate.validFrom);
  const validUntil =
    candidate.validUntil === null ? null : new Date(candidate.validUntil);
  if (
    validFrom !== null &&
    validUntil !== null &&
    validFrom.getTime() > validUntil.getTime()
  ) {
    throw new Error("Memory validity start must not be after its end");
  }
  return { validFrom, validUntil };
}

export function buildIncomingStoredClaim(
  request: ClaimPersistenceRequest,
  identityKey: string,
): StoredMemoryClaim {
  const { candidate, embedding } = request.envelope;
  const relatedUserIds = serializeDiscordIds(candidate.relatedUserIds);
  const parsedRelatedUserIds = deserializeDiscordIds(relatedUserIds);
  const userId =
    candidate.scope === "user"
      ? (parsedRelatedUserIds[0] ?? request.context.userId)
      : null;
  const channelId =
    candidate.scope === "channel" ? request.context.channelId : null;
  const personaId =
    candidate.scope === "persona" ? request.context.personaId : null;
  if (personaId === null && candidate.scope === "persona") {
    throw new Error("Persona memory requires a personaId");
  }
  if (candidate.scope === "relationship" && parsedRelatedUserIds.length < 2) {
    throw new Error("Relationship memory requires at least two related users");
  }
  if (candidate.scope === "user" && parsedRelatedUserIds.length > 1) {
    throw new Error("User memory accepts at most one related user");
  }
  const validity = parseValidity(candidate);
  return parseStoredMemoryClaim({
    id: crypto.randomUUID(),
    identityKey,
    guildId: request.context.guildId,
    scope: candidate.scope,
    subject: candidate.subject.trim(),
    predicate: candidate.predicate.trim(),
    value: candidate.value.trim(),
    confidence: candidate.confidence,
    salience: candidate.salience,
    origin: candidate.origin,
    validFrom: validity.validFrom,
    validUntil: validity.validUntil,
    status: "active",
    channelId,
    personaId,
    userId,
    relatedUserIds,
    embedding: serializeEmbedding(embedding),
    lastConfirmedAt: request.now,
    createdAt: request.now,
    updatedAt: request.now,
    revisions: [],
  });
}

export async function persistIncomingClaim(
  request: ClaimPersistenceRequest,
  incoming: StoredMemoryClaim,
  status: "active" | "uncertain" | "superseded",
): Promise<PersistedIncomingClaim> {
  const existing = await request.transaction.memoryClaim.findUnique({
    where: { identityKey: incoming.identityKey },
    include: memoryClaimWithRevisions,
  });
  if (existing === null) {
    const created = await request.transaction.memoryClaim.create({
      data: {
        identityKey: incoming.identityKey,
        guildId: incoming.guildId,
        scope: incoming.scope,
        subject: incoming.subject,
        predicate: incoming.predicate,
        value: incoming.value,
        confidence: incoming.confidence,
        salience: incoming.salience,
        origin: incoming.origin,
        validFrom: incoming.validFrom,
        validUntil: incoming.validUntil,
        status,
        channelId: incoming.channelId,
        personaId: incoming.personaId,
        userId: incoming.userId,
        relatedUserIds: incoming.relatedUserIds,
        embedding: incoming.embedding,
        lastConfirmedAt: request.now,
      },
    });
    return {
      claimId: created.id,
      created: true,
      previousValue: null,
      ignored: false,
    };
  }

  const storedExisting = parseStoredMemoryClaim(existing);
  const promotesExplicitEvidence =
    storedExisting.origin === "inferred" && incoming.origin === "explicit";
  const chronologicallyStale =
    isEnvelopeOlderThanClaim(request.envelope, storedExisting) ||
    isEnvelopeSameSourceAsClaim(request.envelope, storedExisting);
  const addsEvidence = hasEnvelopeEvidenceNotInClaim(
    request.envelope,
    storedExisting,
  );
  if (
    (storedExisting.status === "forgotten" && !request.reactivateForgotten) ||
    (chronologicallyStale && !promotesExplicitEvidence && !addsEvidence)
  ) {
    return {
      claimId: storedExisting.id,
      created: false,
      previousValue: storedExisting.value,
      ignored: true,
    };
  }
  const explicitOrigin =
    storedExisting.origin === "explicit" || incoming.origin === "explicit";
  const updated = await request.transaction.memoryClaim.update({
    where: { id: storedExisting.id },
    data: {
      value: incoming.value,
      confidence: Math.max(storedExisting.confidence, incoming.confidence),
      salience: Math.max(storedExisting.salience, incoming.salience),
      origin: explicitOrigin ? "explicit" : "inferred",
      status,
      embedding: incoming.embedding ?? storedExisting.embedding,
      lastConfirmedAt: chronologicallyStale
        ? storedExisting.lastConfirmedAt
        : request.now,
    },
  });
  return {
    claimId: updated.id,
    created: false,
    previousValue: storedExisting.value,
    ignored: false,
  };
}
