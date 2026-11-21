import { z } from "zod";

const ConstraintSchema = z.strictObject({
  property: z.string().min(1),
  value: z.string().min(1),
});

const RolloutSchema = z.strictObject({
  constraints: z.array(ConstraintSchema).min(1),
  result: z.boolean(),
});

export const BooleanFlagSchema = z.strictObject({
  type: z.literal("boolean"),
  key: z.string().min(1),
  default: z.boolean(),
  rollouts: z.array(RolloutSchema),
});

export const VariantFlagSchema = z.strictObject({
  type: z.literal("variant"),
  key: z.string().min(1),
  value: z.string(),
});

export const FlagValueSchema = z.discriminatedUnion("type", [
  BooleanFlagSchema,
  VariantFlagSchema,
]);

export const ApplyBodySchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  flags: z.array(FlagValueSchema).min(1),
});

export const CreateMissingBodySchema = z.strictObject({
  flags: z.array(FlagValueSchema).min(1),
});

export const RetireBodySchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  keys: z.array(z.string().min(1)).min(1),
});

export const EvaluateBodySchema = z.strictObject({
  deployment: z.string().min(1),
  key: z.string().min(1),
  context: z.record(z.string(), z.string()).optional(),
});
