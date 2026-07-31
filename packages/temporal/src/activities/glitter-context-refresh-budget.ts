import { costForTextUsage } from "@shepherdjerred/llm-models";
import { ApplicationFailure } from "@temporalio/common";
import type {
  GenerationArtifactResult,
  GenerationUsage,
} from "./glitter-context-refresh-cache.ts";

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

export function openAiGenerationUsage(input: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
}): GenerationUsage {
  const costUsd = costForTextUsage(input.model, {
    inputTokens: input.promptTokens,
    outputTokens: input.completionTokens,
    cachedInputTokens: input.cachedPromptTokens,
  });
  if (costUsd === undefined) {
    throw new Error(`missing text pricing for ${input.model}`);
  }
  return {
    inputTokens: input.promptTokens,
    outputTokens: input.completionTokens,
    cachedInputTokens: input.cachedPromptTokens,
    costUsd,
  };
}
