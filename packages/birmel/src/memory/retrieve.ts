import type { PrismaClient } from "#generated/prisma/client/index.js";
import { MemoryScopeSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  MemoryRetrievalInputSchema,
  MemoryRetrievalResultSchema,
  RetrievedMemoryClaimSchema,
  type MemoryRetrievalInput,
  type MemoryRetrievalResult,
  type RetrievedMemoryClaim,
} from "@shepherdjerred/birmel/memory/schemas.ts";
import {
  deserializeDiscordIds,
  deserializeEmbedding,
  normalizeDiscordIds,
  normalizeMemoryText,
} from "@shepherdjerred/birmel/memory/serialization.ts";
import {
  memoryClaimWithRevisions,
  parseStoredMemoryClaim,
  toMemoryClaim,
  type StoredMemoryClaim,
} from "@shepherdjerred/birmel/memory/stored.ts";
import { withMemorySpan } from "@shepherdjerred/birmel/memory/telemetry.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

type ScoredStoredClaim = {
  stored: StoredMemoryClaim;
  retrieved: RetrievedMemoryClaim;
};

const SCOPE_SCORES = {
  guild: 0.65,
  channel: 0.85,
  persona: 0.8,
  user: 0.9,
  relationship: 1,
} as const;

function isTemporallyApplicable(claim: StoredMemoryClaim, at: Date): boolean {
  const timestamp = at.getTime();
  const startsBefore =
    claim.validFrom === null || claim.validFrom.getTime() <= timestamp;
  const endsAfter =
    claim.validUntil === null || claim.validUntil.getTime() >= timestamp;
  return startsBefore && endsAfter;
}

function isRelationshipApplicable(
  claim: StoredMemoryClaim,
  input: MemoryRetrievalInput,
): boolean {
  const claimUsers = deserializeDiscordIds(claim.relatedUserIds);
  const requestedUsers = new Set(
    normalizeDiscordIds(input.relationshipUserIds),
  );
  return (
    claimUsers.length >= 2 &&
    claimUsers.every((userId) => requestedUsers.has(userId))
  );
}

function isScopeApplicable(
  claim: StoredMemoryClaim,
  input: MemoryRetrievalInput,
): boolean {
  const scope = MemoryScopeSchema.parse(claim.scope);
  switch (scope) {
    case "guild":
      return true;
    case "channel":
      return input.channelId !== null && claim.channelId === input.channelId;
    case "persona":
      return input.personaId !== null && claim.personaId === input.personaId;
    case "user":
      return claim.userId !== null && input.userIds.includes(claim.userId);
    case "relationship":
      return isRelationshipApplicable(claim, input);
  }
}

function tokenize(value: string): Set<string> {
  const tokens = normalizeMemoryText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
  return new Set(tokens);
}

function lexicalSimilarity(query: string, claim: StoredMemoryClaim): number {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) {
    return 0;
  }
  const claimTokens = tokenize(
    `${claim.subject} ${claim.predicate} ${claim.value}`,
  );
  const intersection = [...queryTokens].filter((token) =>
    claimTokens.has(token),
  ).length;
  const union = new Set([...queryTokens, ...claimTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function semanticSimilarity(
  queryEmbedding: number[] | null,
  claimEmbedding: number[] | null,
): number {
  if (queryEmbedding === null || claimEmbedding === null) {
    return 0;
  }
  if (claimEmbedding.length !== queryEmbedding.length) {
    throw new Error("Memory embedding dimensions do not match the query");
  }
  let dotProduct = 0;
  let queryMagnitude = 0;
  let claimMagnitude = 0;
  for (const [index, queryComponent] of queryEmbedding.entries()) {
    const claimComponent = claimEmbedding[index];
    if (claimComponent === undefined) {
      throw new Error("Embedding dimensions changed during scoring");
    }
    dotProduct += queryComponent * claimComponent;
    queryMagnitude += queryComponent * queryComponent;
    claimMagnitude += claimComponent * claimComponent;
  }
  if (queryMagnitude === 0 || claimMagnitude === 0) {
    return 0;
  }
  const cosine = dotProduct / Math.sqrt(queryMagnitude * claimMagnitude);
  return (Math.max(-1, Math.min(1, cosine)) + 1) / 2;
}

function recencyScore(claim: StoredMemoryClaim, at: Date): number {
  const ageMilliseconds = Math.max(
    0,
    at.getTime() - claim.lastConfirmedAt.getTime(),
  );
  const ageDays = ageMilliseconds / (24 * 60 * 60 * 1000);
  return 1 / (1 + ageDays / 30);
}

function isRuleOrExplicitPreference(claim: StoredMemoryClaim): boolean {
  if (claim.status !== "active") {
    return false;
  }
  const predicate = normalizeMemoryText(claim.predicate);
  const rule = ["rule", "instruction", "constraint", "policy"].some((keyword) =>
    predicate.includes(keyword),
  );
  const explicitPreference =
    claim.origin === "explicit" &&
    ["prefer", "preference", "likes", "dislikes"].some((keyword) =>
      predicate.includes(keyword),
    );
  return rule || explicitPreference;
}

function familyKey(claim: StoredMemoryClaim): string {
  return JSON.stringify({
    guildId: claim.guildId,
    scope: claim.scope,
    channelId: claim.channelId,
    personaId: claim.personaId,
    userId: claim.userId,
    relatedUserIds: deserializeDiscordIds(claim.relatedUserIds),
    subject: normalizeMemoryText(claim.subject),
    predicate: normalizeMemoryText(claim.predicate),
  });
}

function conflictingClaims(
  claim: StoredMemoryClaim,
  applicable: StoredMemoryClaim[],
): StoredMemoryClaim[] {
  const key = familyKey(claim);
  return applicable.filter(
    (candidate) =>
      candidate.id !== claim.id &&
      familyKey(candidate) === key &&
      normalizeMemoryText(candidate.value) !== normalizeMemoryText(claim.value),
  );
}

function calculateScore(
  claim: StoredMemoryClaim,
  input: MemoryRetrievalInput,
): number {
  const scope = MemoryScopeSchema.parse(claim.scope);
  const lexical = lexicalSimilarity(input.query, claim);
  const semantic = semanticSimilarity(
    input.queryEmbedding,
    deserializeEmbedding(claim.embedding),
  );
  const recency = recencyScore(claim, input.at);
  const uncertainPenalty = claim.status === "uncertain" ? 0.85 : 1;
  return (
    (SCOPE_SCORES[scope] * 0.2 +
      lexical * 0.25 +
      semantic * 0.15 +
      claim.confidence * 0.15 +
      claim.salience * 0.15 +
      recency * 0.1) *
    uncertainPenalty
  );
}

function scoreClaim(
  claim: StoredMemoryClaim,
  applicable: StoredMemoryClaim[],
  input: MemoryRetrievalInput,
): ScoredStoredClaim {
  const conflicts = conflictingClaims(claim, applicable);
  return {
    stored: claim,
    retrieved: RetrievedMemoryClaimSchema.parse({
      claim: toMemoryClaim(claim),
      score: calculateScore(claim, input),
      mandatory: isRuleOrExplicitPreference(claim),
      uncertain: claim.status === "uncertain" || conflicts.length > 0,
      conflictingClaimIds: conflicts
        .map((conflict) => conflict.id)
        .sort((left, right) => left.localeCompare(right)),
    }),
  };
}

function compareScoredClaims(
  left: ScoredStoredClaim,
  right: ScoredStoredClaim,
): number {
  if (left.retrieved.mandatory !== right.retrieved.mandatory) {
    return left.retrieved.mandatory ? -1 : 1;
  }
  if (left.retrieved.score !== right.retrieved.score) {
    return right.retrieved.score - left.retrieved.score;
  }
  const recency =
    right.stored.lastConfirmedAt.getTime() -
    left.stored.lastConfirmedAt.getTime();
  return recency === 0
    ? left.stored.id.localeCompare(right.stored.id)
    : recency;
}

export async function retrieveMemoryClaims(
  client: PrismaClient,
  input: unknown,
): Promise<MemoryRetrievalResult> {
  const parsed = MemoryRetrievalInputSchema.parse(input);
  return withMemorySpan("memory.retrieve", async (span) => {
    const rows = await client.memoryClaim.findMany({
      where: {
        guildId: parsed.guildId,
        status: { in: ["active", "uncertain"] },
      },
      include: memoryClaimWithRevisions,
    });
    const stored = rows.map((row) => parseStoredMemoryClaim(row));
    const applicable = stored.filter(
      (claim) =>
        isScopeApplicable(claim, parsed) &&
        isTemporallyApplicable(claim, parsed.at),
    );
    const claims = applicable
      .map((claim) => scoreClaim(claim, applicable, parsed))
      .sort(compareScoredClaims)
      .slice(0, parsed.limit)
      .map((entry) => entry.retrieved);
    const result = MemoryRetrievalResultSchema.parse({
      claims,
      consideredCount: applicable.length,
    });
    span.setAttribute("birmel.memory.considered_count", applicable.length);
    span.setAttribute("birmel.memory.selected_count", result.claims.length);
    span.setAttribute(
      "birmel.memory.semantic_query",
      parsed.queryEmbedding !== null,
    );
    loggers.memory.info("memory claims retrieved", {
      consideredCount: applicable.length,
      selectedCount: result.claims.length,
      semanticQuery: parsed.queryEmbedding !== null,
    });
    return result;
  });
}
