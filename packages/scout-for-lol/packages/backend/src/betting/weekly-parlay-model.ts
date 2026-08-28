import { generateValidatedObject } from "@shepherdjerred/llm-runtime";
import { z } from "zod";
import {
  PARLAY_INITIAL_OUTPUT_TOKENS,
  PARLAY_RETRY_OUTPUT_TOKENS,
} from "#src/betting/constants.ts";
import {
  WEEKLY_PARLAY_PROPOSAL_COUNT,
  WEEKLY_PARLAY_SCHEMA_VERSION,
  WeeklyParlayAggregateMetricSchema,
  WeeklyParlayChampionPeakMetricSchema,
  WeeklyParlayProposalSchema,
  WeeklyParlayRateMetricSchema,
  WeeklyParlaySubjectKeySchema,
  validateWeeklyParlayProposal,
  type WeeklyParlayProposal,
  type WeeklyParlaySubject,
} from "#src/betting/weekly-parlay-criteria.ts";
import type { WeeklyParlayChampionSummary } from "#src/betting/weekly-parlay-history.ts";
import { bettingParlayAiModel } from "#src/config/dynamic.ts";
import { getOpenRouterRuntime } from "#src/league/review/ai-clients.ts";
import { withLlmSubjectSpan } from "@shepherdjerred/llm-observability/subject";

export const WEEKLY_PARLAY_PROMPT_VERSION = "2";

const ModelWeeklyLegSchema = z.strictObject({
  kind: z.enum(["aggregate", "rate", "champion_games", "champion_peak"]),
  subject: WeeklyParlaySubjectKeySchema,
  aggregateMetric: WeeklyParlayAggregateMetricSchema.nullable(),
  rateMetric: WeeklyParlayRateMetricSchema.nullable(),
  championPeakMetric: WeeklyParlayChampionPeakMetricSchema.nullable(),
  champion: z.string().min(1).max(50).nullable(),
  winsOnly: z.boolean().nullable(),
  operator: z.enum(["gte", "lte", "eq"]),
});
const ModelWeeklyProposalSchema = z.strictObject({
  version: z.literal(WEEKLY_PARLAY_SCHEMA_VERSION),
  legs: z.array(ModelWeeklyLegSchema).min(3).max(5),
});

function canonicalProposalInput(
  model: z.infer<typeof ModelWeeklyProposalSchema>,
) {
  return {
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
        case "champion_peak":
          return {
            kind: leg.kind,
            subject: leg.subject,
            champion: leg.champion,
            metric: leg.championPeakMetric,
            operator: leg.operator,
          };
      }
    }),
  };
}

function proposalShapeKey(proposal: WeeklyParlayProposal): string {
  return JSON.stringify(
    proposal.legs
      .map((leg) => JSON.stringify(leg))
      .toSorted((left, right) => left.localeCompare(right)),
  );
}

const ModelWeeklyProposalsSchema = z
  .strictObject({
    version: z.literal(WEEKLY_PARLAY_SCHEMA_VERSION),
    proposals: z
      .array(ModelWeeklyProposalSchema)
      .length(WEEKLY_PARLAY_PROPOSAL_COUNT),
  })
  .superRefine((output, context) => {
    const seen = new Set<string>();
    for (const [index, proposal] of output.proposals.entries()) {
      const canonical = WeeklyParlayProposalSchema.safeParse(
        canonicalProposalInput(proposal),
      );
      if (!canonical.success) {
        context.addIssue({
          code: "custom",
          path: ["proposals", index],
          message: canonical.error.message,
        });
        continue;
      }
      const key = proposalShapeKey(canonical.data);
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["proposals", index],
          message: "Weekly parlay proposals must be distinct.",
        });
      }
      seen.add(key);
    }
  });

function modelWeeklyProposalsSchema(input: {
  subjects: readonly WeeklyParlaySubject[];
  championShortlists: ReadonlyMap<
    string,
    readonly WeeklyParlayChampionSummary[]
  >;
}) {
  const eligibleChampions = new Map(
    input.subjects.map((subject) => [
      subject.key,
      new Set(
        (input.championShortlists.get(subject.key) ?? []).map(
          (summary) => summary.champion,
        ),
      ),
    ]),
  );
  return ModelWeeklyProposalsSchema.superRefine((output, context) => {
    for (const [index, proposal] of output.proposals.entries()) {
      const canonical = WeeklyParlayProposalSchema.safeParse(
        canonicalProposalInput(proposal),
      );
      if (!canonical.success) {
        continue;
      }
      for (const issue of validateWeeklyParlayProposal({
        proposal: canonical.data,
        subjects: input.subjects,
        eligibleChampions,
      })) {
        context.addIssue({
          code: "custom",
          path: ["proposals", index],
          message: issue,
        });
      }
    }
  });
}

function canonicalProposal(
  model: z.infer<typeof ModelWeeklyProposalSchema>,
): WeeklyParlayProposal {
  const proposal = WeeklyParlayProposalSchema.parse(
    canonicalProposalInput(model),
  );
  return {
    ...proposal,
    legs: proposal.legs.toSorted((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    ),
  };
}

export async function generateWeeklyParlayProposals(input: {
  periodKey: string;
  subjects: readonly WeeklyParlaySubject[];
  championShortlists: ReadonlyMap<
    string,
    readonly WeeklyParlayChampionSummary[]
  >;
  historyWindows: number;
  abortSignal?: AbortSignal;
}): Promise<{
  proposals: WeeklyParlayProposal[];
  model: string;
  resolvedModel: string | null;
  usage: unknown;
}> {
  // Periodic, fleet-wide work with no requester and no owning guild.
  return await withLlmSubjectSpan(
    "scout.betting.weekly-parlay",
    { kind: "system", id: "scout.betting.weekly-parlay" },
    () => generateWeeklyParlayProposalsInternal(input),
  );
}

async function generateWeeklyParlayProposalsInternal(input: {
  periodKey: string;
  subjects: readonly WeeklyParlaySubject[];
  championShortlists: ReadonlyMap<
    string,
    readonly WeeklyParlayChampionSummary[]
  >;
  historyWindows: number;
  abortSignal?: AbortSignal;
}): Promise<{
  proposals: WeeklyParlayProposal[];
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
  const OutputSchema = modelWeeklyProposalsSchema(input);
  const result = await generateValidatedObject(runtime, {
    model,
    schema: OutputSchema,
    schemaName: "bryan_bucks_weekly_parlay_proposals",
    schemaDescription:
      "Exactly five distinct weekly AND proposals from Scout's closed interesting catalog, with no thresholds or odds.",
    system:
      "Choose five distinct, coherent, challenging weekly League of Legends parlays. Use only the schema. " +
      "Every proposal must include every subject and at least one champion_peak leg. " +
      "Use only champions in that subject's shortlist. Champion games always means winsOnly true and gte. " +
      "Champion peak always means gte. Never invent thresholds, odds, fields, paths, expressions, participation legs, or settlement logic.",
    prompt: JSON.stringify({
      periodKey: input.periodKey,
      subjects: input.subjects.map((subject) => ({
        key: subject.key,
        alias: subject.alias,
        championShortlist: input.championShortlists.get(subject.key) ?? [],
      })),
      fullyObservedHistoryWindows: input.historyWindows,
      settlementQualification: {
        minimumEligibleGamesPerSubject: 3,
        note: "Qualification is not a displayed betting leg.",
      },
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
  const parsed = OutputSchema.parse(result.object);
  const proposals = parsed.proposals.map((proposal) =>
    canonicalProposal(proposal),
  );
  if (
    new Set(proposals.map((proposal) => proposalShapeKey(proposal))).size !==
    WEEKLY_PARLAY_PROPOSAL_COUNT
  ) {
    throw new Error("Weekly parlay proposals were not distinct after parsing.");
  }
  return {
    proposals,
    model,
    resolvedModel: result.metadata.at(-1)?.resolvedModel ?? null,
    usage: result.usage,
  };
}
