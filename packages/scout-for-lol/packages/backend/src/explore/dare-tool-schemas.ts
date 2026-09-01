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

export const DareDefinitionToolInputSchema = z.strictObject({
  originalText: z.string().min(1).max(4000),
  targetKeys: z
    .array(z.string().regex(/^T\d{1,2}$/))
    .min(1)
    .max(DARE_V2_MAX_TARGETS),
  plan: DareCompiledPlanV2Schema,
  deadlineSpec: DareDeadlineSpecV2Schema,
  openingStake: BucksStakeSchema,
});

export const DareScoutQlToolInputSchema = z.strictObject({
  queryText: z.string().min(1).max(DARE_V2_MAX_QUERY_LENGTH),
  targetKeys: z
    .array(z.string().regex(/^T\d{1,2}$/))
    .min(1)
    .max(DARE_V2_MAX_TARGETS),
});

export const ReviseDareToolInputSchema = DareDefinitionToolInputSchema.extend({
  dareId: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
});

export const DarePreviewToolInputSchema = DareDefinitionToolInputSchema.extend({
  historyDays: z
    .number()
    .int()
    .min(1)
    .max(DARE_V2_MAX_HORIZON_DAYS)
    .default(30),
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
