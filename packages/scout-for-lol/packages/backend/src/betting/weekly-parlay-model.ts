import { z } from "zod";
import { generateValidatedObject } from "@shepherdjerred/llm-runtime";
import { bettingParlayAiModel } from "#src/config/dynamic.ts";
import {
  PARLAY_INITIAL_OUTPUT_TOKENS,
  PARLAY_RETRY_OUTPUT_TOKENS,
} from "#src/betting/constants.ts";
import {
  WEEKLY_PARLAY_SCHEMA_VERSION,
  WeeklyParlayAggregateMetricSchema,
  WeeklyParlayProposalSchema,
  WeeklyParlayRateMetricSchema,
  WeeklyParlayRoleSchema,
  WeeklyParlaySubjectKeySchema,
  type WeeklyParlayProposal,
  type WeeklyParlaySubject,
} from "#src/betting/weekly-parlay-criteria.ts";
import { getOpenRouterRuntime } from "#src/league/review/ai-clients.ts";

export const WEEKLY_PARLAY_PROMPT_VERSION = "1";

const ModelWeeklyLegSchema = z.strictObject({
  kind: z.enum(["aggregate", "rate", "champion_games", "role_games"]),
  subject: WeeklyParlaySubjectKeySchema,
  aggregateMetric: WeeklyParlayAggregateMetricSchema.nullable(),
  rateMetric: WeeklyParlayRateMetricSchema.nullable(),
  champion: z.string().min(1).max(50).nullable(),
  role: WeeklyParlayRoleSchema.nullable(),
  winsOnly: z.boolean().nullable(),
  operator: z.enum(["gte", "lte", "eq"]),
});
const ModelWeeklyProposalSchema = z.strictObject({
  version: z.literal(WEEKLY_PARLAY_SCHEMA_VERSION),
  legs: z.array(ModelWeeklyLegSchema).min(3).max(5),
});

function canonicalProposal(
  model: z.infer<typeof ModelWeeklyProposalSchema>,
): WeeklyParlayProposal {
  return WeeklyParlayProposalSchema.parse({
    version: model.version,
    legs: model.legs.map((leg) => {
      switch (leg.kind) {
        case "aggregate":
          return {
            kind: leg.kind,
            subject: leg.subject,
            metric: leg.aggregateMetric,
            operator: leg.operator,
          };
        case "rate":
          return {
            kind: leg.kind,
            subject: leg.subject,
            metric: leg.rateMetric,
            operator: leg.operator,
          };
        case "champion_games":
          return {
            kind: leg.kind,
            subject: leg.subject,
            champion: leg.champion,
            winsOnly: leg.winsOnly,
            operator: leg.operator,
          };
        case "role_games":
          return {
            kind: leg.kind,
            subject: leg.subject,
            role: leg.role,
            winsOnly: leg.winsOnly,
            operator: leg.operator,
          };
      }
    }),
  });
}

export async function generateWeeklyParlayProposal(input: {
  periodKey: string;
  subjects: readonly WeeklyParlaySubject[];
  observedChampions: ReadonlyMap<string, ReadonlySet<string>>;
  observedRoles: ReadonlyMap<string, ReadonlySet<string>>;
  recentEligibleGames: ReadonlyMap<string, number>;
  historyWindows: number;
  abortSignal?: AbortSignal;
}): Promise<{
  proposal: WeeklyParlayProposal;
  model: string;
  resolvedModel: string | null;
  usage: unknown;
}> {
  const runtime = getOpenRouterRuntime();
  if (runtime === undefined) {
    throw new Error(
      "OPENROUTER_API_KEY is required for weekly parlay generation.",
    );
  }
  const model = bettingParlayAiModel();
  const result = await generateValidatedObject(runtime, {
    model,
    schema: ModelWeeklyProposalSchema,
    schemaName: "bryan_bucks_weekly_parlay_proposal",
    schemaDescription:
      "Three to five weekly AND legs from Scout's closed catalog, with no thresholds or odds.",
    system:
      "Choose a coherent, fun weekly League of Legends parlay. Use only the schema. " +
      "Include every subject and a games gte participation leg for every subject. " +
      "Never invent thresholds, odds, fields, paths, expressions, or settlement logic.",
    prompt: JSON.stringify({
      periodKey: input.periodKey,
      subjects: input.subjects.map((subject) => ({
        key: subject.key,
        alias: subject.alias,
        recentEligibleGames: input.recentEligibleGames.get(subject.key),
        historicallyObservedChampions: [
          ...(input.observedChampions.get(subject.key) ?? []),
        ].toSorted(),
        historicallyObservedRoles: [
          ...(input.observedRoles.get(subject.key) ?? []),
        ].toSorted(),
      })),
      fullyObservedHistoryWindows: input.historyWindows,
    }),
    workload: "scout.betting.weekly-parlay.generate",
    sessionId: `${input.periodKey}:${input.subjects.map((subject) => subject.playerId).join("-")}`,
    reasoningEffort: "medium",
    maxOutputTokens: PARLAY_INITIAL_OUTPUT_TOKENS,
    semanticRetryMaxOutputTokens: PARLAY_RETRY_OUTPUT_TOKENS,
    ...(input.abortSignal === undefined
      ? {}
      : { abortSignal: input.abortSignal }),
  });
  const parsed = ModelWeeklyProposalSchema.parse(result.object);
  return {
    proposal: canonicalProposal(parsed),
    model,
    resolvedModel: result.metadata.at(-1)?.resolvedModel ?? null,
    usage: result.usage,
  };
}
