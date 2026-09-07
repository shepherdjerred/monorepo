import { z } from "zod";

export const CONTEXT_BUDGETS = {
  coreInstructions: 12_000,
  persona: 8000,
  loreAndMemory: 8000,
  transcript: 20_000,
  sessionSummary: 8000,
  total: 48_000,
  transcriptFetchLimit: 50,
  maximumClaims: 12,
} as const;

export const DiscordIdSchema = z.string().regex(/^\d+$/);

export const TriggerKindSchema = z.enum([
  "mention",
  "wake-word",
  "learned-alias",
  "reply",
  "engaged-follow-up",
  "session-thread",
  "job",
]);
export type TriggerKind = z.infer<typeof TriggerKindSchema>;

export const TurnAttachmentSchema = z.object({
  id: z.string().min(1),
  url: z.url(),
  contentType: z.string().nullable(),
  name: z.string().nullable(),
});

export const ReferenceResolutionErrorSchema = z.object({
  referencedMessageId: DiscordIdSchema,
  error: z.string().min(1),
});
export type ReferenceResolutionError = z.infer<
  typeof ReferenceResolutionErrorSchema
>;

export const TurnInputSchema = z.object({
  discordMessageId: DiscordIdSchema,
  guildId: DiscordIdSchema,
  channelId: DiscordIdSchema,
  threadId: DiscordIdSchema.optional(),
  userId: DiscordIdSchema,
  username: z.string().min(1),
  content: z.string(),
  attachments: z.array(TurnAttachmentSchema).default([]),
  referenceResolutionError: ReferenceResolutionErrorSchema.optional(),
  triggerKind: TriggerKindSchema,
  receivedAt: z.date(),
});
export type TurnInput = z.infer<typeof TurnInputSchema>;

export const ContextSourceKindSchema = z.enum([
  "system-policy",
  "persona",
  "memory",
  "lore",
  "session-summary",
  "session-event",
  "transcript",
  "current-message",
]);
export type ContextSourceKind = z.infer<typeof ContextSourceKindSchema>;

export const ContextSourceSchema = z.object({
  id: z.string().min(1),
  kind: ContextSourceKindSchema,
  content: z.string(),
  characterCount: z.number().int().nonnegative(),
  rank: z.number().default(0),
  discordMessageId: DiscordIdSchema.optional(),
  memoryClaimId: z.string().optional(),
});
export type ContextSource = z.infer<typeof ContextSourceSchema>;

export const ContextSizesSchema = z.object({
  coreInstructions: z
    .number()
    .int()
    .nonnegative()
    .max(CONTEXT_BUDGETS.coreInstructions),
  persona: z.number().int().nonnegative().max(CONTEXT_BUDGETS.persona),
  loreAndMemory: z
    .number()
    .int()
    .nonnegative()
    .max(CONTEXT_BUDGETS.loreAndMemory),
  transcript: z.number().int().nonnegative().max(CONTEXT_BUDGETS.transcript),
  total: z.number().int().nonnegative().max(CONTEXT_BUDGETS.total),
});

export const ContextBundleSchema = z.object({
  version: z.literal(1),
  sources: z.array(ContextSourceSchema),
  assembled: z.string().max(CONTEXT_BUDGETS.total),
  sizes: ContextSizesSchema,
  selectedMemoryClaimIds: z
    .array(z.string())
    .max(CONTEXT_BUDGETS.maximumClaims),
  transcriptFetchFailed: z.boolean(),
});
export type ContextBundle = z.infer<typeof ContextBundleSchema>;

/**
 * What a turn turned out to be, reported by the agent on the way out.
 *
 * This used to be chosen up front by a cheap classifier before any tool could
 * run, which meant the least-informed participant in the system committed the
 * turn to one tool and one tool set. It is an outcome now: you only know
 * whether a request was supported after you have looked.
 */
export const TurnDispositionSchema = z.enum([
  "conversation",
  "supported",
  "unsupported",
]);
export type TurnDisposition = z.infer<typeof TurnDispositionSchema>;

/**
 * The agent's structured final answer.
 *
 * `reliedOnToolCallIds` is the anti-hallucination gate. Every id must match a
 * tool call that actually succeeded this turn, checked in
 * `requireGroundedAnswer`. It replaces the old "the pre-named primary tool must
 * succeed" rule and is strictly stronger: it verifies everything the reply
 * leans on, rather than one tool named before anyone looked.
 */
export const TurnAnswerSchema = z.strictObject({
  answer: z.string().min(1),
  disposition: TurnDispositionSchema,
  reliedOnToolCallIds: z.array(z.string().min(1).max(200)).max(64),
});
export type TurnAnswer = z.infer<typeof TurnAnswerSchema>;

export const ToolRiskClassSchema = z.enum([
  "read",
  "write",
  "destructive",
  "code-execution",
]);
export type ToolRiskClass = z.infer<typeof ToolRiskClassSchema>;

export const RequiredRequestContextSchema = z.enum([
  "guildId",
  "channelId",
  "userId",
  "sourceMessageId",
]);

export const BirmelToolMetadataSchema = z.object({
  id: z.string().min(1),
  riskClass: ToolRiskClassSchema,
  timeoutMs: z.number().int().positive(),
  requiredRequestContext: z.array(RequiredRequestContextSchema),
  /**
   * Action values that are inherently non-mutating on a composite tool whose
   * overall riskClass is above "read". Only needed for a tool that mixes
   * read and write operations under one id (e.g. manage-role's "list"/"get"
   * alongside "create"/"delete") - a tool with a uniform riskClass needs no
   * override here.
   */
  readActions: z.array(z.string().min(1).max(64)).optional(),
});
export type BirmelToolMetadata = z.infer<typeof BirmelToolMetadataSchema>;

export const MemoryScopeSchema = z.enum([
  "guild",
  "channel",
  "persona",
  "user",
  "relationship",
]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryOriginSchema = z.enum(["explicit", "inferred"]);
export type MemoryOrigin = z.infer<typeof MemoryOriginSchema>;

export const MemoryClaimStatusSchema = z.enum([
  "active",
  "uncertain",
  "superseded",
  "forgotten",
]);
export type MemoryClaimStatus = z.infer<typeof MemoryClaimStatusSchema>;

export const MemoryCandidateSchema = z.object({
  scope: MemoryScopeSchema,
  subject: z.string().min(1).max(500),
  predicate: z.string().min(1).max(200),
  value: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
  origin: MemoryOriginSchema,
  validFrom: z.iso.datetime().nullable(),
  validUntil: z.iso.datetime().nullable(),
  relatedUserIds: z.array(DiscordIdSchema),
  sourceDiscordMessageIds: z.array(DiscordIdSchema).min(1),
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

export const MemoryClaimSchema = MemoryCandidateSchema.extend({
  id: z.uuid(),
  guildId: DiscordIdSchema,
  channelId: DiscordIdSchema.nullable(),
  personaId: z.string().nullable(),
  userId: DiscordIdSchema.nullable(),
  identityKey: z.string().min(1),
  status: MemoryClaimStatusSchema,
  embedding: z.array(z.number()).nullable(),
  validFrom: z.date().nullable(),
  validUntil: z.date().nullable(),
  confirmedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MemoryClaim = z.infer<typeof MemoryClaimSchema>;

export const MemoryRevisionActionSchema = z.enum([
  "create",
  "confirm",
  "supersede",
  "forget",
  "correction",
]);

export const MemoryRevisionInputSchema = z.object({
  claimId: z.uuid(),
  action: MemoryRevisionActionSchema,
  previousValue: z.string().nullable(),
  nextValue: z.string().nullable(),
  sourceDiscordMessageIds: z.array(DiscordIdSchema).min(1),
  authorUserId: DiscordIdSchema,
  channelId: DiscordIdSchema,
  extractorModel: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type MemoryRevisionInput = z.infer<typeof MemoryRevisionInputSchema>;

export const TaskPacketSchema = z.object({
  request: z.string(),
  guildId: DiscordIdSchema,
  channelId: DiscordIdSchema,
  threadId: DiscordIdSchema.optional(),
  userId: DiscordIdSchema,
  username: z.string().min(1),
  personaId: z.string().min(1),
  persona: z.string().max(CONTEXT_BUDGETS.persona),
  context: z.string().max(CONTEXT_BUDGETS.total),
  attachments: z.array(TurnAttachmentSchema).default([]),
  referenceResolutionError: ReferenceResolutionErrorSchema.optional(),
});
export type TaskPacket = z.infer<typeof TaskPacketSchema>;
