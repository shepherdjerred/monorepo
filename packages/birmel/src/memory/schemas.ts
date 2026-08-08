import {
  DiscordIdSchema,
  MemoryCandidateSchema,
  MemoryClaimSchema,
  MemoryRevisionActionSchema,
  MemoryScopeSchema,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { z } from "zod";

export const MemoryEmbeddingSchema = z.array(z.number()).min(1).max(4096);

export const StrictMemoryCandidateSchema = MemoryCandidateSchema.strict();

export const MemoryApplicationContextSchema = z.strictObject({
  guildId: DiscordIdSchema,
  channelId: DiscordIdSchema,
  userId: DiscordIdSchema,
  personaId: z.string().min(1).max(200).nullable().default(null),
  authorUserId: DiscordIdSchema,
  extractorModel: z.string().min(1).max(200),
});
export type MemoryApplicationContext = z.infer<
  typeof MemoryApplicationContextSchema
>;

export const MemoryCandidateEnvelopeSchema = z.strictObject({
  candidate: StrictMemoryCandidateSchema,
  embedding: MemoryEmbeddingSchema.nullable().default(null),
});
export type MemoryCandidateEnvelope = z.infer<
  typeof MemoryCandidateEnvelopeSchema
>;

export const ApplyMemoryCandidatesInputSchema = z.strictObject({
  context: MemoryApplicationContextSchema,
  candidates: z.array(MemoryCandidateEnvelopeSchema).min(1).max(50),
});
export type ApplyMemoryCandidatesInput = z.infer<
  typeof ApplyMemoryCandidatesInputSchema
>;

export const ApplyMemoryCandidatesResultSchema = z.strictObject({
  claims: z.array(MemoryClaimSchema),
  createdCount: z.number().int().nonnegative(),
  confirmedCount: z.number().int().nonnegative(),
  supersededCount: z.number().int().nonnegative(),
  uncertainCount: z.number().int().nonnegative(),
});
export type ApplyMemoryCandidatesResult = z.infer<
  typeof ApplyMemoryCandidatesResultSchema
>;

export const MemoryRetrievalInputSchema = z.strictObject({
  guildId: DiscordIdSchema,
  channelId: DiscordIdSchema.nullable().default(null),
  personaId: z.string().min(1).max(200).nullable().default(null),
  userIds: z.array(DiscordIdSchema).max(50).default([]),
  relationshipUserIds: z.array(DiscordIdSchema).max(50).default([]),
  query: z.string().max(8000).default(""),
  queryEmbedding: MemoryEmbeddingSchema.nullable().default(null),
  at: z.date().default(() => new Date()),
  limit: z.number().int().min(1).max(12).default(12),
});
export type MemoryRetrievalInput = z.infer<typeof MemoryRetrievalInputSchema>;

export const RetrievedMemoryClaimSchema = z.strictObject({
  claim: MemoryClaimSchema,
  score: z.number(),
  mandatory: z.boolean(),
  uncertain: z.boolean(),
  conflictingClaimIds: z.array(z.uuid()),
});
export type RetrievedMemoryClaim = z.infer<typeof RetrievedMemoryClaimSchema>;

export const MemoryRetrievalResultSchema = z.strictObject({
  claims: z.array(RetrievedMemoryClaimSchema).max(12),
  consideredCount: z.number().int().nonnegative(),
});
export type MemoryRetrievalResult = z.infer<typeof MemoryRetrievalResultSchema>;

export const RememberMemoryInputSchema = z.strictObject({
  context: MemoryApplicationContextSchema,
  candidate: StrictMemoryCandidateSchema.extend({
    origin: z.literal("explicit"),
  }),
  embedding: MemoryEmbeddingSchema.nullable().default(null),
});
export type RememberMemoryInput = z.infer<typeof RememberMemoryInputSchema>;

export const MemoryClaimReferenceSchema = z.strictObject({
  claimId: z.uuid(),
});

export const MemoryRevisionSchema = z.strictObject({
  id: z.uuid(),
  claimId: z.uuid(),
  action: MemoryRevisionActionSchema,
  previousValue: z.string().nullable(),
  nextValue: z.string().nullable(),
  sourceDiscordMessageIds: z.array(DiscordIdSchema).min(1),
  authorUserId: DiscordIdSchema,
  channelId: DiscordIdSchema,
  extractorModel: z.string().min(1),
  confidence: z.number().min(0).max(1),
  createdAt: z.date(),
});
export type MemoryRevision = z.infer<typeof MemoryRevisionSchema>;

export const MemoryClaimHistorySchema = z.strictObject({
  claim: MemoryClaimSchema,
  revisions: z.array(MemoryRevisionSchema),
});
export type MemoryClaimHistory = z.infer<typeof MemoryClaimHistorySchema>;

export const CorrectMemoryClaimInputSchema = z.strictObject({
  claimId: z.uuid(),
  value: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
  validFrom: z.iso.datetime().nullable().default(null),
  validUntil: z.iso.datetime().nullable().default(null),
  sourceDiscordMessageIds: z.array(DiscordIdSchema).min(1),
  authorUserId: DiscordIdSchema,
  channelId: DiscordIdSchema,
  extractorModel: z.string().min(1).max(200),
  embedding: MemoryEmbeddingSchema.nullable().default(null),
});
export type CorrectMemoryClaimInput = z.infer<
  typeof CorrectMemoryClaimInputSchema
>;

export const ForgetMemoryClaimInputSchema = z.strictObject({
  claimId: z.uuid(),
  sourceDiscordMessageIds: z.array(DiscordIdSchema).min(1),
  authorUserId: DiscordIdSchema,
  channelId: DiscordIdSchema,
  extractorModel: z.string().min(1).max(200),
});
export type ForgetMemoryClaimInput = z.infer<
  typeof ForgetMemoryClaimInputSchema
>;

export const PrivacyEraseMemoryClaimInputSchema = MemoryClaimReferenceSchema;

export const MemoryScopeSelectionSchema = z.strictObject({
  guildId: DiscordIdSchema,
  scope: MemoryScopeSchema.optional(),
  channelId: DiscordIdSchema.optional(),
  personaId: z.string().min(1).max(200).optional(),
  userId: DiscordIdSchema.optional(),
  statuses: z
    .array(z.enum(["active", "uncertain", "superseded", "forgotten"]))
    .min(1)
    .default(["active", "uncertain"]),
});
export type MemoryScopeSelection = z.infer<typeof MemoryScopeSelectionSchema>;

export const ForgetMemoryClaimResultSchema = z.strictObject({
  claim: MemoryClaimSchema,
  alreadyForgotten: z.boolean(),
});
export type ForgetMemoryClaimResult = z.infer<
  typeof ForgetMemoryClaimResultSchema
>;

export const PrivacyEraseMemoryClaimResultSchema = z.strictObject({
  erasedClaimId: z.uuid(),
  erasedRevisionCount: z.number().int().nonnegative(),
});
export type PrivacyEraseMemoryClaimResult = z.infer<
  typeof PrivacyEraseMemoryClaimResultSchema
>;
