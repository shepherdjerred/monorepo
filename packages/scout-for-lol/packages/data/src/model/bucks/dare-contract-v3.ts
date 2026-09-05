import { z } from "zod";
import { DivisionSchema } from "#src/model/riot/division.ts";
import { RankSchema, RankedQueueTypeSchema } from "#src/model/riot/rank.ts";
import { TierSchema } from "#src/model/riot/tier.ts";
import {
  DARE_V2_MAX_ELIGIBLE_GAMES,
  DareRelationalContractRuntimeSchema,
} from "#src/model/bucks/dare-contract-v2.ts";

export const DARE_CONTRACT_V3_VERSION = 3;
export const DARE_SQL_V3_COMPILER_VERSION = "dare-scoutql-3" as const;
export const DARE_SQL_V3_EVALUATOR_VERSION = "dare-evaluator-3" as const;

const DareSqlV3RaceLaneSchema = z.strictObject({
  targetKey: z.string().regex(/^T[1-5]$/u),
  gameSet: z.string().regex(/^[a-z_]\w*$/u),
});

export const DareSqlV3CompetitionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("standard") }),
  z.strictObject({
    kind: z.literal("race"),
    lanes: z.array(DareSqlV3RaceLaneSchema).min(2).max(5),
  }),
]);
export type DareSqlV3Competition = z.infer<typeof DareSqlV3CompetitionSchema>;

const DareRankGoalV3Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("reach"),
    tier: TierSchema,
    division: DivisionSchema,
    lp: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    kind: z.literal("gain"),
    normalizedLp: z.number().int().positive(),
  }),
]);

const DareImprovementWindowV3Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("last_games"),
    count: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("last_days"),
    days: z.number().int().min(1).max(90),
  }),
]);

const DareImprovementGoalV3Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("personal_best") }),
  z.strictObject({
    kind: z.literal("absolute"),
    delta: z.number().positive(),
  }),
  z.strictObject({
    kind: z.literal("percentage"),
    percent: z.number().positive(),
  }),
]);

export const DareActivationV3Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("immediate") }),
  z.strictObject({
    kind: z.literal("rank"),
    queue: RankedQueueTypeSchema.extract(["solo", "flex"]),
    goal: DareRankGoalV3Schema,
  }),
  z.strictObject({
    kind: z.literal("improvement"),
    targetKey: z.string().regex(/^T[1-5]$/u),
    gameSet: z.string().regex(/^[a-z_]\w*$/u),
    projection: z.string().regex(/^[a-z_]\w*$/u),
    aggregation: z.enum(["average", "maximum", "minimum"]),
    direction: z.enum(["higher", "lower"]),
    window: DareImprovementWindowV3Schema,
    goal: DareImprovementGoalV3Schema,
  }),
]);
export type DareActivationV3 = z.infer<typeof DareActivationV3Schema>;

const DareActivationTargetSnapshotV3Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("rank"),
    targetKey: z.string().regex(/^T[1-5]$/u),
    queue: RankedQueueTypeSchema.extract(["solo", "flex"]),
    sourcePuuid: z.string().min(1),
    baseline: RankSchema,
  }),
  z.strictObject({
    kind: z.literal("improvement"),
    targetKey: z.string().regex(/^T[1-5]$/u),
    baselineValue: z.number(),
    aggregation: z.enum(["average", "maximum", "minimum"]),
    direction: z.enum(["higher", "lower"]),
    sampleCount: z.number().int().positive(),
    dateSpan: z.strictObject({
      start: z.iso.datetime(),
      end: z.iso.datetime(),
    }),
    sourceMatchIds: z.array(z.string().min(1)).min(1),
  }),
]);

export const DareActivationSnapshotV3Schema = z.strictObject({
  version: z.literal(1),
  activatedAt: z.iso.datetime(),
  targets: z.array(DareActivationTargetSnapshotV3Schema).min(1).max(5),
});
export type DareActivationSnapshotV3 = z.infer<
  typeof DareActivationSnapshotV3Schema
>;

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
  competition: DareSqlV3CompetitionSchema.default({ kind: "standard" }),
  activation: DareActivationV3Schema.default({ kind: "immediate" }),
});
export type DareSqlV3Compilation = z.infer<typeof DareSqlV3CompilationSchema>;

export const DareContractV3Schema = z
  .strictObject({
    version: z.literal(DARE_CONTRACT_V3_VERSION),
    canonicalSql: z.string().min(1).max(16_000),
    immutableAst: z.string().min(1),
    queryHash: z.string().regex(/^[a-f\d]{64}$/u),
    maxEligibleGames: z
      .number()
      .int()
      .positive()
      .max(DARE_V2_MAX_ELIGIBLE_GAMES),
    compilerVersion: z.literal(DARE_SQL_V3_COMPILER_VERSION),
    evaluatorVersion: z.literal(DARE_SQL_V3_EVALUATOR_VERSION),
    finality: z.enum(["monotone_true", "deadline_only"]),
    facts: DareSqlV3FactsSchema,
    resultStructure: DareSqlV3ResultStructureSchema,
    competition: DareSqlV3CompetitionSchema.default({ kind: "standard" }),
    activation: DareActivationV3Schema.default({ kind: "immediate" }),
    activationSnapshot: DareActivationSnapshotV3Schema.nullable().default(null),
    originalText: z.string().min(1),
    plainLanguage: z.string().min(1),
  })
  .extend(DareRelationalContractRuntimeSchema.shape);
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
  timelineEvents: z
    .array(
      z.strictObject({
        eventId: z.string().min(1),
        matchId: z.string().min(1),
        targetKey: z.string().regex(/^T[1-5]$/u),
        timestampMs: z.number().int().nonnegative(),
        frameIndex: z.number().int().nonnegative(),
        eventIndex: z.number().int().nonnegative(),
        type: z.string().min(1),
        itemId: z.number().int().nullable(),
        skillSlot: z.number().int().nullable(),
      }),
    )
    .default([]),
  race: z
    .strictObject({
      leaders: z.array(z.string().regex(/^T[1-5]$/u)),
      qualifyingGameEndAt: z.iso.datetime().nullable(),
    })
    .nullable()
    .default(null),
  rank: z
    .strictObject({
      queue: RankedQueueTypeSchema.extract(["solo", "flex"]),
      targets: z.array(
        z.strictObject({
          targetKey: z.string().regex(/^T[1-5]$/u),
          baseline: RankSchema,
          current: RankSchema,
          normalizedDelta: z.number(),
          goalMet: z.boolean(),
        }),
      ),
    })
    .nullable()
    .default(null),
  improvement: z
    .strictObject({
      targetKey: z.string().regex(/^T[1-5]$/u),
      baselineValue: z.number(),
      currentValue: z.number().nullable(),
      bestAttempt: z.number().nullable(),
      targetValue: z.number(),
      sampleCount: z.number().int().nonnegative(),
      sourceMatchIds: z.array(z.string()),
      goalMet: z.boolean(),
    })
    .nullable()
    .default(null),
});
export type DareSqlV3Evidence = z.infer<typeof DareSqlV3EvidenceSchema>;
