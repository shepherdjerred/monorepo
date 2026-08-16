import { costForTextUsage } from "@shepherdjerred/llm-models";
import {
  MAX_CORRECTIVE_PROMPT_CHARS,
  MAX_SEMANTIC_ATTEMPTS,
} from "@shepherdjerred/llm-runtime";
import { ApplicationFailure } from "@temporalio/common";
import type { GenerationArtifactResult } from "./glitter-context-refresh-cache.ts";

export type GenerationBudgetSummary = {
  maxUncachedCostUsd: number;
  preflightEstimatedCostUsd: number;
  actualUncachedCostUsd: number;
  cacheHits: number;
  cacheMisses: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  artifactKeys: string[];
};

export function inputTokenUpperBound(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function estimatedCallCostUsd(input: {
  model: string;
  inputTokenUpperBound: number;
  outputTokenUpperBound: number;
}): number {
  const cost = costForTextUsage(input.model, {
    inputTokens: input.inputTokenUpperBound,
    outputTokens: input.outputTokenUpperBound,
  });
  if (cost === undefined) {
    throw new Error(`missing text pricing for ${input.model}`);
  }
  return cost;
}

/**
 * Cost of one `generateGlitterObject` call in the worst case: every semantic
 * attempt the runtime is allowed to issue is billable, and each retry after the
 * first sends the corrective preamble plus, when the caller raised the ceiling
 * for truncation retries, a larger output cap. Reserving only the first attempt
 * would let a run exceed its limit before `record` could observe the overrun.
 */
export function worstCaseGenerationCostUsd(input: {
  model: string;
  inputTokenUpperBound: number;
  outputTokenUpperBound: number;
  semanticRetryOutputTokenUpperBound?: number | undefined;
}): number {
  const firstAttempt = estimatedCallCostUsd({
    model: input.model,
    inputTokenUpperBound: input.inputTokenUpperBound,
    outputTokenUpperBound: input.outputTokenUpperBound,
  });
  const retryAttempt = estimatedCallCostUsd({
    model: input.model,
    inputTokenUpperBound:
      input.inputTokenUpperBound + MAX_CORRECTIVE_PROMPT_CHARS,
    outputTokenUpperBound:
      input.semanticRetryOutputTokenUpperBound ?? input.outputTokenUpperBound,
  });
  return firstAttempt + retryAttempt * (MAX_SEMANTIC_ATTEMPTS - 1);
}

export class GenerationBudget {
  readonly #maxUncachedCostUsd: number;
  #preflightEstimatedCostUsd = 0;
  #actualUncachedCostUsd = 0;
  #cacheHits = 0;
  #cacheMisses = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  #cachedInputTokens = 0;
  readonly #artifactKeys = new Set<string>();

  constructor(maxUncachedCostUsd: number) {
    if (!Number.isFinite(maxUncachedCostUsd) || maxUncachedCostUsd <= 0) {
      throw new Error("Glitter generation budget must be a positive number");
    }
    this.#maxUncachedCostUsd = maxUncachedCostUsd;
  }

  setPreflightEstimatedCostUsd(costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd < 0) {
      throw new Error("Glitter preflight cost must be nonnegative");
    }
    this.#preflightEstimatedCostUsd = costUsd;
  }

  authorizeUncachedCall(maximumCallCostUsd: number): void {
    if (
      this.#actualUncachedCostUsd + maximumCallCostUsd >
      this.#maxUncachedCostUsd
    ) {
      throw ApplicationFailure.nonRetryable(
        `Glitter generation budget exhausted: $${this.#actualUncachedCostUsd.toFixed(4)} spent, $${maximumCallCostUsd.toFixed(4)} maximum next call, $${this.#maxUncachedCostUsd.toFixed(2)} limit`,
        "GlitterGenerationBudgetExhausted",
      );
    }
  }

  record<Response>(artifact: GenerationArtifactResult<Response>): void {
    const alreadyRecorded = this.#artifactKeys.has(artifact.key);
    this.#artifactKeys.add(artifact.key);
    if (artifact.cacheStatus === "hit") {
      this.#cacheHits += 1;
    } else {
      this.#cacheMisses += 1;
    }
    if (alreadyRecorded || !artifact.billedToCurrentRun) {
      return;
    }
    this.#actualUncachedCostUsd += artifact.usage.costUsd;
    this.#inputTokens += artifact.usage.inputTokens;
    this.#outputTokens += artifact.usage.outputTokens;
    this.#cachedInputTokens += artifact.usage.cachedInputTokens;
    if (this.#actualUncachedCostUsd > this.#maxUncachedCostUsd) {
      throw ApplicationFailure.nonRetryable(
        `Glitter generation exceeded its $${this.#maxUncachedCostUsd.toFixed(2)} uncached cost limit`,
        "GlitterGenerationBudgetExceeded",
      );
    }
  }

  summary(): GenerationBudgetSummary {
    return {
      maxUncachedCostUsd: this.#maxUncachedCostUsd,
      preflightEstimatedCostUsd: this.#preflightEstimatedCostUsd,
      actualUncachedCostUsd: this.#actualUncachedCostUsd,
      cacheHits: this.#cacheHits,
      cacheMisses: this.#cacheMisses,
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      cachedInputTokens: this.#cachedInputTokens,
      artifactKeys: [...this.#artifactKeys].toSorted(),
    };
  }
}
