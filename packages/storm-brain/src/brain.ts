import { requireNativeRoute } from "@shepherdjerred/llm-models";
import {
  createLlmRuntime,
  generateValidatedObject,
  providerCredentialsFromEnv,
  requireCredentialsFor,
  StructuredOutputUsageError,
  type AggregateLlmUsage,
  type ChoiceQuestion,
  type DecisionChoiceOption,
  type DecisionResult,
  type GenerateValidatedObjectInput,
  type GenerateValidatedObjectResult,
  type LlmRuntime,
  type ProviderCredentials,
} from "@shepherdjerred/llm-runtime";
import type { z } from "zod";
import { createModeration, type Moderate } from "./moderation.ts";
import {
  CLASSIFY_SYSTEM,
  TRIAGE_SYSTEM,
  classifyPrompt,
  triagePrompt,
} from "./prompts.ts";
import {
  OffenseSchema,
  TriageDraftSchema,
  type ClassifyRequest,
  type ClassifyResponse,
  type TriageRequest,
  type TriageResponse,
} from "./schemas.ts";

/**
 * The model failed or the call never completed. `usage` is present when
 * tokens were already billed: meter it even though no verdict exists.
 */
export class BrainUpstreamError extends Error {
  readonly usage: AggregateLlmUsage | undefined;

  constructor(message: string, usage: AggregateLlmUsage | undefined) {
    super(message);
    this.name = "BrainUpstreamError";
    this.usage = usage;
  }
}

export type BrainDecision<Response> = {
  response: Response;
  usage: AggregateLlmUsage;
};

export type BrainClassify = (
  request: ClassifyRequest,
) => Promise<BrainDecision<ClassifyResponse>>;

export type BrainTriage = (
  request: TriageRequest,
) => Promise<BrainDecision<TriageResponse>>;

export type BrainDependencies = {
  moderate: Moderate;
  classify: BrainClassify;
  triage: BrainTriage;
};

export type CreateBrainOptions = {
  /** The catalog id for generative endpoints, for example `gpt-6-luna`. Unknown ids fail fast. */
  model: string;
  /** The catalog id for OpenAI Decisions API endpoints (`/v1/moderate`, `/v1/classify`). */
  decisionsModel?: string | undefined;
  /** Per-call LLM timeout in milliseconds. */
  timeoutMs: number;
  /** Optional pre-configured credentials for hermetic tests; defaults to environment. */
  credentials?: ProviderCredentials | undefined;
  /** Optional fetch override for hermetic tests. */
  fetcher?: ((url: string, init: RequestInit) => Promise<Response>) | undefined;
};

type Offense = z.infer<typeof OffenseSchema>;

const DEFAULT_DECISIONS_MODEL = "gpt-6-luna";
const MICROS_PER_DOLLAR = 1_000_000;

const OFFENSE_POLICY: Readonly<
  Record<
    Offense,
    { readonly choiceDescription: string; readonly deterministicReason: string }
  >
> = {
  spam: {
    choiceDescription:
      "Floods, rapid bursts, repeated lines, or gibberish chat farming.",
    deterministicReason: "Repetitive chat flooding or spam burst detected.",
  },
  advertising: {
    choiceDescription:
      "Competing server invites, external server IPs or links, or real-money trading solicitation.",
    deterministicReason:
      "External server promotion or real-money trading solicitation detected.",
  },
  slur: {
    choiceDescription: "Slurs or hate speech targeting protected groups.",
    deterministicReason: "Hate speech or slur usage detected.",
  },
  toxicity: {
    choiceDescription:
      "Insults, hostility, or abusive profanity directed at players.",
    deterministicReason:
      "Hostile insults or player-directed toxicity detected.",
  },
  grief: {
    choiceDescription:
      "Admissions or plans to destroy other players' builds or kill protected pets, animals, or villagers.",
    deterministicReason:
      "Admission or coordination of build or pet griefing detected.",
  },
  theft: {
    choiceDescription:
      "Admissions or plans to bypass locks or steal from locked containers (unlocked chests are allowed).",
    deterministicReason:
      "Admission or plan to steal from locked containers detected.",
  },
  cheat: {
    choiceDescription:
      "Admissions, plans, or distribution of cheats, hacked clients, exploits, or x-ray.",
    deterministicReason:
      "Admission, promotion, or use of cheats or exploits detected.",
  },
  harassment: {
    choiceDescription:
      "Targeted harassment, stalking, real-world threats, doxxing, or explicit sexual harassment toward a player.",
    deterministicReason:
      "Targeted harassment, threats, doxxing, or sexual misconduct detected.",
  },
};

const CLASSIFY_OFFENSE_CHOICES: readonly DecisionChoiceOption[] = [
  {
    value: "none",
    description:
      "Clean chat: ordinary gameplay, friendly banter, permitted PvP combat talk, or taking from unlocked chests.",
  },
  ...OffenseSchema.options.map((offense) => ({
    value: offense,
    description: OFFENSE_POLICY[offense].choiceDescription,
  })),
];

const CLASSIFY_OFFENSE_QUESTION: ChoiceQuestion = {
  type: "choice",
  name: "offense",
  instructions:
    "Classify the player's newest chat line using earlier lines as context. Select none when clean or the single primary enforceable offense.",
  choices: CLASSIFY_OFFENSE_CHOICES,
};

function costMicros(usage: AggregateLlmUsage): number {
  return Math.round(usage.catalogCostUsd * MICROS_PER_DOLLAR);
}

export function decisionAggregateUsage(
  result: DecisionResult,
): AggregateLlmUsage {
  const uncachedInput = Math.max(
    0,
    result.usage.inputTokens -
      result.usage.cachedInputTokens -
      result.usage.cacheWriteTokens,
  );
  return {
    tokens: {
      input: uncachedInput,
      output: result.usage.outputTokens,
      cachedInput: result.usage.cachedInputTokens,
      cacheWrite: result.usage.cacheWriteTokens,
      reasoning: result.usage.reasoningTokens,
      total: result.usage.totalTokens,
    },
    catalogCostUsd: result.catalogCostUsd ?? 0,
  };
}

function deterministicOffenseReason(offense: Offense): string {
  return OFFENSE_POLICY[offense].deterministicReason;
}

function mapClassifyDecision(
  decisionResult: DecisionResult,
): BrainDecision<ClassifyResponse> {
  const usage = decisionAggregateUsage(decisionResult);
  const answer = decisionResult.answerByName("offense");
  if (answer === undefined) {
    throw new BrainUpstreamError(
      "Classify decision response omitted offense answer",
      usage,
    );
  }

  const resolvedCostMicros = Math.round(
    (decisionResult.catalogCostUsd ?? 0) * MICROS_PER_DOLLAR,
  );

  if (answer.type === "refusal") {
    return {
      response: {
        offense: "spam",
        confidence: 0.5,
        label: "refusal-review",
        reasoning:
          "Classifier declined; below auto-action threshold for staff awareness.",
        model: decisionResult.model,
        costMicros: resolvedCostMicros,
      },
      usage,
    };
  }

  if (answer.type !== "choice") {
    throw new BrainUpstreamError(
      `Unexpected classify decision answer type: ${answer.type}`,
      usage,
    );
  }

  if (answer.choice === "none") {
    return {
      response: {
        offense: null,
        confidence: Math.max(0, Math.min(1, 1 - answer.confidence)),
        label: "clean",
        reasoning: "No actionable chat offense detected.",
        model: decisionResult.model,
        costMicros: resolvedCostMicros,
      },
      usage,
    };
  }

  const parsedOffense = OffenseSchema.safeParse(answer.choice);
  if (!parsedOffense.success) {
    throw new BrainUpstreamError(
      `Unexpected classify offense choice: ${String(answer.choice)}`,
      usage,
    );
  }

  return {
    response: {
      offense: parsedOffense.data,
      confidence: answer.confidence,
      label: parsedOffense.data,
      reasoning: deterministicOffenseReason(parsedOffense.data),
      model: decisionResult.model,
      costMicros: resolvedCostMicros,
    },
    usage,
  };
}

/**
 * The live brain: OpenAI Decisions API classification and contextual moderation
 * on `decisionsModel`, plus structured ticket triage on `model` through
 * llm-runtime.
 *
 * Provider credentials come from the process environment unless supplied in
 * tests. Unknown models and missing provider keys fail fast here, not on the
 * first request.
 */
export function createBrain(options: CreateBrainOptions): BrainDependencies {
  const decisionsModel = options.decisionsModel ?? DEFAULT_DECISIONS_MODEL;
  const credentials = options.credentials ?? providerCredentialsFromEnv();
  requireCredentialsFor(options.model, credentials);
  requireCredentialsFor(decisionsModel, credentials);
  requireNativeRoute(decisionsModel, "decisions");

  const fetcher = options.fetcher;
  const runtime: LlmRuntime = createLlmRuntime({
    credentials,
    service: "storm-brain",
    appName: "storm-brain",
    ...(fetcher === undefined
      ? {}
      : {
          fetch: (input, init) => {
            const url =
              typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.toString()
                  : input.url;
            return fetcher(url, init ?? {});
          },
        }),
  });

  const classify: BrainClassify = async (request) => {
    let decisionResult: DecisionResult;
    try {
      decisionResult = await runtime.decide({
        model: decisionsModel,
        workload: "classify",
        promptCacheKey: "storm-brain:classify:v1",
        system: [
          {
            type: "input_text",
            text: CLASSIFY_SYSTEM,
            prompt_cache_breakpoint: true,
          },
        ],
        input: classifyPrompt(request),
        questions: [CLASSIFY_OFFENSE_QUESTION],
        abortSignal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      if (error instanceof BrainUpstreamError) throw error;
      throw new BrainUpstreamError(
        error instanceof Error ? error.message : String(error),
        undefined,
      );
    }
    return mapClassifyDecision(decisionResult);
  };

  const triage: BrainTriage = async (request) => {
    const draft = await validated(
      runtime,
      {
        model: options.model,
        schema: TriageDraftSchema,
        schemaName: "storm_triage_draft",
        system: TRIAGE_SYSTEM,
        prompt: triagePrompt(request),
        workload: "storm-brain-triage",
        maxOutputTokens: 2048,
        reasoningEffort: "medium",
      },
      options.timeoutMs,
    );
    return {
      response: {
        ...draft.object,
        model: options.model,
        costMicros: costMicros(draft.usage),
      },
      usage: draft.usage,
    };
  };

  const openai = credentials.openai;
  if (openai === undefined)
    throw new Error("Content moderation requires OpenAI credentials");
  const moderate = createModeration({
    apiKey: openai.apiKey,
    decisionsModel,
    runtime,
    timeoutMs: Math.min(options.timeoutMs, 5000),
    ...(fetcher === undefined ? {} : { fetcher }),
  });
  return { classify, triage, moderate };
}

async function validated<SCHEMA extends z.ZodType>(
  runtime: LlmRuntime,
  input: GenerateValidatedObjectInput<SCHEMA>,
  timeoutMs: number,
): Promise<GenerateValidatedObjectResult<SCHEMA>> {
  try {
    return await generateValidatedObject(runtime, {
      ...input,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof StructuredOutputUsageError) {
      throw new BrainUpstreamError(error.message, error.usage);
    }
    throw new BrainUpstreamError(
      error instanceof Error ? error.message : String(error),
      undefined,
    );
  }
}
