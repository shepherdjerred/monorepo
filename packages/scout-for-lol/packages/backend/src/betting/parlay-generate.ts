import * as Sentry from "@sentry/bun";
import {
  StructuredOutputExhaustionError,
  StructuredOutputUsageError,
  generateValidatedObject,
} from "@shepherdjerred/llm-runtime";
import type {
  LoadingScreenData,
  PlayerConfigEntry,
  QueueType,
  RawCurrentGameInfo,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import {
  DEFAULT_PARLAY_AI_MODEL,
  PARLAY_GENERATION_DEADLINE_MS,
  PARLAY_INITIAL_OUTPUT_TOKENS,
  PARLAY_RETRY_OUTPUT_TOKENS,
} from "#src/betting/constants.ts";
import {
  PARLAY_CATALOG_VERSION,
  PARLAY_EVALUATOR_VERSION,
  PARLAY_SCHEMA_VERSION,
  selectParlayTeam,
  type ParlaySubject,
} from "#src/betting/parlay-criteria.ts";
import {
  generatedParlaySchemaFor,
  parlayProposalSchemaFor,
  parseModelGeneratedParlay,
  thresholdsMatchProposal,
} from "#src/betting/parlay-model-schema.ts";
import { fetchParlayHistory } from "#src/betting/parlay-history.ts";
import {
  MIN_PRICING_GAMES,
  priceParlay,
  type ParlayPrice,
} from "#src/betting/parlay-pricing.ts";
import {
  buildProposalStatistics,
  statLegsForProposal,
} from "#src/betting/parlay-stats.ts";
import {
  PARLAY_PROMPT_VERSION,
  buildParlayGenerationContext,
  buildParlayProposalPrompt,
  buildParlayThresholdPrompt,
  PARLAY_SYSTEM_PROMPT,
  type ParlayGenerationContext,
} from "#src/betting/parlay-prompt.ts";
import { buildRosterForButtons } from "#src/betting/prematch-subject.ts";
import { publishParlayDefinition } from "#src/betting/parlay-publish.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getOpenRouterRuntime } from "#src/league/review/ai-clients.ts";
import {
  assertWithinBudget,
  LlmBudgetExceeded,
  recordTokenUsage,
} from "#src/league/review/openai-budget.ts";
import {
  bettingParlayGenerationDurationSeconds,
  bettingParlayGenerationTotal,
  bettingParlayTokensTotal,
} from "#src/metrics/betting-parlay.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-parlay-generate");

type GenerationStatus =
  | "success"
  | "no_context"
  | "no_market"
  | "budget_refused"
  | "timeout"
  | "invalid_output"
  | "provider_error"
  | "persistence_error"
  | "unpriceable";

class ParlayPersistenceError extends Error {
  constructor(cause: unknown) {
    super("Could not persist the generated parlay definition", { cause });
    this.name = "ParlayPersistenceError";
  }
}

function recordGeneration(status: GenerationStatus, startedAt: number): void {
  bettingParlayGenerationTotal.inc({ status });
  bettingParlayGenerationDurationSeconds.observe(
    { status },
    (Date.now() - startedAt) / 1000,
  );
}

function chargeUsage(
  model: string,
  tokens: { input: number; output: number },
): void {
  bettingParlayTokensTotal.inc({ model, kind: "prompt" }, tokens.input);
  bettingParlayTokensTotal.inc({ model, kind: "completion" }, tokens.output);
  recordTokenUsage(tokens.input, tokens.output, model);
}

function timedOut(signal: AbortSignal, error: unknown): boolean {
  return (
    signal.aborted ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

export type StartParlayGenerationInput = {
  gameInfo: RawCurrentGameInfo;
  trackedPlayers: readonly PlayerConfigEntry[];
  queueType: QueueType | undefined;
  loadingScreenData: LoadingScreenData | undefined;
};

type GenerationReady = {
  kind: "ready";
  matchId: string;
  queueType: "solo" | "flex";
  selectedTeamId: number;
  subjects: readonly ParlaySubject[];
  opponentTrackedAliases: readonly string[];
  opponentTrackedPuuids: readonly string[];
  opponentPingsAvailable: boolean;
  context: ParlayGenerationContext;
};

type GenerationPreparation =
  | GenerationReady
  | { kind: "stop"; status: "no_context" | "no_market" | "timeout" };

async function prepareGeneration(
  input: StartParlayGenerationInput,
  prismaClient: ExtendedPrismaClient,
  deadline: AbortSignal,
): Promise<GenerationPreparation> {
  if (
    (input.queueType !== "solo" && input.queueType !== "flex") ||
    input.loadingScreenData?.layout !== "standard"
  ) {
    return { kind: "stop", status: "no_context" };
  }
  const matchId = `${input.gameInfo.platformId}_${input.gameInfo.gameId.toString()}`;
  const [existing, outcomePools] = await Promise.all([
    prismaClient.bucksParlayDefinition.findUnique({
      where: { matchId },
      select: { id: true },
    }),
    prismaClient.bucksMatchPool.findMany({
      where: { matchId, messageRefs: { not: "[]" } },
      select: { id: true },
    }),
  ]);
  if (existing !== null || outcomePools.length === 0) {
    return {
      kind: "stop",
      status: outcomePools.length === 0 ? "no_market" : "no_context",
    };
  }

  const aliasByPuuid = new Map<string, string>(
    input.trackedPlayers.map((player) => [
      player.league.leagueAccount.puuid.toString(),
      player.alias,
    ]),
  );
  const selected = selectParlayTeam(
    buildRosterForButtons(input.gameInfo, aliasByPuuid),
  );
  if (selected === undefined) {
    return { kind: "stop", status: "no_context" };
  }
  const context = await buildParlayGenerationContext({
    matchId,
    queue: input.queueType,
    loadingScreenData: input.loadingScreenData,
    selectedTeamId: selected.teamId,
    subjects: selected.subjects,
  });
  if (context === undefined || deadline.aborted) {
    return {
      kind: "stop",
      status: deadline.aborted ? "timeout" : "no_context",
    };
  }
  return {
    kind: "ready",
    matchId,
    queueType: input.queueType,
    selectedTeamId: selected.teamId,
    subjects: selected.subjects,
    opponentTrackedAliases: input.gameInfo.participants.flatMap(
      (participant) => {
        if (
          participant.teamId === selected.teamId ||
          participant.puuid === null
        ) {
          return [];
        }
        const alias = aliasByPuuid.get(participant.puuid);
        return alias === undefined ? [] : [alias];
      },
    ),
    opponentTrackedPuuids: input.gameInfo.participants.flatMap(
      (participant) => {
        if (
          participant.teamId === selected.teamId ||
          participant.puuid === null
        ) {
          return [];
        }
        return aliasByPuuid.has(participant.puuid) ? [participant.puuid] : [];
      },
    ),
    opponentPingsAvailable: input.gameInfo.participants
      .filter((participant) => participant.teamId !== selected.teamId)
      .every((participant) => participant.puuid !== null),
    context,
  };
}

class ParlayUnpriceableError extends Error {
  constructor(reason: string) {
    super(`Parlay could not be priced from history: ${reason}`);
    this.name = "ParlayUnpriceableError";
  }
}

async function generateAndPersistDefinition(
  setup: GenerationReady,
  startedAt: number,
  deadline: AbortSignal,
  prismaClient: ExtendedPrismaClient,
): Promise<number> {
  const runtime = getOpenRouterRuntime();
  if (runtime === undefined) {
    throw new Error("OPENROUTER_API_KEY is required for parlay generation");
  }
  const model = configuration.bettingParlayAiModel ?? DEFAULT_PARLAY_AI_MODEL;
  assertWithinBudget();

  const call = async (
    schema: Parameters<typeof generateValidatedObject>[1]["schema"],
    prompt: string,
    name: string,
  ) => {
    try {
      assertWithinBudget();
      const result = await generateValidatedObject(runtime, {
        model,
        schema,
        schemaName: name,
        schemaDescription:
          "A fixed-odds AND parlay built only from the supplied closed catalog.",
        system: PARLAY_SYSTEM_PROMPT,
        prompt,
        workload: "scout.betting.parlay.generate",
        sessionId: setup.matchId,
        abortSignal: deadline,
        reasoningEffort: "medium",
        maxOutputTokens: PARLAY_INITIAL_OUTPUT_TOKENS,
        semanticRetryMaxOutputTokens: PARLAY_RETRY_OUTPUT_TOKENS,
      });
      chargeUsage(model, result.usage.tokens);
      return result;
    } catch (error) {
      if (error instanceof StructuredOutputUsageError) {
        chargeUsage(model, error.usage.tokens);
      }
      throw error;
    }
  };

  // Pass one: which legs, no numbers.
  const proposed = await call(
    parlayProposalSchemaFor(setup.subjects),
    buildParlayProposalPrompt(setup.context, {
      opponentPingsAvailable: setup.opponentPingsAvailable,
    }),
    "bryan_bucks_parlay_proposal",
  );
  const proposal = parlayProposalSchemaFor(setup.subjects).parse(
    proposed.object,
  );
  if (
    !setup.opponentPingsAvailable &&
    proposal.conditions.some(
      (condition) => condition.kind === "opponent_team_pings",
    )
  ) {
    throw new ParlayUnpriceableError(
      "an opponent PUUID is unavailable, so opponent ping eligibility cannot be established",
    );
  }
  deadline.throwIfAborted();

  // The one history snapshot that both the thresholds and the price come from.
  const history = await fetchParlayHistory({
    puuids: setup.subjects.map((subject) => subject.puuid),
    excludeMatchId: setup.matchId,
    queue: setup.queueType,
  });
  if (
    setup.subjects.some(
      (subject) =>
        (history.get(subject.puuid) ?? []).length < MIN_PRICING_GAMES,
    )
  ) {
    throw new ParlayUnpriceableError(
      "history does not contain enough settled games for every subject",
    );
  }
  const legs = statLegsForProposal(proposal, setup.subjects);
  if (legs.length === 0) {
    throw new ParlayUnpriceableError("no proposed leg could be measured");
  }
  const statistics = await buildProposalStatistics({
    legs,
    history,
    queue: setup.queueType,
  });
  deadline.throwIfAborted();

  // Pass two: the numbers, against those distributions.
  const filled = await call(
    generatedParlaySchemaFor(setup.subjects),
    buildParlayThresholdPrompt({
      context: setup.context,
      proposal,
      statistics,
    }),
    "bryan_bucks_parlay",
  );
  const filledParlay = generatedParlaySchemaFor(setup.subjects).parse(
    filled.object,
  );
  if (!thresholdsMatchProposal(proposal, filledParlay)) {
    throw new ParlayUnpriceableError(
      "threshold pass changed the proposed legs",
    );
  }
  deadline.throwIfAborted();

  // The price is measured, never authored.
  const priced = priceParlay({
    conditions: parseModelGeneratedParlay(filledParlay, 5000).conditions,
    subjects: setup.subjects,
    history,
  });
  if (priced === undefined) {
    throw new ParlayUnpriceableError("history could not answer every leg");
  }
  const generatedParlay = parseModelGeneratedParlay(
    filledParlay,
    priced.yesProbabilityBps,
  );

  try {
    const definition = await prismaClient.bucksParlayDefinition.create({
      data: {
        matchId: setup.matchId,
        queueType: setup.queueType,
        selectedTeamId: setup.selectedTeamId,
        subjects: JSON.stringify(setup.subjects),
        criteria: JSON.stringify(generatedParlay),
        yesProbabilityBps: priced.yesProbabilityBps,
        promptVersion: PARLAY_PROMPT_VERSION,
        catalogVersion: PARLAY_CATALOG_VERSION,
        schemaVersion: PARLAY_SCHEMA_VERSION,
        evaluatorVersion: PARLAY_EVALUATOR_VERSION,
        generationContext: JSON.stringify({
          ...setup.context,
          opponentTrackedAliases: setup.opponentTrackedAliases,
          opponentTrackedPuuids: setup.opponentTrackedPuuids,
        }),
        proposal: JSON.stringify(proposal),
        pricing: JSON.stringify(pricingRecord(priced, legs.length)),
        requestedModel: model,
        resolvedModel: filled.metadata.at(-1)?.resolvedModel ?? null,
        usage: JSON.stringify({
          proposal: proposed.usage,
          thresholds: filled.usage,
        }),
        durationMs: Date.now() - startedAt,
      },
      select: { id: true },
    });
    return definition.id;
  } catch (error) {
    throw new ParlayPersistenceError(error);
  }
}

/** Frozen record of how a published price was reached. */
function pricingRecord(price: ParlayPrice, measuredLegs: number) {
  return {
    yesProbabilityBps: price.yesProbabilityBps,
    method: price.method,
    samples: price.samples,
    clamped: price.clamped,
    measuredLegs,
  };
}

function generationStatusForError(
  deadline: AbortSignal,
  error: unknown,
): GenerationStatus {
  if (error instanceof LlmBudgetExceeded) return "budget_refused";
  if (timedOut(deadline, error)) return "timeout";
  if (error instanceof StructuredOutputExhaustionError) return "invalid_output";
  if (error instanceof ParlayPersistenceError) return "persistence_error";
  if (error instanceof ParlayUnpriceableError) return "unpriceable";
  return "provider_error";
}

/** Start the caught background task only after normal prematch delivery and
 * outcome message-reference persistence have completed. */
export function startParlayGeneration(input: StartParlayGenerationInput): void {
  void runParlayGeneration(input);
}

export async function runParlayGeneration(
  input: StartParlayGenerationInput,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const startedAt = Date.now();
  const deadline = AbortSignal.timeout(PARLAY_GENERATION_DEADLINE_MS);
  const matchId = `${input.gameInfo.platformId}_${input.gameInfo.gameId.toString()}`;

  try {
    const preparation = await prepareGeneration(input, prismaClient, deadline);
    if (preparation.kind === "stop") {
      recordGeneration(preparation.status, startedAt);
      return;
    }
    const definitionId = await generateAndPersistDefinition(
      preparation,
      startedAt,
      deadline,
      prismaClient,
    );
    let published: number;
    try {
      published = await publishParlayDefinition(
        definitionId,
        prismaClient,
        deadline,
      );
    } catch (error) {
      throw new ParlayPersistenceError(error);
    }
    recordGeneration(published > 0 ? "success" : "no_market", startedAt);
  } catch (error) {
    const status = generationStatusForError(deadline, error);
    recordGeneration(status, startedAt);
    const expected =
      status === "budget_refused" ||
      status === "timeout" ||
      status === "invalid_output" ||
      status === "unpriceable";
    if (expected) {
      logger.info(
        `Could not generate Bryan Bucks parlay for ${matchId}:`,
        error,
      );
    } else {
      logger.error(
        `Could not generate Bryan Bucks parlay for ${matchId}:`,
        error,
      );
    }
    if (!expected) {
      Sentry.captureException(error, {
        tags: { source: "betting-parlay-generate", matchId, status },
      });
    }
  }
}
