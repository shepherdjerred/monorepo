import type { Prisma, PrismaClient } from "#generated/prisma/client/index.js";
import {
  MemoryScopeSchema,
  type MemoryCandidate,
  type MemoryClaim,
  type MemoryRevisionInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { buildMemoryClaimIdentityKey } from "@shepherdjerred/birmel/memory/identity.ts";
import {
  ApplyMemoryCandidatesInputSchema,
  ApplyMemoryCandidatesResultSchema,
  CorrectMemoryClaimInputSchema,
  MemoryClaimHistorySchema,
  type ApplyMemoryCandidatesInput,
  type ApplyMemoryCandidatesResult,
  type MemoryApplicationContext,
  type MemoryCandidateEnvelope,
  type MemoryClaimHistory,
} from "@shepherdjerred/birmel/memory/schemas.ts";
import {
  deserializeDiscordIds,
  normalizeMemoryText,
  serializeDiscordIds,
  serializeEmbedding,
} from "@shepherdjerred/birmel/memory/serialization.ts";
import {
  memoryClaimWithRevisions,
  parseStoredMemoryClaim,
  toMemoryClaim,
  toMemoryClaimHistory,
  type StoredMemoryClaim,
} from "@shepherdjerred/birmel/memory/stored.ts";
import { withMemorySpan } from "@shepherdjerred/birmel/memory/telemetry.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

type RevisionProvenance = {
  authorUserId: string;
  channelId: string;
  extractorModel: string;
};

type ApplyOneRequest = {
  transaction: Prisma.TransactionClient;
  context: MemoryApplicationContext;
  envelope: MemoryCandidateEnvelope;
  provenance: RevisionProvenance;
  correctionClaimId: string | null;
  now: Date;
};

type ApplyOneResult = {
  claimId: string;
  created: boolean;
  supersededCount: number;
  uncertain: boolean;
};

type ApplyTransactionRequest = {
  transaction: Prisma.TransactionClient;
  input: ApplyMemoryCandidatesInput;
  correctionClaimId: string | null;
  now: Date;
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

function intervalsOverlap(
  left: { validFrom: Date | null; validUntil: Date | null },
  right: { validFrom: Date | null; validUntil: Date | null },
): boolean {
  const leftStart = left.validFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
  const leftEnd = left.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightStart = right.validFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightEnd = right.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function hasSameScopeLocation(
  left: StoredMemoryClaim,
  right: StoredMemoryClaim,
): boolean {
  return (
    left.channelId === right.channelId &&
    left.personaId === right.personaId &&
    left.userId === right.userId &&
    arraysEqual(
      deserializeDiscordIds(left.relatedUserIds),
      deserializeDiscordIds(right.relatedUserIds),
    )
  );
}

function hasSameClaimFamily(
  existing: StoredMemoryClaim,
  incoming: StoredMemoryClaim,
): boolean {
  return (
    existing.guildId === incoming.guildId &&
    existing.scope === incoming.scope &&
    hasSameScopeLocation(existing, incoming) &&
    normalizeMemoryText(existing.subject) ===
      normalizeMemoryText(incoming.subject) &&
    normalizeMemoryText(existing.predicate) ===
      normalizeMemoryText(incoming.predicate)
  );
}

function isContradiction(
  existing: StoredMemoryClaim,
  incoming: StoredMemoryClaim,
): boolean {
  return (
    hasSameClaimFamily(existing, incoming) &&
    normalizeMemoryText(existing.value) !==
      normalizeMemoryText(incoming.value) &&
    intervalsOverlap(existing, incoming)
  );
}

async function createRevision(
  transaction: Prisma.TransactionClient,
  input: MemoryRevisionInput,
): Promise<void> {
  await transaction.memoryRevision.create({
    data: {
      claimId: input.claimId,
      action: input.action,
      previousValue: input.previousValue,
      nextValue: input.nextValue,
      sourceDiscordMessageIds: serializeDiscordIds(
        input.sourceDiscordMessageIds,
      ),
      authorUserId: input.authorUserId,
      channelId: input.channelId,
      extractorModel: input.extractorModel,
      confidence: input.confidence,
    },
  });
}

function incomingStoredShape(
  request: ApplyOneRequest,
  identityKey: string,
): StoredMemoryClaim {
  const { candidate, embedding } = request.envelope;
  const scope = request.context;
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
    guildId: scope.guildId,
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

async function findConflicts(
  request: ApplyOneRequest,
  incoming: StoredMemoryClaim,
): Promise<StoredMemoryClaim[]> {
  const rows = await request.transaction.memoryClaim.findMany({
    where: {
      guildId: request.context.guildId,
      scope: request.envelope.candidate.scope,
      status: { in: ["active", "uncertain"] },
      identityKey: { not: incoming.identityKey },
    },
    include: memoryClaimWithRevisions,
  });
  return rows
    .map((row) => parseStoredMemoryClaim(row))
    .filter((row) => isContradiction(row, incoming));
}

function shouldRemainUncertain(
  candidate: MemoryCandidate,
  conflicts: StoredMemoryClaim[],
): boolean {
  return (
    candidate.origin === "inferred" &&
    conflicts.some((conflict) => conflict.origin === "explicit")
  );
}

async function supersedeConflicts(
  request: ApplyOneRequest,
  conflicts: StoredMemoryClaim[],
): Promise<number> {
  for (const conflict of conflicts) {
    await request.transaction.memoryClaim.update({
      where: { id: conflict.id },
      data: { status: "superseded" },
    });
    await createRevision(request.transaction, {
      claimId: conflict.id,
      action:
        request.correctionClaimId === conflict.id ? "correction" : "supersede",
      previousValue: conflict.value,
      nextValue: request.envelope.candidate.value,
      sourceDiscordMessageIds:
        request.envelope.candidate.sourceDiscordMessageIds,
      authorUserId: request.provenance.authorUserId,
      channelId: request.provenance.channelId,
      extractorModel: request.provenance.extractorModel,
      confidence: request.envelope.candidate.confidence,
    });
  }
  return conflicts.length;
}

async function persistIncomingClaim(
  request: ApplyOneRequest,
  incoming: StoredMemoryClaim,
  uncertain: boolean,
): Promise<{
  claimId: string;
  created: boolean;
  previousValue: string | null;
}> {
  const existing = await request.transaction.memoryClaim.findUnique({
    where: { identityKey: incoming.identityKey },
    include: memoryClaimWithRevisions,
  });
  const status = uncertain ? "uncertain" : "active";
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
    return { claimId: created.id, created: true, previousValue: null };
  }

  const storedExisting = parseStoredMemoryClaim(existing);
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
      lastConfirmedAt: request.now,
    },
  });
  return {
    claimId: updated.id,
    created: false,
    previousValue: storedExisting.value,
  };
}

async function applyOne(request: ApplyOneRequest): Promise<ApplyOneResult> {
  const identityKey = buildMemoryClaimIdentityKey({
    context: request.context,
    candidate: request.envelope.candidate,
  });
  const incoming = incomingStoredShape(request, identityKey);
  const conflicts = await findConflicts(request, incoming);
  const uncertain = shouldRemainUncertain(
    request.envelope.candidate,
    conflicts,
  );
  const persisted = await persistIncomingClaim(request, incoming, uncertain);
  const supersededCount = uncertain
    ? 0
    : await supersedeConflicts(request, conflicts);
  const exactCorrection = request.correctionClaimId === persisted.claimId;
  await createRevision(request.transaction, {
    claimId: persisted.claimId,
    action: persisted.created
      ? "create"
      : exactCorrection
        ? "correction"
        : "confirm",
    previousValue: persisted.previousValue,
    nextValue: incoming.value,
    sourceDiscordMessageIds: request.envelope.candidate.sourceDiscordMessageIds,
    authorUserId: request.provenance.authorUserId,
    channelId: request.provenance.channelId,
    extractorModel: request.provenance.extractorModel,
    confidence: request.envelope.candidate.confidence,
  });

  return {
    claimId: persisted.claimId,
    created: persisted.created,
    supersededCount,
    uncertain,
  };
}

async function applyTransaction(
  request: ApplyTransactionRequest,
): Promise<ApplyOneResult[]> {
  const results: ApplyOneResult[] = [];
  for (const envelope of request.input.candidates) {
    results.push(
      await applyOne({
        transaction: request.transaction,
        context: request.input.context,
        envelope,
        provenance: request.input.context,
        correctionClaimId: request.correctionClaimId,
        now: request.now,
      }),
    );
  }
  return results;
}

async function loadAppliedClaims(
  client: PrismaClient,
  results: ApplyOneResult[],
): Promise<MemoryClaim[]> {
  const claims: MemoryClaim[] = [];
  for (const result of results) {
    const row = await client.memoryClaim.findUniqueOrThrow({
      where: { id: result.claimId },
      include: memoryClaimWithRevisions,
    });
    claims.push(toMemoryClaim(row));
  }
  return claims;
}

export async function applyMemoryCandidates(
  client: PrismaClient,
  input: unknown,
): Promise<ApplyMemoryCandidatesResult> {
  const parsed = ApplyMemoryCandidatesInputSchema.parse(input);
  return withMemorySpan("memory.apply", async (span) => {
    const results = await client.$transaction((transaction) =>
      applyTransaction({
        transaction,
        input: parsed,
        correctionClaimId: null,
        now: new Date(),
      }),
    );
    const claims = await loadAppliedClaims(client, results);
    const result = ApplyMemoryCandidatesResultSchema.parse({
      claims,
      createdCount: results.filter((entry) => entry.created).length,
      confirmedCount: results.filter((entry) => !entry.created).length,
      supersededCount: results.reduce(
        (count, entry) => count + entry.supersededCount,
        0,
      ),
      uncertainCount: results.filter((entry) => entry.uncertain).length,
    });
    span.setAttribute(
      "birmel.memory.candidate_count",
      parsed.candidates.length,
    );
    span.setAttribute("birmel.memory.created_count", result.createdCount);
    span.setAttribute("birmel.memory.superseded_count", result.supersededCount);
    loggers.memory.info("memory candidates applied", {
      candidateCount: parsed.candidates.length,
      createdCount: result.createdCount,
      confirmedCount: result.confirmedCount,
      supersededCount: result.supersededCount,
      uncertainCount: result.uncertainCount,
    });
    return result;
  });
}

export async function correctMemoryClaim(
  client: PrismaClient,
  input: unknown,
): Promise<MemoryClaimHistory> {
  const parsed = CorrectMemoryClaimInputSchema.parse(input);
  return withMemorySpan("memory.correct", async () => {
    const result = await client.$transaction(async (transaction) => {
      const existingRow = await transaction.memoryClaim.findUniqueOrThrow({
        where: { id: parsed.claimId },
        include: memoryClaimWithRevisions,
      });
      const existing = parseStoredMemoryClaim(existingRow);
      const relatedUserIds = deserializeDiscordIds(existing.relatedUserIds);
      const sourceContext: MemoryApplicationContext = {
        guildId: existing.guildId,
        channelId: existing.channelId ?? parsed.channelId,
        userId: existing.userId ?? parsed.authorUserId,
        personaId: existing.personaId,
        authorUserId: parsed.authorUserId,
        extractorModel: parsed.extractorModel,
      };
      const candidate: MemoryCandidate = {
        scope: MemoryScopeSchema.parse(existing.scope),
        subject: existing.subject,
        predicate: existing.predicate,
        value: parsed.value,
        confidence: parsed.confidence,
        salience: parsed.salience,
        origin: "explicit",
        validFrom: parsed.validFrom,
        validUntil: parsed.validUntil,
        relatedUserIds,
        sourceDiscordMessageIds: parsed.sourceDiscordMessageIds,
      };
      const applied = await applyOne({
        transaction,
        context: sourceContext,
        envelope: { candidate, embedding: parsed.embedding },
        provenance: parsed,
        correctionClaimId: parsed.claimId,
        now: new Date(),
      });
      return applied.claimId;
    });
    const corrected = await client.memoryClaim.findUniqueOrThrow({
      where: { id: result },
      include: memoryClaimWithRevisions,
    });
    loggers.memory.info("memory claim corrected");
    return MemoryClaimHistorySchema.parse(toMemoryClaimHistory(corrected));
  });
}
