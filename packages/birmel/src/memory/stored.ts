import {
  MemoryClaimSchema,
  MemoryClaimStatusSchema,
  MemoryOriginSchema,
  MemoryRevisionActionSchema,
  MemoryScopeSchema,
  type MemoryClaim,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  MemoryClaimHistorySchema,
  MemoryRevisionSchema,
  type MemoryClaimHistory,
  type MemoryRevision,
} from "@shepherdjerred/birmel/memory/schemas.ts";
import {
  deserializeDiscordIds,
  deserializeEmbedding,
} from "@shepherdjerred/birmel/memory/serialization.ts";
import { z } from "zod";

export const memoryClaimWithRevisions = {
  revisions: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  },
};

const StoredMemoryRevisionSchema = z.strictObject({
  id: z.uuid(),
  claimId: z.uuid(),
  action: z.string(),
  previousValue: z.string().nullable(),
  nextValue: z.string().nullable(),
  sourceDiscordMessageIds: z.string(),
  authorUserId: z.string(),
  channelId: z.string(),
  extractorModel: z.string(),
  confidence: z.number(),
  createdAt: z.date(),
});

export const StoredMemoryClaimSchema = z.strictObject({
  id: z.uuid(),
  identityKey: z.string().min(1),
  guildId: z.string(),
  scope: z.string(),
  subject: z.string(),
  predicate: z.string(),
  value: z.string(),
  confidence: z.number(),
  salience: z.number(),
  origin: z.string(),
  validFrom: z.date().nullable(),
  validUntil: z.date().nullable(),
  status: z.string(),
  channelId: z.string().nullable(),
  personaId: z.string().nullable(),
  userId: z.string().nullable(),
  relatedUserIds: z.string(),
  embedding: z.string().nullable(),
  lastConfirmedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
  revisions: z.array(StoredMemoryRevisionSchema),
});
export type StoredMemoryClaim = z.infer<typeof StoredMemoryClaimSchema>;

export function parseStoredMemoryClaim(input: unknown): StoredMemoryClaim {
  return StoredMemoryClaimSchema.parse(input);
}

export function toMemoryRevision(input: unknown): MemoryRevision {
  const revision = StoredMemoryRevisionSchema.parse(input);
  return MemoryRevisionSchema.parse({
    ...revision,
    action: MemoryRevisionActionSchema.parse(revision.action),
    sourceDiscordMessageIds: deserializeDiscordIds(
      revision.sourceDiscordMessageIds,
    ),
  });
}

function collectSourceDiscordMessageIds(
  revisions: StoredMemoryClaim["revisions"],
): string[] {
  const sourceIds = revisions.flatMap((revision) =>
    deserializeDiscordIds(revision.sourceDiscordMessageIds),
  );
  return [...new Set(sourceIds)].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function toMemoryClaim(input: unknown): MemoryClaim {
  const claim = StoredMemoryClaimSchema.parse(input);
  return MemoryClaimSchema.parse({
    id: claim.id,
    identityKey: claim.identityKey,
    guildId: claim.guildId,
    scope: MemoryScopeSchema.parse(claim.scope),
    subject: claim.subject,
    predicate: claim.predicate,
    value: claim.value,
    confidence: claim.confidence,
    salience: claim.salience,
    origin: MemoryOriginSchema.parse(claim.origin),
    validFrom: claim.validFrom,
    validUntil: claim.validUntil,
    status: MemoryClaimStatusSchema.parse(claim.status),
    channelId: claim.channelId,
    personaId: claim.personaId,
    userId: claim.userId,
    relatedUserIds: deserializeDiscordIds(claim.relatedUserIds),
    sourceDiscordMessageIds: collectSourceDiscordMessageIds(claim.revisions),
    embedding: deserializeEmbedding(claim.embedding),
    confirmedAt: claim.lastConfirmedAt,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  });
}

export function toMemoryClaimHistory(input: unknown): MemoryClaimHistory {
  const stored = StoredMemoryClaimSchema.parse(input);
  return MemoryClaimHistorySchema.parse({
    claim: toMemoryClaim(stored),
    revisions: stored.revisions.map((revision) => toMemoryRevision(revision)),
  });
}
