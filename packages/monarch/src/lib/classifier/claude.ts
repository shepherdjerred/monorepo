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
      transactionId: z.string(),
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

async function callClaude(userPrompt: string): Promise<ClaudeResponse> {
  const claude = getClient();
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await claude.messages.create({
        model: modelId,
        max_tokens: 4096,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: userPrompt }],
      });

      const block = response.content[0];
      if (block?.type !== "text") {
        throw new Error("Unexpected response type");
      }

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
      tracker?.record(usage.inputTokens, usage.outputTokens);

      return { text: block.text, usage };
    } catch (error: unknown) {
      const status =
        error instanceof Anthropic.APIError
          ? Number(error.status)
          : undefined;
      if ((status === 429 || status === 529) && attempt < maxRetries) {
        const delay = 1000 * 2 ** (attempt + 1);
        log.warn(
          `Rate limited (${String(status)}), retrying in ${String(delay)}ms (attempt ${String(attempt + 1)}/${String(maxRetries)})...`,
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
  const { text } = await callClaude(prompt);
  return WeekClassificationSchema.parse(parseJsonResponse(text));
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
  const { text } = await callClaude(prompt);
  return VenmoClassificationSchema.parse(parseJsonResponse(text));
}

export async function classifyAmazonBatch(
  categories: MonarchCategory[],
  orders: AmazonOrderInput[],
): Promise<AmazonBatchResponse> {
  const prompt = buildAmazonBatchPrompt(categories, orders);
  const { text } = await callClaude(prompt);
  return AmazonBatchSchema.parse(parseJsonResponse(text));
}

export function computeSplits(
  transactionTotal: number,
  items: {
    amount: number;
    categoryId: string;
    itemName: string;
    categoryName: string;
  }[],
): {
  itemName: string;
  amount: number;
  categoryId: string;
  categoryName: string;
}[] {
  const itemSum = items.reduce((sum, item) => sum + item.amount, 0);
  const remainder = Math.abs(transactionTotal) - itemSum;

  if (Math.abs(remainder) < 0.01) {
    return items;
  }

  return items.map((item) => {
    const proportion = item.amount / itemSum;
    const prorated = item.amount + remainder * proportion;
    return {
      ...item,
      amount: Math.round(prorated * 100) / 100,
    };
  });
}
