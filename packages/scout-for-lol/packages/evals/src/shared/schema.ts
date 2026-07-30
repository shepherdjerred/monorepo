import { z } from "zod";

export const EvalScoreSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const PerformanceSliceSchema = z.enum(["great", "terrible", "average"]);
export const DatasetStatusSchema = z.enum(["draft", "finalized"]);

export const DatasetIdSchema = z.string().min(1);
export const CaseIdSchema = z.string().min(1);
export const GenerationIdSchema = z.string().min(1);

export const CreateDatasetInputSchema = z.strictObject({
  key: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().default(""),
});

export const DatasetInputSchema = z.strictObject({
  datasetId: DatasetIdSchema,
});
export const CaseInputSchema = z.strictObject({
  caseId: CaseIdSchema,
  datasetId: DatasetIdSchema,
});

export const FrozenRenderedPromptSchema = z.strictObject({
  systemPrompt: z.string().min(1),
  userPrompt: z.string().min(1),
});

export const FrozenTimelineChunkPromptSchema = z.strictObject({
  chunkIndex: z.number().int().nonnegative(),
  timeRange: z.string().min(1),
  systemPrompt: z.string().min(1),
  userPrompt: z.string().min(1),
});

const FrozenTimelineChunkPromptsSchema = z
  .array(FrozenTimelineChunkPromptSchema)
  .min(2)
  .superRefine((chunks, context) => {
    for (const [position, chunk] of chunks.entries()) {
      if (chunk.chunkIndex !== position) {
        context.addIssue({
          code: "custom",
          message: `Timeline chunk index ${chunk.chunkIndex.toString()} must match its array position ${position.toString()}`,
          path: [position, "chunkIndex"],
        });
      }
    }
  });

const FrozenSingleTimelinePromptsSchema = z.strictObject({
  mode: z.literal("single"),
  summary: FrozenRenderedPromptSchema,
});

const FrozenChunkedTimelinePromptsSchema = z.strictObject({
  mode: z.literal("chunked"),
  chunks: FrozenTimelineChunkPromptsSchema,
  aggregate: FrozenRenderedPromptSchema,
});

const FrozenTimelinePromptsSchema = z.discriminatedUnion("mode", [
  FrozenSingleTimelinePromptsSchema,
  FrozenChunkedTimelinePromptsSchema,
]);

export const FrozenRenderedPromptsSchema = z.strictObject({
  matchSummary: FrozenRenderedPromptSchema,
  timeline: FrozenTimelinePromptsSchema,
  reviewText: FrozenRenderedPromptSchema,
});

export const ReviewContextSchema = z.strictObject({
  deterministicFacts: z.string().min(1),
  matchSummary: z.string().min(1),
  timelineSummary: z.string().min(1),
  laneContext: z.string(),
  playerHistory: z.string(),
  patchContext: z.string(),
  styleCard: z.string().min(1),
  personalityInstructions: z.string().min(1),
  selectedBehaviors: z.array(z.string()),
  renderedPrompts: FrozenRenderedPromptsSchema,
});

export const FrozenModelConfigSchema = z.strictObject({
  model: z.string().min(1),
  maxTokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
});

export const FrozenModelSettingsSchema = z.strictObject({
  timelineSummary: FrozenModelConfigSchema,
  timelineChunk: FrozenModelConfigSchema,
  timelineAggregate: FrozenModelConfigSchema,
  matchSummary: FrozenModelConfigSchema,
  reviewText: FrozenModelConfigSchema,
});

export const CaseArtifactSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: z.string().min(1),
  targetPlayerName: z.string().min(1),
  targetPlayerPuuid: z.string().min(1),
  targetPlayerIndex: z.number().int().nonnegative(),
  championName: z.string().min(1),
  queueType: z.string().min(1),
  performanceSlice: PerformanceSliceSchema,
  styleKey: z.string().min(1),
  context: ReviewContextSchema,
  modelSettings: FrozenModelSettingsSchema,
  rawMatch: z.unknown(),
  rawTimeline: z.unknown(),
  processedMatch: z.unknown(),
  source: z.strictObject({
    bucket: z.string().min(1),
    matchKey: z.string().min(1),
    timelineKey: z.string().min(1),
    matchSha256: z.string().length(64),
    timelineSha256: z.string().length(64),
  }),
});

export const DatasetSummarySchema = z.strictObject({
  id: DatasetIdSchema,
  key: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string(),
  status: DatasetStatusSchema,
  caseCount: z.number().int().nonnegative(),
  ratedCaseCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  finalizedAt: z.iso.datetime().nullable(),
});

export const CaseSummarySchema = z.strictObject({
  id: CaseIdSchema,
  datasetId: DatasetIdSchema,
  ordinal: z.number().int().nonnegative(),
  matchId: z.string().min(1),
  targetPlayerName: z.string().min(1),
  championName: z.string().min(1),
  performanceSlice: PerformanceSliceSchema,
  styleKey: z.string().min(1),
  generationId: GenerationIdSchema.nullable(),
  isRated: z.boolean(),
});

export const HumanRatingSchema = z.strictObject({
  anchoredness: EvalScoreSchema,
  entertainment: EvalScoreSchema,
  styleRecognizability: EvalScoreSchema,
  note: z.string().max(2000),
});

export const GenerationSchema = z.strictObject({
  id: GenerationIdSchema,
  outputText: z.string().min(1),
  model: z.string().min(1),
  promptRevision: z.string().min(1),
  durationMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
});

export const RecordGenerationInputSchema = GenerationSchema.omit({
  id: true,
}).extend({
  caseId: CaseIdSchema,
});

export const UpsertHumanRatingInputSchema = z.strictObject({
  generationId: GenerationIdSchema,
  rating: HumanRatingSchema,
});

export const CaseDetailSchema = z.strictObject({
  summary: CaseSummarySchema,
  artifact: CaseArtifactSchema,
  generation: GenerationSchema.nullable(),
  rating: HumanRatingSchema.nullable(),
  previousCaseId: CaseIdSchema.nullable(),
  nextCaseId: CaseIdSchema.nullable(),
});

export const FreshnessRatingSchema = z.strictObject({
  score: EvalScoreSchema,
  note: z.string().max(2000),
});

export const GenerationSetRevisionSchema = z.string().regex(/^[\da-f]{64}$/);

export const StyleBatchInputSchema = z.strictObject({
  datasetId: DatasetIdSchema,
  styleKey: z.string().trim().min(1),
});

export const UpsertFreshnessRatingInputSchema = StyleBatchInputSchema.extend({
  generationSetRevision: GenerationSetRevisionSchema,
  rating: FreshnessRatingSchema,
});

const StyleReviewSchema = z.strictObject({
  caseId: CaseIdSchema,
  generationId: GenerationIdSchema,
  playerName: z.string().min(1),
  championName: z.string().min(1),
  performanceSlice: PerformanceSliceSchema,
  outputText: z.string().min(1),
});

export const StyleBatchSchema = z.strictObject({
  datasetId: DatasetIdSchema,
  styleKey: z.string().min(1),
  generationSetRevision: GenerationSetRevisionSchema,
  reviews: z.array(StyleReviewSchema),
  rating: FreshnessRatingSchema.nullable(),
});

export type DatasetSummary = z.infer<typeof DatasetSummarySchema>;
export type CaseSummary = z.infer<typeof CaseSummarySchema>;
export type CaseArtifact = z.infer<typeof CaseArtifactSchema>;
export type FrozenRenderedPrompts = z.infer<typeof FrozenRenderedPromptsSchema>;
export type HumanRating = z.infer<typeof HumanRatingSchema>;
export type EvalScore = z.infer<typeof EvalScoreSchema>;
