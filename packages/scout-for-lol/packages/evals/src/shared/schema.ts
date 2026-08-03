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
// Finalization is irreversible, so it must lock exactly the case set the
// reviewer saw. Cases are append-only, so the case count is a sufficient
// revision token: if another materialization appended cases after the draft
// page rendered, the count no longer matches and finalization is rejected.
export const FinalizeDatasetInputSchema = z.strictObject({
  datasetId: DatasetIdSchema,
  expectedCaseCount: z.number().int().nonnegative(),
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
  renderedPrompts: FrozenRenderedPromptsSchema,
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

export const DatasetExportMetadataSchema = DatasetSummarySchema.pick({
  id: true,
  key: true,
  version: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  finalizedAt: true,
}).extend({
  status: z.literal("finalized"),
  finalizedAt: z.iso.datetime(),
});

export const DatasetExportGenerationSchema = z.strictObject({
  generation: GenerationSchema,
  rating: HumanRatingSchema.nullable(),
});

export const DatasetExportCaseSchema = z.strictObject({
  id: CaseIdSchema,
  ordinal: z.number().int().nonnegative(),
  artifact: CaseArtifactSchema,
  generations: z.array(DatasetExportGenerationSchema),
});

export const DatasetExportFreshnessRatingSchema = z.strictObject({
  styleKey: z.string().min(1),
  rating: FreshnessRatingSchema,
});

export const DatasetExportPayloadSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    dataset: DatasetExportMetadataSchema,
    cases: z.array(DatasetExportCaseSchema).min(1),
    freshnessRatings: z.array(DatasetExportFreshnessRatingSchema),
  })
  .superRefine((payload, context) => {
    const caseIds = new Set<string>();
    const generationIds = new Set<string>();
    const memberships = new Set<string>();
    const styles = new Set<string>();
    const generatedStyles = new Set<string>();

    for (const [position, evalCase] of payload.cases.entries()) {
      if (evalCase.ordinal !== position) {
        context.addIssue({
          code: "custom",
          message: `Case ordinal ${String(evalCase.ordinal)} must match its array position ${String(position)}`,
          path: ["cases", position, "ordinal"],
        });
      }
      if (caseIds.has(evalCase.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate case id ${evalCase.id}`,
          path: ["cases", position, "id"],
        });
      }
      caseIds.add(evalCase.id);

      const membership = [
        evalCase.artifact.matchId,
        evalCase.artifact.targetPlayerPuuid,
        evalCase.artifact.styleKey,
      ].join("\0");
      if (memberships.has(membership)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate match-player-style case membership",
          path: ["cases", position, "artifact"],
        });
      }
      memberships.add(membership);
      styles.add(evalCase.artifact.styleKey);
      if (evalCase.generations.length > 0) {
        generatedStyles.add(evalCase.artifact.styleKey);
      }

      for (const [
        generationPosition,
        record,
      ] of evalCase.generations.entries()) {
        if (generationIds.has(record.generation.id)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate generation id ${record.generation.id}`,
            path: [
              "cases",
              position,
              "generations",
              generationPosition,
              "generation",
              "id",
            ],
          });
        }
        generationIds.add(record.generation.id);
      }
    }

    let previousStyleKey: string | undefined;
    for (const [position, freshness] of payload.freshnessRatings.entries()) {
      if (!styles.has(freshness.styleKey)) {
        context.addIssue({
          code: "custom",
          message: `Freshness style ${freshness.styleKey} has no dataset cases`,
          path: ["freshnessRatings", position, "styleKey"],
        });
      }
      if (!generatedStyles.has(freshness.styleKey)) {
        context.addIssue({
          code: "custom",
          message: `Freshness style ${freshness.styleKey} has no generations`,
          path: ["freshnessRatings", position, "styleKey"],
        });
      }
      if (
        previousStyleKey !== undefined &&
        previousStyleKey >= freshness.styleKey
      ) {
        context.addIssue({
          code: "custom",
          message: "Freshness ratings must have unique sorted style keys",
          path: ["freshnessRatings", position, "styleKey"],
        });
      }
      previousStyleKey = freshness.styleKey;
    }
  });

export const DatasetExportSchema = DatasetExportPayloadSchema.safeExtend({
  sha256: z.string().regex(/^[\da-f]{64}$/),
});

export type DatasetSummary = z.infer<typeof DatasetSummarySchema>;
export type CaseSummary = z.infer<typeof CaseSummarySchema>;
export type CaseArtifact = z.infer<typeof CaseArtifactSchema>;
export type FrozenRenderedPrompts = z.infer<typeof FrozenRenderedPromptsSchema>;
export type HumanRating = z.infer<typeof HumanRatingSchema>;
export type EvalScore = z.infer<typeof EvalScoreSchema>;
export type DatasetExportPayload = z.infer<typeof DatasetExportPayloadSchema>;
export type DatasetExport = z.infer<typeof DatasetExportSchema>;
