import { z } from "zod";

/**
 * The plugin↔brain v1 contract. Schemas are strict: unknown keys fail loudly
 * so a plugin/brain version skew surfaces as a 400, never a silent misread.
 * Shapes mirror the plugin's `agent.app` records field for field.
 */

const IsoDateTime = z.iso.datetime();

const ChatLineSchema = z.strictObject({
  text: z.string().min(1).max(2000),
  at: IsoDateTime,
});

export const ClassifyRequestSchema = z.strictObject({
  player: z.strictObject({
    id: z.uuid(),
    name: z.string().min(1).max(16),
  }),
  /** The suspicious line and its context, newest first. */
  lines: z.array(ChatLineSchema).min(1).max(8),
});

export type ClassifyRequest = z.infer<typeof ClassifyRequestSchema>;

/**
 * The offenses the brain may name. `other` is deliberately absent: it is the
 * plugin's bookkeeping offense and is never enforceable.
 */
export const OffenseSchema = z.enum([
  "spam",
  "advertising",
  "slur",
  "toxicity",
  "grief",
  "theft",
  "cheat",
  "harassment",
]);

/**
 * What the model produces for classify. The service adds `model` and
 * `costMicros`; the model never reports its own identity or cost.
 */
export const ClassifyVerdictSchema = z.strictObject({
  /** What it is, or null when clean. */
  offense: OffenseSchema.nullable(),
  confidence: z.number().min(0).max(1),
  label: z.string().min(1).max(200),
  reasoning: z.string().min(1).max(2000),
});

export type ClassifyVerdict = z.infer<typeof ClassifyVerdictSchema>;

export const ClassifyResponseSchema = ClassifyVerdictSchema.extend({
  model: z.string().min(1).max(200),
  costMicros: z.number().int().nonnegative(),
});

export type ClassifyResponse = z.infer<typeof ClassifyResponseSchema>;

const LocationSchema = z.strictObject({
  world: z.string().min(1).max(64),
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});

const TriageSnapshotSchema = z.strictObject({
  priorityId: z.string().min(1).max(32),
  duplicateIds: z.array(z.number().int().nonnegative()).max(20),
  evidence: z.string().min(1).max(2000),
  draftReply: z.string().min(1).max(2000),
  at: IsoDateTime,
});

const TicketSchema = z.strictObject({
  id: z.number().int().positive(),
  reporter: z.uuid(),
  categoryId: z.string().min(1).max(32),
  statusId: z.string().min(1).max(32),
  priorityId: z.string().min(1).max(32),
  summary: z.string().min(1).max(2000),
  location: LocationSchema.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  claimer: z.uuid().nullable(),
  triage: TriageSnapshotSchema.nullable(),
});

const CommentSchema = z.strictObject({
  id: z.number().int().positive(),
  author: z.uuid(),
  staffOnly: z.boolean(),
  body: z.string().min(1).max(2000),
  at: IsoDateTime,
});

const ModLogRecordSchema = z.strictObject({
  actionId: z.string().min(1).max(32),
  actorName: z.string().min(1).max(32),
  reason: z.string().min(1).max(500),
  at: IsoDateTime,
  expiresAt: IsoDateTime.nullable(),
});

export const TriageRequestSchema = z.strictObject({
  ticket: TicketSchema,
  comments: z.array(CommentSchema).max(50),
  reporterHistory: z.array(ModLogRecordSchema).max(20),
  reporterBanned: z.boolean(),
  reporterRecentChat: z.array(ChatLineSchema).max(20),
});

export type TriageRequest = z.infer<typeof TriageRequestSchema>;

/**
 * What the model produces for triage. The service adds `model` and
 * `costMicros`; the model never reports its own identity or cost.
 */
export const TriageDraftSchema = z.strictObject({
  priorityId: z.enum(["low", "normal", "urgent"]),
  confidence: z.number().min(0).max(1),
  duplicates: z.array(z.number().int().nonnegative()).max(10),
  evidence: z.string().min(1).max(2000),
  draftReply: z.string().min(1).max(2000),
  resolve: z.boolean(),
  resolutionNote: z.string().max(2000),
});

export type TriageDraft = z.infer<typeof TriageDraftSchema>;

export const TriageResponseSchema = TriageDraftSchema.extend({
  model: z.string().min(1).max(200),
  costMicros: z.number().int().nonnegative(),
});

export type TriageResponse = z.infer<typeof TriageResponseSchema>;
