import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { MonarchCategory, MerchantGroup } from "../monarch/types.ts";
import type {
  MerchantBatchResponse,
  AmazonClassificationResponse,
} from "./types.ts";
import {
  buildSystemPrompt,
  buildMerchantBatchPrompt,
  buildAmazonItemPrompt,
} from "./prompt.ts";

let client: Anthropic | undefined;
let modelId = "claude-sonnet-4-20250514";

export function initClaude(apiKey: string, model?: string): void {
  client = new Anthropic({ apiKey });
  if (model !== undefined) modelId = model;
}

function getClient(): Anthropic {
  if (client === undefined) throw new Error("Call initClaude() first");
  return client;
}

export function parseJsonResponse(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = /```(?:json)?\n([\s\S]*?)\n```/.exec(cleaned);
  const fenceContent = fenceMatch?.[1];
  if (fenceContent !== undefined) {
    cleaned = fenceContent.trim();
  }
  return JSON.parse(cleaned) as unknown;
}

const MerchantBatchSchema = z.object({
  merchants: z.array(
    z.object({
      merchantName: z.string(),
      categoryId: z.string(),
      categoryName: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      ambiguous: z.boolean(),
      reason: z.string().optional(),
    }),
  ),
});

const AmazonClassificationSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      price: z.number(),
      categoryId: z.string(),
      categoryName: z.string(),
    }),
  ),
  needsSplit: z.boolean(),
});

async function callClaude(userPrompt: string): Promise<string> {
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
      return block.text;
    } catch (error: unknown) {
      const status =
        error instanceof Anthropic.APIError
          ? Number(error.status)
          : undefined;
      if ((status === 429 || status === 529) && attempt < maxRetries) {
        const delay = 1000 * 2 ** (attempt + 1);
        console.error(
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

export async function classifyMerchantBatch(
  categories: MonarchCategory[],
  merchants: MerchantGroup[],
): Promise<MerchantBatchResponse> {
  const prompt = buildMerchantBatchPrompt(categories, merchants);
  const response = await callClaude(prompt);
  return MerchantBatchSchema.parse(parseJsonResponse(response));
}

export async function classifyAmazonItems(
  categories: MonarchCategory[],
  items: { title: string; price: number }[],
): Promise<AmazonClassificationResponse> {
  const prompt = buildAmazonItemPrompt(categories, items);
  const response = await callClaude(prompt);
  return AmazonClassificationSchema.parse(parseJsonResponse(response));
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
