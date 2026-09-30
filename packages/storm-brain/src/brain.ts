import {
  createLlmRuntime,
  generateValidatedObject,
  providerCredentialsFromEnv,
  requireCredentialsFor,
  StructuredOutputUsageError,
  type AggregateLlmUsage,
  type GenerateValidatedObjectInput,
  type GenerateValidatedObjectResult,
  type LlmRuntime,
} from "@shepherdjerred/llm-runtime";
import type { z } from "zod";
import {
  CLASSIFY_SYSTEM,
  TRIAGE_SYSTEM,
  classifyPrompt,
  triagePrompt,
} from "./prompts.ts";
import {
  ClassifyVerdictSchema,
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
  classify: BrainClassify;
  triage: BrainTriage;
};

export type CreateBrainOptions = {
  /** The catalog id, for example `gpt-5.6-luna`. Unknown ids fail fast. */
  model: string;
  /** Per-call LLM timeout in milliseconds. */
  timeoutMs: number;
};

const MICROS_PER_DOLLAR = 1_000_000;

function costMicros(usage: AggregateLlmUsage): number {
  return Math.round(usage.catalogCostUsd * MICROS_PER_DOLLAR);
}

/**
 * The live brain: structured chat classification and ticket triage on the
 * catalog model through llm-runtime. Reasoning stays low: these are fast
 * judgments, and the soak data decides whether deeper thinking pays.
 *
 * Provider credentials come from the process environment. Unknown models and
 * missing provider keys fail fast here, not on the first request.
 */
export function createBrain(options: CreateBrainOptions): BrainDependencies {
  const credentials = providerCredentialsFromEnv();
  requireCredentialsFor(options.model, credentials);
  const runtime: LlmRuntime = createLlmRuntime({
    credentials,
    service: "storm-brain",
    appName: "storm-brain",
  });

  const classify: BrainClassify = async (request) => {
    const verdict = await validated(
      runtime,
      {
        model: options.model,
        schema: ClassifyVerdictSchema,
        schemaName: "storm_classify_verdict",
        system: CLASSIFY_SYSTEM,
        prompt: classifyPrompt(request),
        workload: "storm-brain-classify",
        maxOutputTokens: 512,
        reasoningEffort: "low",
      },
      options.timeoutMs,
    );
    return {
      response: {
        ...verdict.object,
        model: options.model,
        costMicros: costMicros(verdict.usage),
      },
      usage: verdict.usage,
    };
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

  return { classify, triage };
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
