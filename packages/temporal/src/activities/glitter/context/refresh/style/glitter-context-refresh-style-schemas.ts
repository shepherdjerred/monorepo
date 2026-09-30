import { z } from "zod/v4";
import { SituationalExamplesSchema } from "@shepherdjerred/glitter-context/schema";

export const StyleArrayFieldSchema = z.enum([
  "voice",
  "style_markers",
  "topics",
  "relationships",
  "behaviors",
  "personality",
  "humor_or_tone",
  "likes_dislikes",
  "other_games",
  "how_to_mimic",
  "concerns",
]);
export type StyleArrayField = z.infer<typeof StyleArrayFieldSchema>;

export const STYLE_ARRAY_FIELDS = StyleArrayFieldSchema.options;

const EvidenceMessageIdSchema = z.string().regex(/^\d+$/u);

export const ChunkObservationSchema = z.strictObject({
  field: StyleArrayFieldSchema,
  claim: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  evidenceMessageIds: z.array(EvidenceMessageIdSchema).min(1).max(8),
});

const RepresentativeMessageSchema = z.strictObject({
  messageId: EvidenceMessageIdSchema,
  content: z.string().min(1),
});

export const StyleChunkSummarySchema = z.strictObject({
  observations: z.array(ChunkObservationSchema).max(30),
  representativeMessages: z.array(RepresentativeMessageSchema).max(10),
});
export type StyleChunkSummary = z.infer<typeof StyleChunkSummarySchema>;

export const PriorDecisionSchema = z.strictObject({
  priorIndex: z.number().int().nonnegative(),
  decision: z.enum(["retain", "remove"]),
  removalBasis: z
    .enum(["contradicted", "explicit-low-confidence-judgment"])
    .nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(500).nullable(),
  evidenceMessageIds: z.array(EvidenceMessageIdSchema).max(8),
});
export type PriorDecision = z.infer<typeof PriorDecisionSchema>;

export const AdditionSchema = z.strictObject({
  value: z.string().min(1).max(1000),
  confidence: z.number().min(0.7).max(1),
  evidenceMessageIds: z.array(EvidenceMessageIdSchema).min(1).max(8),
});

const FieldPatchSchema = z.strictObject({
  field: StyleArrayFieldSchema,
  priorDecisions: z.array(PriorDecisionSchema),
  additions: z.array(AdditionSchema).max(30),
});

export const GeneratedLeagueValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.strictObject({
    likes: z.array(z.string()),
    dislikes: z.array(z.string()),
  }),
]);
export type GeneratedLeagueValue = z.infer<typeof GeneratedLeagueValueSchema>;

const SummaryPatchSchema = z.strictObject({
  priorDecisions: z.array(PriorDecisionSchema),
  additions: z.array(AdditionSchema).max(30),
});

const LeagueAdditionSchema = z.strictObject({
  key: z.string().min(1),
  value: GeneratedLeagueValueSchema,
  confidence: z.number().min(0.7).max(1),
  evidenceMessageIds: z.array(EvidenceMessageIdSchema).min(1).max(8),
});

const LeaguePatchSchema = z.strictObject({
  priorDecisions: z.array(PriorDecisionSchema),
  additions: z.array(LeagueAdditionSchema).max(30),
});

export const StyleSynthesisSchema = z.strictObject({
  patches: z.array(FieldPatchSchema).length(STYLE_ARRAY_FIELDS.length),
  summaryPatch: SummaryPatchSchema,
  leaguePatch: LeaguePatchSchema,
  quoteMessageIds: z.array(EvidenceMessageIdSchema).length(20),
  sampleMessageIds: z.array(EvidenceMessageIdSchema).length(30),
  situational_examples: SituationalExamplesSchema,
});
export type StyleSynthesis = z.infer<typeof StyleSynthesisSchema>;
