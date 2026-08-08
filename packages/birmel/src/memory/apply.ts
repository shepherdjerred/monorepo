import type { Prisma, PrismaClient } from "#generated/prisma/client/index.js";
import {
  MemoryScopeSchema,
  type MemoryCandidate,
  type MemoryClaim,
  type MemoryRevisionInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { buildMemoryClaimIdentityKey } from "@shepherdjerred/birmel/memory/identity.ts";
import {
  isEnvelopeOlderThanClaim,
  isEnvelopeSameSourceAsClaim,
  prepareMemoryApplications,
  type RevisionProvenance,
} from "@shepherdjerred/birmel/memory/application-order.ts";
import {
  buildIncomingStoredClaim,
  persistIncomingClaim,
} from "@shepherdjerred/birmel/memory/claim-persistence.ts";
import { isMemoryCandidateFenced } from "@shepherdjerred/birmel/memory/extraction-fence.ts";
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

type ApplyOneRequest = {
  transaction: Prisma.TransactionClient;
  context: MemoryApplicationContext;
  envelope: MemoryCandidateEnvelope;
  provenance: RevisionProvenance;
  correctionClaimId: string | null;
  reactivateForgotten: boolean;
  now: Date;
};

type ApplyOneResult = {
  claimId: string | null;
  created: boolean;
  supersededCount: number;
  uncertain: boolean;
  ignored: boolean;
};

type ApplyTransactionRequest = {
  transaction: Prisma.TransactionClient;
  input: ApplyMemoryCandidatesInput;
  correctionClaimId: string | null;
  now: Date;
};

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

function isOlderThanClaim(
  request: ApplyOneRequest,
  claim: StoredMemoryClaim,
): boolean {
  return isEnvelopeOlderThanClaim(request.envelope, claim);
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

async function applyOne(request: ApplyOneRequest): Promise<ApplyOneResult> {
  if (
    await isMemoryCandidateFenced({
      transaction: request.transaction,
      context: request.context,
      envelope: request.envelope,
      reactivateForgotten: request.reactivateForgotten,
    })
  ) {
    return {
      claimId: null,
      created: false,
      supersededCount: 0,
      uncertain: false,
      ignored: true,
    };
  }
  const identityKey = buildMemoryClaimIdentityKey({
    context: request.context,
    candidate: request.envelope.candidate,
  });
  const incoming = buildIncomingStoredClaim(request, identityKey);
  const conflicts = await findConflicts(request, incoming);
  const precedenceRequiresUncertainty = shouldRemainUncertain(
    request.envelope.candidate,
    conflicts,
  );
  const chronologyConflicts =
    request.envelope.candidate.origin === "explicit"
      ? conflicts.filter((conflict) => conflict.origin === "explicit")
      : conflicts;
  const samePrioritySameSource = conflicts.some(
    (conflict) =>
      conflict.origin === request.envelope.candidate.origin &&
      isEnvelopeSameSourceAsClaim(request.envelope, conflict),
  );
  const obsolete =
    !precedenceRequiresUncertainty &&
    chronologyConflicts.some((conflict) => isOlderThanClaim(request, conflict));
  const uncertain =
    !obsolete && (precedenceRequiresUncertainty || samePrioritySameSource);
  const status = obsolete ? "superseded" : uncertain ? "uncertain" : "active";
  const persisted = await persistIncomingClaim(request, incoming, status);
  if (persisted.ignored) {
    return {
      claimId: persisted.claimId,
      created: false,
      supersededCount: 0,
      uncertain: false,
      ignored: true,
    };
  }
  const supersededCount =
    uncertain || obsolete ? 0 : await supersedeConflicts(request, conflicts);
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
    ignored: false,
  };
}

async function applyTransaction(
  request: ApplyTransactionRequest,
): Promise<ApplyOneResult[]> {
  const results: ApplyOneResult[] = [];
  for (const application of prepareMemoryApplications(request.input)) {
    results.push(
      await applyOne({
        transaction: request.transaction,
        context: application.context,
        envelope: application.envelope,
        provenance: application.provenance,
        correctionClaimId: request.correctionClaimId,
        reactivateForgotten: request.input.reactivateForgotten,
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
    if (result.claimId === null || result.ignored) {
      continue;
    }
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
      confirmedCount: results.filter(
        (entry) => !entry.created && !entry.ignored,
      ).length,
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
        envelope: {
          candidate,
          embedding: parsed.embedding,
          provenance: {
            authorUserId: parsed.authorUserId,
            channelId: parsed.channelId,
            sourceOrder: parsed.sourceOrder,
          },
        },
        provenance: parsed,
        correctionClaimId: parsed.claimId,
        reactivateForgotten: true,
        now: new Date(),
      });
      if (applied.claimId === null) {
        throw new Error("Explicit correction was unexpectedly fenced");
      }
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
