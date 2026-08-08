import {
  MemoryCandidateSchema,
  MemoryClaimSchema,
  MemoryScopeSchema,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  MemoryApplicationContextSchema,
  type MemoryApplicationContext,
} from "@shepherdjerred/birmel/memory/schemas.ts";
import {
  normalizeDiscordIds,
  normalizeMemoryText,
} from "@shepherdjerred/birmel/memory/serialization.ts";
import { z } from "zod";

const MemoryIdentityInputSchema = z.strictObject({
  context: MemoryApplicationContextSchema,
  candidate: MemoryCandidateSchema.strict(),
});

const MemoryIdentityPartsSchema = z.strictObject({
  guildId: z.string(),
  scope: MemoryScopeSchema,
  location: z.array(z.string()),
  subject: z.string(),
  predicate: z.string(),
  value: z.string(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
});

export type ResolvedMemoryScope = {
  channelId: string | null;
  personaId: string | null;
  userId: string | null;
  relatedUserIds: string[];
};

function requirePersona(context: MemoryApplicationContext): string {
  if (context.personaId === null) {
    throw new Error("Persona memory requires a personaId");
  }
  return context.personaId;
}

function requireRelationshipUsers(relatedUserIds: string[]): string[] {
  if (relatedUserIds.length < 2) {
    throw new Error("Relationship memory requires at least two related users");
  }
  return relatedUserIds;
}

export function resolveMemoryScope(input: unknown): ResolvedMemoryScope {
  const { context, candidate } = MemoryIdentityInputSchema.parse(input);
  const relatedUserIds = normalizeDiscordIds(candidate.relatedUserIds);

  switch (candidate.scope) {
    case "guild":
      return { channelId: null, personaId: null, userId: null, relatedUserIds };
    case "channel":
      return {
        channelId: context.channelId,
        personaId: null,
        userId: null,
        relatedUserIds,
      };
    case "persona":
      return {
        channelId: null,
        personaId: requirePersona(context),
        userId: null,
        relatedUserIds,
      };
    case "user":
      return {
        channelId: null,
        personaId: null,
        userId: relatedUserIds[0] ?? context.userId,
        relatedUserIds,
      };
    case "relationship":
      return {
        channelId: null,
        personaId: null,
        userId: null,
        relatedUserIds: requireRelationshipUsers(relatedUserIds),
      };
  }
}

function scopeLocation(
  memoryScope: z.infer<typeof MemoryScopeSchema>,
  scope: ResolvedMemoryScope,
): string[] {
  if (scope.channelId !== null) {
    return ["channel", scope.channelId];
  }
  if (scope.personaId !== null) {
    return ["persona", scope.personaId];
  }
  if (scope.userId !== null) {
    return ["user", scope.userId];
  }
  if (memoryScope === "relationship") {
    return ["relationship", ...scope.relatedUserIds];
  }
  return ["guild"];
}

function hashIdentity(parts: unknown): string {
  const parsed = MemoryIdentityPartsSchema.parse(parts);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify(parsed));
  return hasher.digest("hex");
}

export function buildMemoryClaimFamilyKey(input: unknown): string {
  const { context, candidate } = MemoryIdentityInputSchema.parse(input);
  const scope = resolveMemoryScope({ context, candidate });
  return hashIdentity({
    guildId: context.guildId,
    scope: candidate.scope,
    location: scopeLocation(candidate.scope, scope),
    subject: normalizeMemoryText(candidate.subject),
    predicate: normalizeMemoryText(candidate.predicate),
    value: "",
    validFrom: null,
    validUntil: null,
  });
}

export function buildMemoryClaimFamilyKeyFromClaim(input: unknown): string {
  const claim = MemoryClaimSchema.parse(input);
  const fallbackDiscordId =
    claim.userId ?? claim.relatedUserIds[0] ?? claim.guildId;
  return buildMemoryClaimFamilyKey({
    context: {
      guildId: claim.guildId,
      channelId: claim.channelId ?? claim.guildId,
      userId: fallbackDiscordId,
      personaId: claim.personaId,
      authorUserId: fallbackDiscordId,
      extractorModel: "memory-family-key",
    },
    candidate: {
      scope: claim.scope,
      subject: claim.subject,
      predicate: claim.predicate,
      value: claim.value,
      confidence: claim.confidence,
      salience: claim.salience,
      origin: claim.origin,
      validFrom: claim.validFrom?.toISOString() ?? null,
      validUntil: claim.validUntil?.toISOString() ?? null,
      relatedUserIds: claim.relatedUserIds,
      sourceDiscordMessageIds: claim.sourceDiscordMessageIds,
    },
  });
}

export function buildMemoryClaimIdentityKey(input: unknown): string {
  const { context, candidate } = MemoryIdentityInputSchema.parse(input);
  const scope = resolveMemoryScope({ context, candidate });
  const digest = hashIdentity({
    guildId: context.guildId,
    scope: candidate.scope,
    location: scopeLocation(candidate.scope, scope),
    subject: normalizeMemoryText(candidate.subject),
    predicate: normalizeMemoryText(candidate.predicate),
    value: normalizeMemoryText(candidate.value),
    validFrom: candidate.validFrom,
    validUntil: candidate.validUntil,
  });
  return `memory-claim:v1:${digest}`;
}
