import { z } from "zod";
import { StorableBucksStakeSchema } from "#src/model/bucks/bryan-bucks-money.ts";
import { DivisionSchema } from "#src/model/riot/division.ts";
import { RankSchema, RankedQueueTypeSchema } from "#src/model/riot/rank.ts";
import { TierSchema } from "#src/model/riot/tier.ts";

export const DARE_MAX_TARGETS = 5;
export const DARE_MAX_GAME_SETS = 20;
export const DARE_MAX_JOINED_RELATIONS = 8;
export const DARE_MAX_PREDICATES = 60;
export const DARE_MAX_EXPRESSION_DEPTH = 12;
export const DARE_MAX_QUERY_LENGTH = 16_000;
export const DARE_MAX_ELIGIBLE_GAMES = 100;
export const DARE_MAX_HORIZON_DAYS = 90;

export const OPEN_BUCKS_DARE_STATES = [
  "pending_accept",
  "activating",
  "active",
] as const;

export const BucksDareStateSchema = z.enum([
  "draft",
  "pending_accept",
  "activating",
  "active",
  "achieved",
  "unachieved",
  "declined",
  "expired",
  "voided",
  "cancelled",
  "deleted",
]);
export type BucksDareState = z.infer<typeof BucksDareStateSchema>;

export const DareTargetBindingSchema = z.strictObject({
  key: z.string().min(1).max(40),
  discordId: z.string().min(1),
  playerId: z.number().int().positive(),
  alias: z.string().min(1),
  accounts: z
    .array(
      z.strictObject({
        puuid: z.string().min(1),
        trackingStartedAt: z.iso.datetime(),
      }),
    )
    .min(1),
});
export type DareTargetBinding = z.infer<typeof DareTargetBindingSchema>;

export const DareDeadlineSpecSchema = z.union([
  z.strictObject({
    kind: z.literal("relative"),
    days: z.number().int().min(1).max(DARE_MAX_HORIZON_DAYS),
  }),
  z.strictObject({
    kind: z.literal("absolute"),
    deadlineAt: z.iso.datetime(),
    timezone: z.string().min(1),
  }),
]);
export type DareDeadlineSpec = z.infer<typeof DareDeadlineSpecSchema>;

export const DareContractRuntimeSchema = z.strictObject({
  targets: z.array(DareTargetBindingSchema).min(1).max(DARE_MAX_TARGETS),
  openingStake: StorableBucksStakeSchema,
  serverId: z.string().min(1),
  channelId: z.string().min(1),
  revision: z.number().int().positive(),
  activationAt: z.iso.datetime(),
  deadlineAt: z.iso.datetime(),
  deadlineSpec: DareDeadlineSpecSchema,
});

export const DARE_CONTRACT_VERSION = 3;
export const DARE_SQL_COMPILER_VERSION = "dare-scoutql-3" as const;
export const DARE_SQL_EVALUATOR_VERSION = "dare-evaluator-3" as const;

const DareSqlRaceLaneSchema = z.strictObject({
  targetKey: z.string().regex(/^T[1-5]$/u),
  gameSet: z.string().regex(/^[a-z_]\w*$/u),
});

export const DareSqlCompetitionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("standard") }),
  z.strictObject({
    kind: z.literal("race"),
    lanes: z.array(DareSqlRaceLaneSchema).min(2).max(5),
  }),
]);
export type DareSqlCompetition = z.infer<typeof DareSqlCompetitionSchema>;

const DareRankGoalSchema = z.discriminatedUnion("kind", [
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

const DareImprovementWindowSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("last_games"),
    count: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("last_days"),
    days: z.number().int().min(1).max(90),
  }),
]);

const DareImprovementGoalSchema = z.discriminatedUnion("kind", [
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

export const DareActivationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("immediate") }),
  z.strictObject({
    kind: z.literal("rank"),
    queue: RankedQueueTypeSchema.extract(["solo", "flex"]),
    goal: DareRankGoalSchema,
  }),
  z.strictObject({
    kind: z.literal("improvement"),
    targetKey: z.string().regex(/^T[1-5]$/u),
    gameSet: z.string().regex(/^[a-z_]\w*$/u),
    projection: z.string().regex(/^[a-z_]\w*$/u),
    aggregation: z.enum(["average", "maximum", "minimum"]),
    direction: z.enum(["higher", "lower"]),
    window: DareImprovementWindowSchema,
    goal: DareImprovementGoalSchema,
  }),
]);
export type DareActivation = z.infer<typeof DareActivationSchema>;

const DareActivationTargetSnapshotSchema = z.discriminatedUnion("kind", [
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

export const DareActivationSnapshotSchema = z.strictObject({
  version: z.literal(1),
  activatedAt: z.iso.datetime(),
  targets: z.array(DareActivationTargetSnapshotSchema).min(1).max(5),
});
export type DareActivationSnapshot = z.infer<
  typeof DareActivationSnapshotSchema
>;

export const DareSqlFactsSchema = z.strictObject({
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

export const DareSqlResultStructureSchema = z.strictObject({
  gameSets: z.array(
    z.strictObject({
      name: z.string().regex(/^[a-z_]\w*$/u),
      projectionColumns: z.array(z.string().regex(/^[a-z_]\w*$/u)),
      targetDependencies: z.array(z.string().regex(/^T[1-5]$/u)),
    }),
  ),
});

export const DareSqlCompilationSchema = z.strictObject({
  compilerVersion: z.literal(DARE_SQL_COMPILER_VERSION),
  canonicalSql: z.string().min(1).max(16_000),
  immutableAst: z.string().min(1),
  queryHash: z.string().regex(/^[a-f\d]{64}$/u),
  maxEligibleGames: z.number().int().positive().max(DARE_MAX_ELIGIBLE_GAMES),
  facts: DareSqlFactsSchema,
  resultStructure: DareSqlResultStructureSchema,
  finality: z.enum(["monotone_true", "deadline_only"]),
  competition: DareSqlCompetitionSchema.default({ kind: "standard" }),
  activation: DareActivationSchema.default({ kind: "immediate" }),
});
export type DareSqlCompilation = z.infer<typeof DareSqlCompilationSchema>;

export const DareContractSchema = z
  .strictObject({
    version: z.literal(DARE_CONTRACT_VERSION),
    canonicalSql: z.string().min(1).max(16_000),
    immutableAst: z.string().min(1),
    queryHash: z.string().regex(/^[a-f\d]{64}$/u),
    maxEligibleGames: z.number().int().positive().max(DARE_MAX_ELIGIBLE_GAMES),
    compilerVersion: z.literal(DARE_SQL_COMPILER_VERSION),
    evaluatorVersion: z.literal(DARE_SQL_EVALUATOR_VERSION),
    finality: z.enum(["monotone_true", "deadline_only"]),
    facts: DareSqlFactsSchema,
    resultStructure: DareSqlResultStructureSchema,
    competition: DareSqlCompetitionSchema.default({ kind: "standard" }),
    activation: DareActivationSchema.default({ kind: "immediate" }),
    activationSnapshot: DareActivationSnapshotSchema.nullable().default(null),
    originalText: z.string().min(1),
    plainLanguage: z.string().min(1),
  })
  .extend(DareContractRuntimeSchema.shape);
export type DareContract = z.infer<typeof DareContractSchema>;

export const DareSqlEvidenceSchema = z.strictObject({
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
export type DareSqlEvidence = z.infer<typeof DareSqlEvidenceSchema>;
