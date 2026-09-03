import { z } from "zod";
import {
  BucksStakeSchema,
  DARE_V2_MAX_HORIZON_DAYS,
  DARE_V2_MAX_QUERY_LENGTH,
  DARE_V2_MAX_TARGETS,
  DareCompiledPlanV2Schema,
  DareDeadlineSpecV2Schema,
} from "@scout-for-lol/data";
import { DareV2IntentPayloadSchema } from "#src/betting/dare-intent-v2.ts";

export const DareToolResultSchema = z.strictObject({
  kind: z.string().min(1),
  message: z.string().min(1),
  data: z.json().nullable(),
});
export type DareToolResult = z.infer<typeof DareToolResultSchema>;

const ShortlistTargetKeysSchema = z
  .array(z.string().regex(/^T\d{1,2}$/))
  .min(1)
  .max(DARE_V2_MAX_TARGETS);
const ProviderTargetKeysSchema = z
  .array(z.string())
  .min(1)
  .max(DARE_V2_MAX_TARGETS);

export const DareDefinitionV2ToolInputSchema = z.strictObject({
  originalText: z.string().min(1).max(4000),
  targetKeys: ShortlistTargetKeysSchema,
  plan: DareCompiledPlanV2Schema,
  deadlineSpec: DareDeadlineSpecV2Schema,
  openingStake: BucksStakeSchema,
});

export const DareDefinitionV3ToolInputSchema = z.strictObject({
  originalText: z.string().min(1).max(4000),
  targetKeys: ShortlistTargetKeysSchema,
  queryText: z.string().min(1).max(DARE_V2_MAX_QUERY_LENGTH),
  plainLanguage: z.string().min(1).max(4000),
  deadlineSpec: DareDeadlineSpecV2Schema,
  openingStake: BucksStakeSchema,
});

// Keep the provider-facing schema object-rooted. The two strict schemas above
// remain the semantic alternatives and are selected after parsing, while this
// superset prevents OpenAI-style tool schemas from serializing as top-level
// `anyOf`.
const DareProviderContentFields = {
  originalText: z.string().min(1).max(4000),
  targetKeys: ProviderTargetKeysSchema,
  plan: DareCompiledPlanV2Schema.optional(),
  queryText: z.string().min(1).max(DARE_V2_MAX_QUERY_LENGTH).optional(),
  plainLanguage: z.string().min(1).max(4000).optional(),
  deadlineSpec: DareDeadlineSpecV2Schema,
  openingStake: BucksStakeSchema,
};

export const DareDefinitionToolInputSchema = z.strictObject({
  ...DareProviderContentFields,
});

export const DareScoutQlToolInputSchema = z.strictObject({
  queryText: z.string().min(1).max(DARE_V2_MAX_QUERY_LENGTH),
  targetKeys: ShortlistTargetKeysSchema,
});

const RevisionFields = {
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
};

export const ReviseDareToolInputSchema = z.strictObject({
  ...RevisionFields,
  ...DareProviderContentFields,
});

const PreviewFields = {
  historyDays: z
    .number()
    .int()
    .min(1)
    .max(DARE_V2_MAX_HORIZON_DAYS)
    .default(30),
};

export const DarePreviewToolInputSchema = z.strictObject({
  ...PreviewFields,
  ...DareProviderContentFields,
});

export const DareListToolInputSchema = z.strictObject({
  scope: z.enum(["mine", "guild"]),
  search: z.string().min(1).max(100).optional(),
});

export const DareInspectToolInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
});

export const DareActionToolInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  payload: DareV2IntentPayloadSchema,
});

export const DareDeleteToolInputSchema = z.strictObject({
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
});
