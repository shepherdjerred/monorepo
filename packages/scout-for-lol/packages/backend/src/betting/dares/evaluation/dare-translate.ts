import * as Sentry from "@sentry/bun";
import type { z } from "zod";
import {
  StructuredOutputUsageError,
  generateValidatedObject,
  type AggregateOpenRouterUsage,
  type GenerateValidatedObjectInput,
  type GenerateValidatedObjectResult,
  type OpenRouterRuntime,
} from "@shepherdjerred/llm-runtime";
import { withLlmSubjectSpan } from "@shepherdjerred/llm-observability/subject";
import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { bettingParlayAiModel } from "#src/config/dynamic.ts";
import {
  DARE_TRANSLATION_DEADLINE_MS,
  DARE_TRANSLATION_OUTPUT_TOKENS,
  DARE_TRANSLATION_RETRY_OUTPUT_TOKENS,
} from "#src/betting/constants.ts";
import type { DareConditions } from "#src/betting/dares/evaluation/dare-criteria.ts";
import {
  canonicalizeDareTranslation,
  dareTranslationSchemaFor,
  type DareModelTranslation,
} from "#src/betting/dares/evaluation/dare-model-schema.ts";
import {
  DARE_PROMPT_VERSION,
  DARE_TRANSLATION_SYSTEM_PROMPT,
  buildDareTranslationPrompt,
} from "#src/betting/dares/presentation/dare-prompt.ts";
import {
  buildDareShortlist,
  type DareShortlistEntry,
} from "#src/betting/dares/dare-shortlist.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getOpenRouterRuntime } from "#src/league/review/ai-clients.ts";
import {
  assertWithinBudget,
  recordTokenUsage,
} from "#src/league/review/openai-budget.ts";
import { sharedLlmFailureKind } from "#src/betting/llm-failure.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-dare-translate");

/**
 * The one place the dare feature talks to a model.
 *
 * Plumbing mirrors `parlay-generate.ts`: OpenRouter runtime, budget assert,
 * `generateValidatedObject` under an `AbortSignal.timeout` deadline, usage
 * charged even for failed structured output, all inside a guild-attributed
 * LLM subject span. The difference is the boundary shape: a human is waiting
 * on an ephemeral reply, so every outcome — including provider failure — is a
 * result-union member, never a thrown error.
 */

/** Frozen provenance stored on the dare (`BucksDare.translation`). */
export type DareTranslationRecord = {
  promptVersion: string;
  model: string;
  usage: AggregateOpenRouterUsage;
  shortlistKeys: readonly string[];
  rawOutput: DareModelTranslation;
};

export type DareTranslationResult =
  | {
      kind: "translated";
      /** Resolved shortlist entries, in the model's target order. */
      targets: readonly DareShortlistEntry[];
      horizonKind: "next_game" | "window";
      /** Already defaulted; null only for `next_game`. */
      windowDays: number | null;
      /** Canonical, `DareConditionsSchema`-parsed — never the model shape. */
      conditions: DareConditions;
      record: DareTranslationRecord;
    }
  | { kind: "unmappable"; reason: string }
  | { kind: "timeout" }
  | { kind: "budget_refused" }
  | { kind: "invalid_output" }
  | { kind: "provider_error" };

/** The `generateValidatedObject`-shaped boundary tests mock (zero network). */
export type DareGenerateBoundary = <SCHEMA extends z.ZodType>(
  runtime: OpenRouterRuntime,
  input: GenerateValidatedObjectInput<SCHEMA>,
) => Promise<GenerateValidatedObjectResult<SCHEMA>>;

export type TranslateDareDeps = {
  loadShortlist: (
    serverId: DiscordGuildId,
    challengerDiscordId: DiscordAccountId,
  ) => Promise<readonly DareShortlistEntry[]>;
  getRuntime: () => OpenRouterRuntime | undefined;
  assertBudget: () => void;
  recordUsage: (
    model: string,
    tokens: { input: number; output: number },
  ) => void;
  generate: DareGenerateBoundary;
  model: () => string;
};

export function defaultTranslateDareDeps(
  prismaClient: ExtendedPrismaClient = prisma,
): TranslateDareDeps {
  return {
    loadShortlist: (serverId, challengerDiscordId) =>
      buildDareShortlist(serverId, challengerDiscordId, prismaClient),
    getRuntime: getOpenRouterRuntime,
    assertBudget: assertWithinBudget,
    recordUsage: (model, tokens) => {
      recordTokenUsage(tokens.input, tokens.output, model);
    },
    generate: generateValidatedObject,
    model: bettingParlayAiModel,
  };
}

export type TranslateDareInput = {
  serverId: DiscordGuildId;
  challengerDiscordId: DiscordAccountId;
  text: string;
};

const SHARED_FAILURE_MESSAGES = {
  budget_refused: "refused by the LLM budget",
  timeout: "timed out",
  invalid_output: "produced no valid object",
} as const;

function failureResult(
  input: TranslateDareInput,
  deadline: AbortSignal,
  error: unknown,
): DareTranslationResult {
  // Budget refusal, deadline expiry, and structured-output exhaustion are
  // classified by the shared model-boundary helper so this module cannot
  // drift from the parlay boundary. Only the provider-error fallback below
  // is specific to dare translation.
  const shared = sharedLlmFailureKind(deadline, error);
  if (shared !== undefined) {
    logger.info(
      `Dare translation ${SHARED_FAILURE_MESSAGES[shared]} for ${input.serverId}:`,
      error,
    );
    return { kind: shared };
  }
  logger.error(`Dare translation failed for ${input.serverId}:`, error);
  Sentry.captureException(error, {
    tags: { source: "betting-dare-translate", serverId: input.serverId },
  });
  return { kind: "provider_error" };
}

async function translateDareInternal(
  input: TranslateDareInput,
  deps: TranslateDareDeps,
): Promise<DareTranslationResult> {
  const deadline = AbortSignal.timeout(DARE_TRANSLATION_DEADLINE_MS);
  try {
    const shortlist = await deps.loadShortlist(
      input.serverId,
      input.challengerDiscordId,
    );
    if (shortlist.length === 0) {
      // Nothing the model could target; refusing before the call spends no
      // tokens and gives the same friendly outcome as a model refusal.
      return {
        kind: "unmappable",
        reason:
          "No other tracked players with linked League accounts to dare in this server.",
      };
    }
    const runtime = deps.getRuntime();
    if (runtime === undefined) {
      throw new Error("OPENROUTER_API_KEY is required for dare translation");
    }
    const model = deps.model();
    const schema = dareTranslationSchemaFor(shortlist);
    let result: GenerateValidatedObjectResult<typeof schema>;
    try {
      deps.assertBudget();
      result = await deps.generate(runtime, {
        model,
        schema,
        schemaName: "bryan_bucks_dare_translation",
        schemaDescription:
          "One free-text dare translated into the closed achievement-bounty condition language.",
        system: DARE_TRANSLATION_SYSTEM_PROMPT,
        prompt: buildDareTranslationPrompt({ text: input.text, shortlist }),
        workload: "scout.betting.dare.translate",
        sessionId: input.serverId,
        abortSignal: deadline,
        reasoningEffort: "medium",
        maxOutputTokens: DARE_TRANSLATION_OUTPUT_TOKENS,
        semanticRetryMaxOutputTokens: DARE_TRANSLATION_RETRY_OUTPUT_TOKENS,
      });
      deps.recordUsage(model, result.usage.tokens);
    } catch (error) {
      // Failed structured output still billed tokens; charge them before
      // classifying the failure (parlay-generate precedent).
      if (error instanceof StructuredOutputUsageError) {
        deps.recordUsage(model, error.usage.tokens);
      }
      throw error;
    }
    const output = schema.parse(result.object);
    if (output.unmappable) {
      return {
        kind: "unmappable",
        reason:
          output.unmappableReason ??
          "That dare cannot be expressed in the supported condition language.",
      };
    }
    const canonical = canonicalizeDareTranslation(output, shortlist);
    return {
      kind: "translated",
      targets: canonical.targets,
      horizonKind: canonical.horizonKind,
      windowDays: canonical.windowDays,
      conditions: canonical.conditions,
      record: {
        promptVersion: DARE_PROMPT_VERSION,
        model,
        usage: result.usage,
        shortlistKeys: shortlist.map((entry) => entry.key),
        rawOutput: output,
      },
    };
  } catch (error) {
    return failureResult(input, deadline, error);
  }
}

/**
 * Translate one `/bb dare` free text into the canonical condition language.
 * Never throws to callers: every outcome is a `DareTranslationResult` member.
 */
export async function translateDare(
  input: TranslateDareInput,
  deps: TranslateDareDeps = defaultTranslateDareDeps(),
): Promise<DareTranslationResult> {
  return await withLlmSubjectSpan(
    "scout.betting.dare",
    { kind: "guild", id: input.serverId },
    () => translateDareInternal(input, deps),
  );
}
