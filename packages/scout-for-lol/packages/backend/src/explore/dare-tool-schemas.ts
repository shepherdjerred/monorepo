import { z } from "zod";
import {
  BucksStakeSchema,
  DARE_V2_MAX_HORIZON_DAYS,
  DARE_V2_MAX_QUERY_LENGTH,
  DARE_V2_MAX_TARGETS,
  DareCompiledPlanV2Schema,
  DareDeadlineSpecV2Schema,
  DareSqlV3CompetitionSchema,
  DareActivationV3Schema,
  DareIntentPayloadSchema,
} from "@scout-for-lol/data";

export const DareToolResultSchema = z.strictObject({
  kind: z.string().min(1),
  message: z.string().min(1),
  data: z.json().nullable(),
});
export type DareToolResult = z.infer<typeof DareToolResultSchema>;

export const DareDefinitionV2ToolInputSchema = z.strictObject({
  originalText: z.string().min(1).max(4000),
  targetKeys: z
    .array(z.string().regex(/^T\d{1,2}$/))
    .min(1)
    .max(DARE_V2_MAX_TARGETS),
  plan: DareCompiledPlanV2Schema,
  deadlineSpec: DareDeadlineSpecV2Schema,
  openingStake: BucksStakeSchema,
});

export const DareDefinitionV3ToolInputSchema = z.strictObject({
  originalText: z.string().min(1).max(4000),
  targetKeys: z
    .array(z.string().regex(/^T[1-5]$/))
    .min(1)
    .max(DARE_V2_MAX_TARGETS),
  queryText: z.string().min(1).max(DARE_V2_MAX_QUERY_LENGTH),
  plainLanguage: z.string().min(1).max(4000),
  deadlineSpec: DareDeadlineSpecV2Schema,
  openingStake: BucksStakeSchema,
  competition: DareSqlV3CompetitionSchema.default({ kind: "standard" }),
  activation: DareActivationV3Schema.default({ kind: "immediate" }),
});

export const DareDefinitionToolInputSchema = z.union([
  DareDefinitionV3ToolInputSchema,
  DareDefinitionV2ToolInputSchema,
]);

export const DareScoutQlToolInputSchema = z.strictObject({
  queryText: z.string().min(1).max(DARE_V2_MAX_QUERY_LENGTH),
  targetKeys: z
    .array(z.string().regex(/^T\d{1,2}$/))
    .min(1)
    .max(DARE_V2_MAX_TARGETS),
});

const RevisionFields = {
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
};

export const ReviseDareToolInputSchema = z.union([
  DareDefinitionV3ToolInputSchema.extend(RevisionFields),
  DareDefinitionV2ToolInputSchema.extend(RevisionFields),
]);

const PreviewFields = {
  historyDays: z
    .number()
    .int()
    .min(1)
    .max(DARE_V2_MAX_HORIZON_DAYS)
    .default(30),
};

export const DarePreviewToolInputSchema = z.union([
  DareDefinitionV3ToolInputSchema.extend(PreviewFields),
  DareDefinitionV2ToolInputSchema.extend(PreviewFields),
]);

export const DareListToolInputSchema = z.strictObject({
  scope: z.enum(["mine", "guild"]),
  search: z.string().min(1).max(100).optional(),
});

export const DareInspectToolInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
});

// The dare-only payload union, so the Explore dare tool cannot mint a
// creation intent — those have their own gate, RBAC and confirm procedure.
export const DareActionToolInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  payload: DareIntentPayloadSchema,
});

export const DareDeleteToolInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
});
