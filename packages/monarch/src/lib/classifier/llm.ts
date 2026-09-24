import { generateText } from "ai";
import {
  createLlmRuntime,
  providerCredentialsFromEnv,
  generateValidatedObject,
  StructuredOutputUsageError,
  webSearchTool,
  type LlmRuntime,
} from "@shepherdjerred/llm-runtime";
import type { z } from "zod";
import { buildSystemPrompt } from "./prompt.ts";
import type { UsageSummary } from "../usage.ts";
import { createUsageTracker } from "../usage.ts";

let runtime: LlmRuntime | undefined;
let modelId = "claude-sonnet-5";
let tracker: ReturnType<typeof createUsageTracker> | undefined;
let webSearchEnabled = false;

export function initLlm(model?: string): void {
  runtime = createLlmRuntime({
    credentials: providerCredentialsFromEnv(),
    service: "monarch",
    appName: "Monarch Transaction Classifier",
  });
  if (model !== undefined) modelId = model;
  tracker = createUsageTracker(modelId);
}

export function setWebSearchEnabled(enabled: boolean): void {
  webSearchEnabled = enabled;
}

export function getUsageSummary(): UsageSummary {
  if (tracker === undefined) throw new Error("Call initLlm() first");
  return tracker.getSummary();
}

export function getRuntime(): LlmRuntime {
  if (runtime === undefined) throw new Error("Call initLlm() first");
  return runtime;
}

export function getModelId(): string {
  return modelId;
}

export function getTracker():
  ReturnType<typeof createUsageTracker> | undefined {
  return tracker;
}

export function isWebSearchEnabled(): boolean {
  return webSearchEnabled;
}

type LlmResponse = {
  usage: { inputTokens: number; outputTokens: number };
};

async function researchPrompt(userPrompt: string): Promise<{
  evidence: string;
  usage: LlmResponse["usage"];
}> {
  const openRouter = getRuntime();
  if (!webSearchEnabled) {
    return {
      evidence: "Research disabled.",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
  const result = await generateText({
    model: openRouter.languageModel(modelId, ["tools", "webSearch"]),
    system:
      "Research unfamiliar merchants for a personal-finance classification task. Return concise factual evidence only; do not attempt to emit the final JSON contract.",
    prompt: userPrompt,
    tools: {
      web_search: webSearchTool(openRouter, modelId, 20),
    },
    maxOutputTokens: 4096,
    ...openRouter.callOptions({ workload: "monarch.batch.research" }),
  });
  const usage = {
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
  };
  tracker?.record(usage.inputTokens, usage.outputTokens);
  return { evidence: result.text.slice(-40_000), usage };
}

export async function callLlmAndParseWithUsage<T>(
  prompt: string,
  schema: z.ZodType<T>,
): Promise<{ result: T; usage: LlmResponse["usage"] }> {
  const openRouter = getRuntime();
  const research = await researchPrompt(prompt);
  let finalized;
  try {
    finalized = await generateValidatedObject(openRouter, {
      model: modelId,
      schema,
      schemaName: "monarch_classification",
      system: buildSystemPrompt(),
      prompt: `${prompt}\n\nResearch evidence:\n${research.evidence}`,
      workload: "monarch.classification.finalize",
      maxOutputTokens: 16_384,
    });
  } catch (error: unknown) {
    // Exhausted or transport-interrupted finalizations still billed every
    // semantic attempt; without this the end-of-run usage and cost summary
    // silently omits them.
    if (error instanceof StructuredOutputUsageError) {
      tracker?.record(error.usage.tokens.input, error.usage.tokens.output);
    }
    throw error;
  }
  const usage = {
    inputTokens: research.usage.inputTokens + finalized.usage.tokens.input,
    outputTokens: research.usage.outputTokens + finalized.usage.tokens.output,
  };
  tracker?.record(finalized.usage.tokens.input, finalized.usage.tokens.output);
  return { result: finalized.object, usage };
}

type SplitItem = {
  amount: number;
  categoryId: string;
  itemName: string;
  categoryName: string;
};

function fixRoundingDrift(splits: SplitItem[], targetCents: number): void {
  const sumCents = splits.reduce((s, i) => s + Math.round(i.amount * 100), 0);
  const last = splits.at(-1);
  if (sumCents !== targetCents && last !== undefined) {
    last.amount =
      (Math.round(last.amount * 100) + (targetCents - sumCents)) / 100;
  }
}

export function computeSplits(
  transactionTotal: number,
  items: SplitItem[],
): SplitItem[] {
  const target = Math.abs(transactionTotal);
  const targetCents = Math.round(target * 100);
  const itemSum = items.reduce((sum, item) => sum + item.amount, 0);
  const remainder = target - itemSum;

  if (Math.abs(remainder) < 0.01) {
    const rounded = items.map((item) => ({
      ...item,
      amount: Math.round(item.amount * 100) / 100,
    }));
    fixRoundingDrift(rounded, targetCents);
    return rounded;
  }

  // Prorate items to match transaction total, then fix rounding
  const prorated = items.map((item) => {
    const proportion = item.amount / itemSum;
    const adjusted = item.amount + remainder * proportion;
    return {
      ...item,
      amount: Math.round(adjusted * 100) / 100,
    };
  });
  fixRoundingDrift(prorated, targetCents);

  return prorated;
}
