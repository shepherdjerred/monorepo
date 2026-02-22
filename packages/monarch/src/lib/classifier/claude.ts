import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { MonarchCategory } from "../monarch/types.ts";
import type { WeekWindow } from "../monarch/weeks.ts";
import type { ResolvedTransaction } from "../enrichment.ts";
import type {
  AmazonBatchResponse,
  AmazonOrderInput,
  VenmoClassificationResponse,
  WeekClassificationResponse,
} from "./types.ts";
import {
  buildSystemPrompt,
  buildWeekPrompt,
  buildAmazonBatchPrompt,
  buildVenmoClassificationPrompt,
} from "./prompt.ts";
import type { VenmoMatch } from "../venmo/matcher.ts";
import { log } from "../logger.ts";
import type { UsageSummary } from "../usage.ts";
import { createUsageTracker } from "../usage.ts";

let client: Anthropic | undefined;
let modelId = "claude-sonnet-4-20250514";
let tracker: ReturnType<typeof createUsageTracker> | undefined;

export function initClaude(apiKey: string, model?: string): void {
  client = new Anthropic({ apiKey });
  if (model !== undefined) modelId = model;
  tracker = createUsageTracker(modelId);
}

export function getUsageSummary(): UsageSummary {
  if (tracker === undefined) throw new Error("Call initClaude() first");
  return tracker.getSummary();
}

function getClient(): Anthropic {
  if (client === undefined) throw new Error("Call initClaude() first");
  return client;
}

export function parseJsonResponse(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = /```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/.exec(cleaned);
  const fenceContent = fenceMatch?.[1];
  if (fenceContent !== undefined) {
    cleaned = fenceContent.trim();
  }
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const jsonStart = cleaned.search(/[{[]/);
    if (jsonStart >= 0) {
      cleaned = cleaned.slice(jsonStart);
    }
  }
  return JSON.parse(cleaned) as unknown;
}

const WeekClassificationSchema = z.object({
  transactions: z.array(
    z.object({
      transactionIndex: z.number(),
      categoryId: z.string(),
      categoryName: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

const AmazonBatchSchema = z.object({
  orders: z.array(
    z.object({
      orderIndex: z.number(),
      items: z.array(
        z.object({
          title: z.string(),
          price: z.number(),
          categoryId: z.string(),
          categoryName: z.string(),
        }),
      ),
      needsSplit: z.boolean(),
    }),
  ),
});

type ClaudeResponse = {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
};

function jitteredDelay(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * baseMs * 0.5);
}

function isApiRetryable(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError)) return false;
  const status = Number(error.status);
  return status === 429 || status === 529 || status >= 500;
}

function isParseRetryable(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  if (error instanceof z.ZodError) return true;
  const message = error instanceof Error ? error.message : "";
  return message.includes("Parse error");
}

async function callClaude(userPrompt: string): Promise<ClaudeResponse> {
  const claude = getClient();
  const maxRetries = 5;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await claude.messages.create({
        model: modelId,
        max_tokens: 16_384,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: userPrompt }],
      });

      const block = response.content[0];
      if (block?.type !== "text") {
        throw new Error("Unexpected response type");
      }

      if (response.stop_reason === "max_tokens") {
        throw new Error(
          `Response truncated (${String(response.usage.output_tokens)} output tokens). Consider reducing batch size.`,
        );
      }

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
      tracker?.record(usage.inputTokens, usage.outputTokens);

      return { text: block.text, usage };
    } catch (error: unknown) {
      if (isApiRetryable(error) && attempt < maxRetries) {
        const status = error instanceof Anthropic.APIError ? String(error.status) : "unknown";
        const delay = jitteredDelay(1000 * 2 ** attempt);
        log.warn(
          `API error (${status}), retrying in ${String(Math.round(delay / 1000))}s (attempt ${String(attempt + 1)}/${String(maxRetries)})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }

  throw new Error("Exceeded max retries");
}

async function callClaudeAndParse<T>(
  prompt: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { text } = await callClaude(prompt);
      return schema.parse(parseJsonResponse(text));
    } catch (error: unknown) {
      if (isParseRetryable(error) && attempt < maxRetries) {
        const delay = jitteredDelay(2000 * 2 ** attempt);
        const label = error instanceof Error ? error.message.slice(0, 60) : "Unknown error";
        log.warn(
          `Parse failed: ${label}, retrying in ${String(Math.round(delay / 1000))}s (attempt ${String(attempt + 1)}/${String(maxRetries)})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Exceeded max retries");
}

export async function classifyWeek(
  categories: MonarchCategory[],
  window: WeekWindow,
  resolvedMap: Map<string, ResolvedTransaction>,
  previousResults: Map<string, string>,
): Promise<WeekClassificationResponse> {
  const prompt = buildWeekPrompt(categories, window, resolvedMap, previousResults);
  return callClaudeAndParse(prompt, WeekClassificationSchema);
}

const VenmoClassificationSchema = z.object({
  payments: z.array(
    z.object({
      note: z.string(),
      amount: z.number(),
      categoryId: z.string(),
      categoryName: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

export async function classifyVenmoPayments(
  categories: MonarchCategory[],
  matches: VenmoMatch[],
): Promise<VenmoClassificationResponse> {
  const prompt = buildVenmoClassificationPrompt(categories, matches);
  return callClaudeAndParse(prompt, VenmoClassificationSchema);
}

export async function classifyAmazonBatch(
  categories: MonarchCategory[],
  orders: AmazonOrderInput[],
): Promise<AmazonBatchResponse> {
  const prompt = buildAmazonBatchPrompt(categories, orders);
  return callClaudeAndParse(prompt, AmazonBatchSchema);
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
    last.amount = (Math.round(last.amount * 100) + (targetCents - sumCents)) / 100;
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
