import { z } from "zod";
import {
  StorableBucksStakeSchema,
  DARE_MAX_HORIZON_DAYS,
  DARE_MAX_QUERY_LENGTH,
  DARE_MAX_TARGETS,
  DareDeadlineSpecSchema,
  DareSqlCompetitionSchema,
  DareActivationSchema,
  DareIntentPayloadSchema,
} from "@scout-for-lol/data";

export const DareToolResultSchema = z.strictObject({
  kind: z.string().min(1),
  message: z.string().min(1),
  data: z.json().nullable(),
});
export type DareToolResult = z.infer<typeof DareToolResultSchema>;

const DareListCopyFields = {
  displayTitle: z.string().trim().min(1).max(80),
  statusPhrases: z.record(
    z.string().min(1).max(64),
    z.string().trim().min(1).max(80),
  ),
};

export const DareDefinitionToolInputSchema = z.strictObject({
  originalText: z.string().min(1).max(4000),
  ...DareListCopyFields,
  targetKeys: z
    .array(z.string().regex(/^T[1-5]$/))
    .min(1)
    .max(DARE_MAX_TARGETS),
  queryText: z.string().min(1).max(DARE_MAX_QUERY_LENGTH),
  plainLanguage: z.string().min(1).max(4000),
  deadlineSpec: DareDeadlineSpecSchema,
  openingStake: StorableBucksStakeSchema,
  competition: DareSqlCompetitionSchema.default({ kind: "standard" }),
  activation: DareActivationSchema.default({ kind: "immediate" }),
});

export const DareScoutQlToolInputSchema = z.strictObject({
  queryText: z.string().min(1).max(DARE_MAX_QUERY_LENGTH),
  targetKeys: z
    .array(z.string().regex(/^T\d{1,2}$/))
    .min(1)
    .max(DARE_MAX_TARGETS),
});

const RevisionFields = {
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
};

export const ReviseDareToolInputSchema =
  DareDefinitionToolInputSchema.extend(RevisionFields);

const PreviewFields = {
  historyDays: z.number().int().min(1).max(DARE_MAX_HORIZON_DAYS).default(30),
};

export const DarePreviewToolInputSchema =
  DareDefinitionToolInputSchema.extend(PreviewFields);

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
