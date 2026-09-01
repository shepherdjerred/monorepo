import { z } from "zod";
import { QueueTypeSchema } from "#src/model/state.ts";

export const DARE_CONTRACT_VERSION = 2;
export const DARE_SCOUTQL_COMPILER_VERSIONS = ["dare-scoutql-1"] as const;
export const DARE_EVALUATOR_V2_VERSIONS = ["dare-evaluator-2"] as const;
export const DARE_SCOUTQL_COMPILER_VERSION = DARE_SCOUTQL_COMPILER_VERSIONS[0];
export const DARE_EVALUATOR_V2_VERSION = DARE_EVALUATOR_V2_VERSIONS[0];
export const DareScoutQlCompilerVersionSchema = z.enum(
  DARE_SCOUTQL_COMPILER_VERSIONS,
);
export const DareEvaluatorV2VersionSchema = z.enum(DARE_EVALUATOR_V2_VERSIONS);
export const DARE_V2_MAX_TARGETS = 5;
export const DARE_V2_MAX_GAME_SETS = 20;
export const DARE_V2_MAX_JOINED_RELATIONS = 8;
export const DARE_V2_MAX_PREDICATES = 60;
export const DARE_V2_MAX_EXPRESSION_DEPTH = 12;
export const DARE_V2_MAX_QUERY_LENGTH = 16_000;
export const DARE_V2_MAX_ELIGIBLE_GAMES = 100;
export const DARE_V2_MAX_HORIZON_DAYS = 90;
export const OPEN_BUCKS_DARE_V2_STATES = ["pending_accept", "active"] as const;

export const BucksDareV2StateSchema = z.enum([
  "draft",
  "pending_accept",
  "active",
  "achieved",
  "unachieved",
  "declined",
  "expired",
  "voided",
  "cancelled",
  "deleted",
]);
export type BucksDareV2State = z.infer<typeof BucksDareV2StateSchema>;

export const DareTargetBindingV2Schema = z.strictObject({
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
export type DareTargetBindingV2 = z.infer<typeof DareTargetBindingV2Schema>;

export const DareParticipantValueFieldV2Schema = z.enum([
  "champion_name",
  "team_position",
  "team_id",
  "win",
  "kills",
  "deaths",
  "assists",
  "creep_score",
  "gold_earned",
  "vision_score",
  "time_played",
  "total_damage_dealt_to_champions",
  "wards_placed",
  "wards_killed",
  "double_kills",
  "triple_kills",
  "quadra_kills",
  "penta_kills",
]);

export type DareValueV2 =
  | {
      kind: "participant";
      target: string;
      field: z.infer<typeof DareParticipantValueFieldV2Schema>;
    }
  | {
      kind: "participant_rate";
      target: string;
      field: "cs_per_minute" | "damage_per_minute" | "kda";
    }
  | { kind: "game"; field: "duration_seconds" | "queue" }
  | {
      kind: "related_participant_count";
      target: string;
      relationship: "ally" | "opponent";
      championName: string | null;
    }
  | {
      kind: "timeline_event_count";
      eventType: string;
      target: string | null;
      role: "subject" | "killer" | "victim" | "assist" | "creator" | null;
      afterMs: number | null;
      beforeMs: number | null;
      itemId: number | null;
    }
  | {
      kind: "arithmetic";
      operator: "add" | "subtract" | "multiply" | "divide";
      left: DareValueV2;
      right: DareValueV2;
    };

// `z.union` deliberately emits JSON Schema `anyOf`. OpenAI rejects `oneOf`,
// which Zod emits for `discriminatedUnion`, for both structured responses and
// strict tool schemas. The literal `kind` fields retain the same runtime
// discrimination while keeping the model-facing schema portable.
export const DareValueV2Schema: z.ZodType<DareValueV2> = z.lazy(() =>
  z.union([
    z.strictObject({
      kind: z.literal("participant"),
      target: z.string().min(1),
      field: DareParticipantValueFieldV2Schema,
    }),
    z.strictObject({
      kind: z.literal("participant_rate"),
      target: z.string().min(1),
      field: z.enum(["cs_per_minute", "damage_per_minute", "kda"]),
    }),
    z.strictObject({
      kind: z.literal("game"),
      field: z.enum(["duration_seconds", "queue"]),
    }),
    z.strictObject({
      kind: z.literal("related_participant_count"),
      target: z.string().min(1),
      relationship: z.enum(["ally", "opponent"]),
      championName: z.string().min(1).nullable(),
    }),
    z.strictObject({
      kind: z.literal("timeline_event_count"),
      eventType: z.string().min(1).max(80),
      target: z.string().min(1).nullable(),
      role: z
        .enum(["subject", "killer", "victim", "assist", "creator"])
        .nullable(),
      afterMs: z.number().int().nonnegative().nullable(),
      beforeMs: z.number().int().nonnegative().nullable(),
      itemId: z.number().int().positive().nullable(),
    }),
    z.strictObject({
      kind: z.literal("arithmetic"),
      operator: z.enum(["add", "subtract", "multiply", "divide"]),
      left: DareValueV2Schema,
      right: DareValueV2Schema,
    }),
  ]),
);

export const DareProjectionV2Schema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  value: DareValueV2Schema,
});

export type DareBooleanExpressionV2 =
  | {
      kind: "comparison";
      value: DareValueV2;
      operator: "eq" | "neq" | "gte" | "lte" | "gt" | "lt";
      threshold: string | number | boolean;
    }
  | { kind: "and" | "or"; operands: DareBooleanExpressionV2[] }
  | { kind: "not"; operand: DareBooleanExpressionV2 };

export const DareBooleanExpressionV2Schema: z.ZodType<DareBooleanExpressionV2> =
  z.lazy(() =>
    z.union([
      z.strictObject({
        kind: z.literal("comparison"),
        value: DareValueV2Schema,
        operator: z.enum(["eq", "neq", "gte", "lte", "gt", "lt"]),
        threshold: z.union([z.string(), z.number(), z.boolean()]),
      }),
      z.strictObject({
        kind: z.literal("and"),
        operands: z.array(DareBooleanExpressionV2Schema).min(1),
      }),
      z.strictObject({
        kind: z.literal("or"),
        operands: z.array(DareBooleanExpressionV2Schema).min(1),
      }),
      z.strictObject({
        kind: z.literal("not"),
        operand: DareBooleanExpressionV2Schema,
      }),
    ]),
  );

export const DareGameSetV2Schema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  targetKeys: z.array(z.string().min(1)).min(1).max(DARE_V2_MAX_TARGETS),
  relationship: z.enum(["same_match", "same_team", "opponents", "independent"]),
  queues: z.array(QueueTypeSchema).min(1),
  predicate: DareBooleanExpressionV2Schema,
  projections: z.array(DareProjectionV2Schema).max(20),
  orderBy: z.literal("game_end_at_asc_match_id_asc"),
  limit: z.number().int().min(1).max(DARE_V2_MAX_ELIGIBLE_GAMES),
});
export type DareGameSetV2 = z.infer<typeof DareGameSetV2Schema>;

export type DareResultExpressionV2 =
  | {
      kind: "matching_games";
      gameSet: string;
      operator: "eq" | "gte" | "lte" | "gt" | "lt";
      threshold: number;
    }
  | {
      kind: "aggregate";
      gameSet: string;
      projection: string;
      function: "sum" | "average" | "minimum" | "maximum";
      operator: "eq" | "gte" | "lte" | "gt" | "lt";
      threshold: number;
    }
  | { kind: "and" | "or"; operands: DareResultExpressionV2[] }
  | { kind: "not"; operand: DareResultExpressionV2 };

export const DareResultExpressionV2Schema: z.ZodType<DareResultExpressionV2> =
  z.lazy(() =>
    z.union([
      z.strictObject({
        kind: z.literal("matching_games"),
        gameSet: z.string().min(1),
        operator: z.enum(["eq", "gte", "lte", "gt", "lt"]),
        threshold: z
          .number()
          .int()
          .nonnegative()
          .max(DARE_V2_MAX_ELIGIBLE_GAMES),
      }),
      z.strictObject({
        kind: z.literal("aggregate"),
        gameSet: z.string().min(1),
        projection: z.string().min(1),
        function: z.enum(["sum", "average", "minimum", "maximum"]),
        operator: z.enum(["eq", "gte", "lte", "gt", "lt"]),
        threshold: z.number(),
      }),
      z.strictObject({
        kind: z.literal("and"),
        operands: z.array(DareResultExpressionV2Schema).min(1),
      }),
      z.strictObject({
        kind: z.literal("or"),
        operands: z.array(DareResultExpressionV2Schema).min(1),
      }),
      z.strictObject({
        kind: z.literal("not"),
        operand: DareResultExpressionV2Schema,
      }),
    ]),
  );

export const DareCompiledPlanV2Schema = z.strictObject({
  version: z.literal(DARE_CONTRACT_VERSION),
  gameSets: z.array(DareGameSetV2Schema).min(1).max(DARE_V2_MAX_GAME_SETS),
  result: DareResultExpressionV2Schema,
  maxEligibleGames: z.number().int().min(1).max(DARE_V2_MAX_ELIGIBLE_GAMES),
});
export type DareCompiledPlanV2 = z.infer<typeof DareCompiledPlanV2Schema>;

export const DareDeadlineSpecV2Schema = z.union([
  z.strictObject({
    kind: z.literal("relative"),
    days: z.number().int().min(1).max(DARE_V2_MAX_HORIZON_DAYS),
  }),
  z.strictObject({
    kind: z.literal("absolute"),
    deadlineAt: z.iso.datetime(),
    timezone: z.string().min(1),
  }),
]);
export type DareDeadlineSpecV2 = z.infer<typeof DareDeadlineSpecV2Schema>;

export const DareContractV2Schema = z.strictObject({
  version: z.literal(DARE_CONTRACT_VERSION),
  canonicalScoutQl: z.string().min(1).max(DARE_V2_MAX_QUERY_LENGTH),
  compiledPlan: DareCompiledPlanV2Schema,
  compilerVersion: DareScoutQlCompilerVersionSchema,
  evaluatorVersion: DareEvaluatorV2VersionSchema,
  targets: z.array(DareTargetBindingV2Schema).min(1).max(DARE_V2_MAX_TARGETS),
  openingStake: z.number().int().positive(),
  serverId: z.string().min(1),
  channelId: z.string().min(1),
  revision: z.number().int().positive(),
  activationAt: z.iso.datetime(),
  deadlineAt: z.iso.datetime(),
  deadlineSpec: DareDeadlineSpecV2Schema,
  plainLanguage: z.string().min(1),
  semanticProofPlan: z.string().min(1),
});
export type DareContractV2 = z.infer<typeof DareContractV2Schema>;
