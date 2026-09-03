import { z } from "zod";
import { BucksStakeSchema } from "#src/model/bryan-bucks.ts";
import {
  DARE_V2_MAX_ELIGIBLE_GAMES,
  DareDeadlineSpecV2Schema,
  DareTargetBindingV2Schema,
} from "#src/model/dare-contract-v2.ts";

export const DARE_CONTRACT_V3_VERSION = 3;
export const DARE_SQL_V3_COMPILER_VERSION = "dare-scoutql-3" as const;
export const DARE_SQL_V3_EVALUATOR_VERSION = "dare-evaluator-3" as const;

export const DareSqlV3FactsSchema = z.strictObject({
  cteCount: z.number().int().nonnegative(),
  joinedRelations: z.number().int().nonnegative(),
  predicates: z.number().int().nonnegative(),
  maxExpressionDepth: z.number().int().nonnegative(),
  physicalSources: z.array(z.string()),
  functions: z.array(z.string()),
  targetKeys: z
    .array(z.string().regex(/^T[1-5]$/u))
    .min(1)
    .max(5),
});

export const DareSqlV3ResultStructureSchema = z.strictObject({
  gameSets: z.array(
    z.strictObject({
      name: z.string().regex(/^[a-z_]\w*$/u),
      projectionColumns: z.array(z.string().regex(/^[a-z_]\w*$/u)),
      targetDependencies: z.array(z.string().regex(/^T[1-5]$/u)),
    }),
  ),
});

export const DareSqlV3CompilationSchema = z.strictObject({
  compilerVersion: z.literal(DARE_SQL_V3_COMPILER_VERSION),
  canonicalSql: z.string().min(1).max(16_000),
  immutableAst: z.string().min(1),
  queryHash: z.string().regex(/^[a-f\d]{64}$/u),
  maxEligibleGames: z.number().int().positive().max(DARE_V2_MAX_ELIGIBLE_GAMES),
  facts: DareSqlV3FactsSchema,
  resultStructure: DareSqlV3ResultStructureSchema,
  finality: z.enum(["monotone_true", "deadline_only"]),
});
export type DareSqlV3Compilation = z.infer<typeof DareSqlV3CompilationSchema>;

export const DareContractV3Schema = z.strictObject({
  version: z.literal(DARE_CONTRACT_V3_VERSION),
  canonicalSql: z.string().min(1).max(16_000),
  immutableAst: z.string().min(1),
  queryHash: z.string().regex(/^[a-f\d]{64}$/u),
  maxEligibleGames: z.number().int().positive().max(DARE_V2_MAX_ELIGIBLE_GAMES),
  compilerVersion: z.literal(DARE_SQL_V3_COMPILER_VERSION),
  evaluatorVersion: z.literal(DARE_SQL_V3_EVALUATOR_VERSION),
  finality: z.enum(["monotone_true", "deadline_only"]),
  facts: DareSqlV3FactsSchema,
  resultStructure: DareSqlV3ResultStructureSchema,
  targets: z.array(DareTargetBindingV2Schema).min(1).max(5),
  openingStake: BucksStakeSchema,
  serverId: z.string().min(1),
  channelId: z.string().min(1),
  revision: z.number().int().positive(),
  activationAt: z.iso.datetime(),
  deadlineAt: z.iso.datetime(),
  deadlineSpec: DareDeadlineSpecV2Schema,
  originalText: z.string().min(1),
  plainLanguage: z.string().min(1),
});
export type DareContractV3 = z.infer<typeof DareContractV3Schema>;

export const DareSqlV3EvidenceSchema = z.strictObject({
  achieved: z.boolean().nullable(),
  results: z.array(
    z.strictObject({
      gameSet: z.string().min(1),
      matchId: z.string().min(1),
      gameEndAt: z.iso.datetime(),
      matched: z.boolean().nullable(),
      projections: z.record(z.string(), z.number().nullable()),
      targetDependencies: z.array(z.string().regex(/^T[1-5]$/u)),
    }),
  ),
  targetDependencies: z.array(z.string().regex(/^T[1-5]$/u)),
  coverage: z.enum(["complete", "missing_timeline", "not_required"]),
  sourceMatchIds: z.array(z.string()),
  queryHash: z.string().regex(/^[a-f\d]{64}$/u),
});
export type DareSqlV3Evidence = z.infer<typeof DareSqlV3EvidenceSchema>;
