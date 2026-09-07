import { z } from "zod";

export const DareProgressValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const DareProgressConditionSchema = z.strictObject({
  key: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().min(1),
  targetKeys: z.array(z.string().min(1)),
  gameSet: z.string().min(1).nullable(),
  operator: z.string().min(1).nullable(),
  current: DareProgressValueSchema,
  target: DareProgressValueSchema,
  remaining: z.number().nonnegative().nullable(),
  matchedGames: z.number().int().nonnegative(),
  eligibleGames: z.number().int().nonnegative(),
  unknownGames: z.number().int().nonnegative(),
  value: z.boolean().nullable(),
});
export type DareProgressCondition = z.infer<typeof DareProgressConditionSchema>;

export const DareTargetProgressSchema = z.strictObject({
  targetKey: z.string().min(1),
  conditionKeys: z.array(z.string().min(1)),
  matchedGames: z.number().int().nonnegative(),
  eligibleGames: z.number().int().nonnegative(),
  value: z.boolean().nullable(),
});

export const DareCoverageGapSchema = z.strictObject({
  matchId: z.string().min(1),
  gameEndAt: z.iso.datetime(),
  sourceReferences: z.array(z.string().min(1)),
  targetKeys: z.array(z.string().min(1)),
  reason: z.string().min(1),
});

export const DareProgressChangeSchema = z.strictObject({
  kind: z.enum(["advance", "regression", "coverage", "evidence"]),
  matchId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  summary: z.string().min(1),
  conditionKeys: z.array(z.string().min(1)),
});

export const DareProgressSchema = z.strictObject({
  value: z.boolean().nullable(),
  final: z.boolean(),
  finalityReason: z.string().min(1),
  matchedGames: z.number().int().nonnegative(),
  eligibleGames: z.number().int().nonnegative(),
  evidenceGames: z.number().int().nonnegative(),
  conditions: z.array(DareProgressConditionSchema),
  targets: z.array(DareTargetProgressSchema),
  coverageGaps: z.array(DareCoverageGapSchema),
  latestMaterialChange: DareProgressChangeSchema.nullable(),
  summary: z.string().min(1),
});
export type DareProgress = z.infer<typeof DareProgressSchema>;

export const DarePollHealthSchema = z.strictObject({
  status: z.enum([
    "never",
    "healthy",
    "incomplete",
    "failed",
    "delayed",
    "stale",
  ]),
  pollStartedAt: z.iso.datetime().nullable(),
  pollCompletedAt: z.iso.datetime().nullable(),
  evidenceWatermarkAt: z.iso.datetime().nullable(),
  lastSuccessfulProcessingAt: z.iso.datetime().nullable(),
  failureReason: z.string().nullable(),
  incompleteReasons: z.array(z.string().min(1)),
});
export type DarePollHealth = z.infer<typeof DarePollHealthSchema>;
