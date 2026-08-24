import { z } from "zod";
import { LeaguePuuidSchema } from "@scout-for-lol/data";

export const WEEKLY_PARLAY_SCHEMA_VERSION = 1;
export const WEEKLY_PARLAY_CATALOG_VERSION = "2026-08-23";
export const WEEKLY_PARLAY_EVALUATOR_VERSION = "1";
export const WEEKLY_PARLAY_PRICING_VERSION = "1";
export const WEEKLY_PARLAY_MIN_LEGS = 3;
export const WEEKLY_PARLAY_MAX_LEGS = 5;
export const WEEKLY_PARLAY_MIN_HISTORY_WINDOWS = 15;
export const WEEKLY_PARLAY_HISTORY_WINDOW_COUNT = 52;
export const WEEKLY_PARLAY_FEATURE_COOLDOWN_PERIODS = 4;
export const WEEKLY_PARLAY_MIN_RECENT_GAMES = 3;
export const WEEKLY_PARLAY_MIN_YES_PROBABILITY_BPS = 4000;
export const WEEKLY_PARLAY_MAX_YES_PROBABILITY_BPS = 6000;
export const WEEKLY_PARLAY_TARGET_YES_PROBABILITY_BPS = 5000;

export const WEEKLY_PARLAY_ELIGIBLE_QUEUES = [
  "solo",
  "flex",
  "ranked 5s",
] as const;
export const WeeklyParlayEligibleQueueSchema = z.enum(
  WEEKLY_PARLAY_ELIGIBLE_QUEUES,
);

export const WeeklyParlayRoleSchema = z.enum([
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
]);

export const WeeklyParlaySubjectKeySchema = z.string().regex(/^P[1-5]$/u);
export const WeeklyParlayFrozenAccountSchema = z.strictObject({
  puuid: LeaguePuuidSchema,
  trackingStartedAt: z.iso.datetime(),
});
export const WeeklyParlaySubjectSchema = z.strictObject({
  key: WeeklyParlaySubjectKeySchema,
  playerId: z.number().int().positive(),
  alias: z.string().min(1).max(100),
  discordId: z.string().min(1),
  accounts: z.array(WeeklyParlayFrozenAccountSchema).min(1),
});
export const WeeklyParlaySubjectsSchema = z
  .array(WeeklyParlaySubjectSchema)
  .min(1)
  .max(5);
export type WeeklyParlaySubject = z.infer<typeof WeeklyParlaySubjectSchema>;

export const WeeklyParlayAggregateMetricSchema = z.enum([
  "games",
  "wins",
  "kills",
  "deaths",
  "assists",
  "champion_damage",
  "creep_score",
  "gold",
  "vision_score",
  "time_played",
  "distinct_champions",
  "distinct_roles",
  "longest_win_streak",
  "best_game_kills",
  "best_game_assists",
  "best_game_damage",
]);
export const WeeklyParlayRateMetricSchema = z.enum([
  "win_rate_bps",
  "average_kills_x100",
  "average_deaths_x100",
  "average_assists_x100",
  "average_kda_x100",
  "average_champion_damage",
  "average_vision_score_x100",
]);
export const WeeklyParlayNumericOperatorSchema = z.enum(["gte", "lte", "eq"]);

const WeeklyParlayAggregateShapeSchema = z.strictObject({
  kind: z.literal("aggregate"),
  subject: WeeklyParlaySubjectKeySchema,
  metric: WeeklyParlayAggregateMetricSchema,
  operator: WeeklyParlayNumericOperatorSchema,
});
const WeeklyParlayRateShapeSchema = z.strictObject({
  kind: z.literal("rate"),
  subject: WeeklyParlaySubjectKeySchema,
  metric: WeeklyParlayRateMetricSchema,
  operator: WeeklyParlayNumericOperatorSchema,
});
const WeeklyParlayChampionShapeSchema = z.strictObject({
  kind: z.literal("champion_games"),
  subject: WeeklyParlaySubjectKeySchema,
  champion: z.string().min(1).max(50),
  winsOnly: z.boolean(),
  operator: WeeklyParlayNumericOperatorSchema,
});
const WeeklyParlayRoleShapeSchema = z.strictObject({
  kind: z.literal("role_games"),
  subject: WeeklyParlaySubjectKeySchema,
  role: WeeklyParlayRoleSchema,
  winsOnly: z.boolean(),
  operator: WeeklyParlayNumericOperatorSchema,
});
export const WeeklyParlayLegShapeSchema = z.discriminatedUnion("kind", [
  WeeklyParlayAggregateShapeSchema,
  WeeklyParlayRateShapeSchema,
  WeeklyParlayChampionShapeSchema,
  WeeklyParlayRoleShapeSchema,
]);
export type WeeklyParlayLegShape = z.infer<typeof WeeklyParlayLegShapeSchema>;

function weeklyParlayLegTargetKey(leg: WeeklyParlayLegShape): string {
  switch (leg.kind) {
    case "aggregate":
    case "rate":
      return `${leg.subject}:${leg.kind}:${leg.metric}`;
    case "champion_games":
      return `${leg.subject}:${leg.kind}:${leg.champion}:${String(leg.winsOnly)}`;
    case "role_games":
      return `${leg.subject}:${leg.kind}:${leg.role}:${String(leg.winsOnly)}`;
  }
}

function rejectDuplicateLegTargets(
  legs: readonly WeeklyParlayLegShape[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, leg] of legs.entries()) {
    const key = weeklyParlayLegTargetKey(leg);
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `Duplicate weekly parlay target ${key}.`,
      });
    }
    seen.add(key);
  }
}

export const WeeklyParlayProposalSchema = z.strictObject({
  version: z.literal(WEEKLY_PARLAY_SCHEMA_VERSION),
  legs: z
    .array(WeeklyParlayLegShapeSchema)
    .min(WEEKLY_PARLAY_MIN_LEGS)
    .max(WEEKLY_PARLAY_MAX_LEGS)
    .superRefine(rejectDuplicateLegTargets),
});
export type WeeklyParlayProposal = z.infer<typeof WeeklyParlayProposalSchema>;

export const WeeklyParlayLegSchema = z
  .discriminatedUnion("kind", [
    WeeklyParlayAggregateShapeSchema.extend({
      threshold: z.number().int().nonnegative(),
    }),
    WeeklyParlayRateShapeSchema.extend({
      threshold: z.number().int().nonnegative(),
    }),
    WeeklyParlayChampionShapeSchema.extend({
      threshold: z.number().int().nonnegative(),
    }),
    WeeklyParlayRoleShapeSchema.extend({
      threshold: z.number().int().nonnegative(),
    }),
  ])
  .superRefine((leg, context) => {
    if (
      leg.kind === "aggregate" &&
      leg.metric === "games" &&
      leg.operator === "gte" &&
      leg.threshold === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["threshold"],
        message: "A participation threshold must require at least one game.",
      });
    }
  });
export type WeeklyParlayLeg = z.infer<typeof WeeklyParlayLegSchema>;
export const WeeklyParlayDefinitionCriteriaSchema = z.strictObject({
  version: z.literal(WEEKLY_PARLAY_SCHEMA_VERSION),
  legs: z
    .array(WeeklyParlayLegSchema)
    .min(WEEKLY_PARLAY_MIN_LEGS)
    .max(WEEKLY_PARLAY_MAX_LEGS)
    .superRefine(rejectDuplicateLegTargets),
});
export type WeeklyParlayDefinitionCriteria = z.infer<
  typeof WeeklyParlayDefinitionCriteriaSchema
>;

export const WeeklyParlayContributionSnapshotSchema = z.strictObject({
  subject: WeeklyParlaySubjectKeySchema,
  puuid: LeaguePuuidSchema,
  queue: WeeklyParlayEligibleQueueSchema,
  completedAt: z.iso.datetime(),
  win: z.boolean(),
  champion: z.string().min(1).max(50),
  role: WeeklyParlayRoleSchema,
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  championDamage: z.number().int().nonnegative(),
  creepScore: z.number().int().nonnegative(),
  gold: z.number().int().nonnegative(),
  visionScore: z.number().int().nonnegative(),
  timePlayed: z.number().int().nonnegative(),
});
export type WeeklyParlayContributionSnapshot = z.infer<
  typeof WeeklyParlayContributionSnapshotSchema
>;

export function validateWeeklyParlayProposal(input: {
  proposal: WeeklyParlayProposal;
  subjects: readonly WeeklyParlaySubject[];
  observedChampions: ReadonlyMap<string, ReadonlySet<string>>;
  observedRoles: ReadonlyMap<string, ReadonlySet<string>>;
}): string[] {
  const issues: string[] = [];
  const subjectKeys = new Set(input.subjects.map((subject) => subject.key));
  for (const subject of input.subjects) {
    const subjectLegs = input.proposal.legs.filter(
      (leg) => leg.subject === subject.key,
    );
    if (subjectLegs.length === 0) {
      issues.push(`Subject ${subject.key} has no leg.`);
    }
    if (
      !subjectLegs.some(
        (leg) =>
          leg.kind === "aggregate" &&
          leg.metric === "games" &&
          leg.operator === "gte",
      )
    ) {
      issues.push(
        `Subject ${subject.key} needs a visible games participation leg.`,
      );
    }
  }
  for (const leg of input.proposal.legs) {
    if (!subjectKeys.has(leg.subject)) {
      issues.push(`Leg references unknown subject ${leg.subject}.`);
    }
    if (
      leg.kind === "champion_games" &&
      input.observedChampions.get(leg.subject)?.has(leg.champion) !== true
    ) {
      issues.push(
        `${leg.champion} was not historically observed for ${leg.subject}.`,
      );
    }
    if (
      leg.kind === "role_games" &&
      input.observedRoles.get(leg.subject)?.has(leg.role) !== true
    ) {
      issues.push(
        `${leg.role} was not historically observed for ${leg.subject}.`,
      );
    }
  }
  return issues;
}
