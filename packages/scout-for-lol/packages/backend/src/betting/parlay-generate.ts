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
  parseModelGeneratedParlay,
} from "#src/betting/parlay-model-schema.ts";
import {
  PARLAY_PROMPT_VERSION,
  buildParlayGenerationContext,
  buildParlayPrompt,
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
  | "persistence_error";

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

  const aliasByPuuid = new Map(
    input.trackedPlayers.map((player) => [
      player.league.leagueAccount.puuid,
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
    context,
  };
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
  const generated = await (async () => {
    try {
      const result = await generateValidatedObject(runtime, {
        model,
        schema: generatedParlaySchemaFor(setup.subjects),
        schemaName: "bryan_bucks_parlay",
        schemaDescription:
          "A fixed-odds AND parlay built only from the supplied closed catalog.",
        system: PARLAY_SYSTEM_PROMPT,
        prompt: buildParlayPrompt(setup.context),
        workload: "scout.betting.parlay.generate",
        sessionId: setup.matchId,
        abortSignal: deadline,
        reasoningEffort: "medium",
        maxOutputTokens: PARLAY_INITIAL_OUTPUT_TOKENS,
        semanticRetryMaxOutputTokens: PARLAY_RETRY_OUTPUT_TOKENS,
      });
      chargeUsage(model, result.usage.tokens);
      return { ...result, object: parseModelGeneratedParlay(result.object) };
    } catch (error) {
      if (error instanceof StructuredOutputUsageError) {
        chargeUsage(model, error.usage.tokens);
      }
      throw error;
    }
  })();
  deadline.throwIfAborted();
  try {
    const definition = await prismaClient.bucksParlayDefinition.create({
      data: {
        matchId: setup.matchId,
        queueType: setup.queueType,
        selectedTeamId: setup.selectedTeamId,
        subjects: JSON.stringify(setup.subjects),
        criteria: JSON.stringify(generated.object),
        yesProbabilityBps: generated.object.yesProbabilityBps,
        promptVersion: PARLAY_PROMPT_VERSION,
        catalogVersion: PARLAY_CATALOG_VERSION,
        schemaVersion: PARLAY_SCHEMA_VERSION,
        evaluatorVersion: PARLAY_EVALUATOR_VERSION,
        generationContext: JSON.stringify(setup.context),
        requestedModel: model,
        resolvedModel: generated.metadata.at(-1)?.resolvedModel ?? null,
        usage: JSON.stringify({
          aggregate: generated.usage,
          attempts: generated.attempts.map((attempt) => ({
            attempt: attempt.attempt,
            outcome: attempt.outcome,
            finishReason: attempt.finishReason,
            usage: attempt.usage,
          })),
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

function generationStatusForError(
  deadline: AbortSignal,
  error: unknown,
): GenerationStatus {
  if (error instanceof LlmBudgetExceeded) return "budget_refused";
  if (timedOut(deadline, error)) return "timeout";
  if (error instanceof StructuredOutputExhaustionError) return "invalid_output";
  if (error instanceof ParlayPersistenceError) return "persistence_error";
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
      status === "invalid_output";
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
