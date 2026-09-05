import { z } from "zod";
import { BucksStakeSchema } from "#src/model/bryan-bucks.ts";
import { QueueTypeSchema } from "#src/model/state.ts";
import { dareGameSetDomainIssuesV2 } from "#src/model/dare-domains.ts";
import {
  DareParticipantRateFieldV2Schema,
  DareParticipantValueFieldV2Schema,
  type DareBooleanExpressionV2,
  type DareValueV2,
} from "#src/model/dare-expression-v2.ts";

export const DARE_CONTRACT_VERSION = 2;
export const DARE_SCOUTQL_COMPILER_VERSIONS = [
  "dare-scoutql-1",
  "dare-scoutql-2",
] as const;
export const DARE_EVALUATOR_V2_VERSIONS = ["dare-evaluator-2"] as const;
export const DARE_SCOUTQL_COMPILER_VERSION = "dare-scoutql-2" as const;
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
export const OPEN_BUCKS_DARE_V2_STATES = [
  "pending_accept",
  "activating",
  "active",
] as const;

export const BucksDareV2StateSchema = z.enum([
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

export const DareComparisonOperatorV2Schema = z.enum([
  "eq",
  "neq",
  "gte",
  "lte",
  "gt",
  "lt",
]);

export const DareResultOperatorV2Schema = z.enum([
  "eq",
  "gte",
  "lte",
  "gt",
  "lt",
]);

export const DareAggregateFunctionV2Schema = z.enum([
  "sum",
  "average",
  "minimum",
  "maximum",
]);

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
      field: DareParticipantRateFieldV2Schema,
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
      // A bounded string, not the `DARE_TIMELINE_EVENT_TYPES` enum, because this
      // schema is shared by `DareStoredPlanV2Schema`: an enum here would make a
      // dare funded against an event type we later dropped — or one Riot renames
      // — unreadable in settlement, callouts, and progress views, stranding real
      // money. The allowlist is enforced in `DareCompiledPlanV2Schema`'s
      // refinement instead, exactly like every other value domain.
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

export const DareBooleanExpressionV2Schema: z.ZodType<DareBooleanExpressionV2> =
  z.lazy(() =>
    z.union([
      z.strictObject({
        kind: z.literal("comparison"),
        value: DareValueV2Schema,
        operator: DareComparisonOperatorV2Schema,
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
        operator: DareResultOperatorV2Schema,
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
        function: DareAggregateFunctionV2Schema,
        operator: DareResultOperatorV2Schema,
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

type DarePlanComplexityV2 = {
  predicates: number;
  maxDepth: number;
};

function dareValueDepth(value: DareValueV2): number {
  return value.kind === "arithmetic"
    ? 1 + Math.max(dareValueDepth(value.left), dareValueDepth(value.right))
    : 1;
}

function dareValueNeedsTimeline(value: DareValueV2): boolean {
  if (value.kind === "timeline_event_count") return true;
  return (
    value.kind === "arithmetic" &&
    (dareValueNeedsTimeline(value.left) || dareValueNeedsTimeline(value.right))
  );
}

function dareValueRelatedRelationCount(value: DareValueV2): number {
  if (value.kind === "related_participant_count") return 1;
  return value.kind === "arithmetic"
    ? dareValueRelatedRelationCount(value.left) +
        dareValueRelatedRelationCount(value.right)
    : 0;
}

function inspectDareBooleanComplexity(
  expression: DareBooleanExpressionV2,
  depth: number,
  facts: DarePlanComplexityV2,
): void {
  facts.maxDepth = Math.max(facts.maxDepth, depth);
  if (expression.kind === "comparison") {
    facts.predicates += 1;
    facts.maxDepth = Math.max(
      facts.maxDepth,
      depth + dareValueDepth(expression.value),
    );
    return;
  }
  if (expression.kind === "not") {
    inspectDareBooleanComplexity(expression.operand, depth + 1, facts);
    return;
  }
  for (const operand of expression.operands) {
    inspectDareBooleanComplexity(operand, depth + 1, facts);
  }
}

function inspectDareResultComplexity(
  expression: DareResultExpressionV2,
  depth: number,
  facts: DarePlanComplexityV2,
): void {
  facts.maxDepth = Math.max(facts.maxDepth, depth);
  if (expression.kind === "matching_games" || expression.kind === "aggregate") {
    facts.predicates += 1;
    return;
  }
  if (expression.kind === "not") {
    inspectDareResultComplexity(expression.operand, depth + 1, facts);
    return;
  }
  for (const operand of expression.operands) {
    inspectDareResultComplexity(operand, depth + 1, facts);
  }
}

function dareGameSetValues(gameSet: DareGameSetV2): DareValueV2[] {
  const values = gameSet.projections.map((projection) => projection.value);
  const collectValues = (expression: DareBooleanExpressionV2): void => {
    if (expression.kind === "comparison") {
      values.push(expression.value);
      return;
    }
    if (expression.kind === "not") {
      collectValues(expression.operand);
      return;
    }
    for (const operand of expression.operands) collectValues(operand);
  };
  collectValues(gameSet.predicate);
  return values;
}

function dareGameSetJoinedRelations(gameSet: DareGameSetV2): number {
  const values = dareGameSetValues(gameSet);
  const timelineRelations = values.some((value) =>
    dareValueNeedsTimeline(value),
  )
    ? 2
    : 0;
  const relatedRelations = values.reduce(
    (count, value) => count + dareValueRelatedRelationCount(value),
    0,
  );
  return gameSet.targetKeys.length + timelineRelations + relatedRelations;
}

/**
 * A compiled plan as it is *stored*: shape, references, and complexity limits,
 * but no value-domain check.
 *
 * Reading a frozen plan and authoring a new one are different questions. A
 * revision written before a domain rule existed is still exactly what its
 * participants agreed to, and its callout, progress view, and settlement must
 * keep rendering it faithfully — so the domain rule, which only ever applies to
 * a value someone is choosing right now, lives on `DareCompiledPlanV2Schema`
 * below. Tightening the authoring schema must never retroactively make an
 * already-funded dare unreadable.
 */
export const DareStoredPlanV2Schema = z
  .strictObject({
    version: z.literal(DARE_CONTRACT_VERSION),
    gameSets: z.array(DareGameSetV2Schema).min(1).max(DARE_V2_MAX_GAME_SETS),
    result: DareResultExpressionV2Schema,
    maxEligibleGames: z.number().int().min(1).max(DARE_V2_MAX_ELIGIBLE_GAMES),
  })
  .superRefine((plan, context) => {
    const facts: DarePlanComplexityV2 = { predicates: 0, maxDepth: 0 };
    for (const [index, gameSet] of plan.gameSets.entries()) {
      inspectDareBooleanComplexity(gameSet.predicate, 1, facts);
      if (dareGameSetJoinedRelations(gameSet) > DARE_V2_MAX_JOINED_RELATIONS) {
        context.addIssue({
          code: "custom",
          message: `A game set may join at most ${DARE_V2_MAX_JOINED_RELATIONS.toString()} relations.`,
          path: ["gameSets", index],
        });
      }
    }
    inspectDareResultComplexity(plan.result, 1, facts);
    if (facts.predicates > DARE_V2_MAX_PREDICATES) {
      context.addIssue({
        code: "custom",
        message: `A dare may contain at most ${DARE_V2_MAX_PREDICATES.toString()} predicates.`,
      });
    }
    if (facts.maxDepth > DARE_V2_MAX_EXPRESSION_DEPTH) {
      context.addIssue({
        code: "custom",
        message: `A dare expression may be at most ${DARE_V2_MAX_EXPRESSION_DEPTH.toString()} levels deep.`,
      });
    }
  });

/**
 * A compiled plan being authored. Everything `DareStoredPlanV2Schema` checks,
 * plus the value domains: a threshold naming a lane, champion, or queue that
 * does not exist produces a predicate no game can satisfy, which would settle as
 * a real loss rather than an error.
 */
export const DareCompiledPlanV2Schema = DareStoredPlanV2Schema.superRefine(
  (plan, context) => {
    for (const [index, gameSet] of plan.gameSets.entries()) {
      for (const message of dareGameSetDomainIssuesV2(gameSet)) {
        context.addIssue({
          code: "custom",
          message,
          path: ["gameSets", index],
        });
      }
    }
  },
);
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

export const DareRelationalContractRuntimeSchema = z.strictObject({
  targets: z.array(DareTargetBindingV2Schema).min(1).max(DARE_V2_MAX_TARGETS),
  openingStake: BucksStakeSchema,
  serverId: z.string().min(1),
  channelId: z.string().min(1),
  revision: z.number().int().positive(),
  activationAt: z.iso.datetime(),
  deadlineAt: z.iso.datetime(),
  deadlineSpec: DareDeadlineSpecV2Schema,
});

const DareContractV2BaseSchema = z
  .strictObject({
    version: z.literal(DARE_CONTRACT_VERSION),
    canonicalScoutQl: z.string().min(1).max(DARE_V2_MAX_QUERY_LENGTH),
    compiledPlan: DareStoredPlanV2Schema,
    evaluatorVersion: DareEvaluatorV2VersionSchema,
    plainLanguage: z.string().min(1),
    semanticProofPlan: z.string().min(1),
  })
  .extend(DareRelationalContractRuntimeSchema.shape);

export const DareContractV2Schema = z.union([
  DareContractV2BaseSchema.extend({
    compilerVersion: z.literal("dare-scoutql-1"),
  }),
  DareContractV2BaseSchema.extend({
    compilerVersion: z.literal("dare-scoutql-2"),
  }),
  DareContractV2BaseSchema.extend({
    compilerVersion: z.literal("dare-scoutql-2"),
    scoutQlImmutableAst: z.string().min(1),
    scoutQlPlanHash: z.string().regex(/^[a-f\d]{64}$/),
  }),
]);
export type DareContractV2 = z.infer<typeof DareContractV2Schema>;
