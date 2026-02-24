import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { MerchantKnowledge } from "../knowledge/types.ts";
import type { CategoryDefinition } from "../knowledge/types.ts";

export type ToolContext = {
  allTransactions: MonarchTransaction[];
  knowledgeBase: Map<string, MerchantKnowledge>;
  categoryDefinitions: CategoryDefinition[];
};

export const TIER3_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "merchant_history",
    description:
      "Look up how a merchant has been categorized historically. Returns category distribution and transaction count.",
    input_schema: {
      type: "object" as const,
      properties: {
        merchant_name: {
          type: "string",
          description: "The merchant name to look up",
        },
      },
      required: ["merchant_name"],
    },
  },
  {
    name: "nearby_transactions",
    description:
      "Find transactions near a given date (within 3 days) to provide temporal context. Useful for understanding what a payment might be for based on surrounding transactions.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "The date to search around (YYYY-MM-DD format)",
        },
        days_range: {
          type: "number",
          description: "Number of days before and after to search (default: 3)",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "category_info",
    description:
      "Get detailed information about a category including its description, examples, and what does NOT belong in it.",
    input_schema: {
      type: "object" as const,
      properties: {
        category_name: {
          type: "string",
          description: "The category name to look up",
        },
      },
      required: ["category_name"],
    },
  },
];

const MerchantHistoryInput = z.object({ merchant_name: z.string() });
const NearbyTransactionsInput = z.object({ date: z.string(), days_range: z.number().optional() });
const CategoryInfoInput = z.object({ category_name: z.string() });

export function handleToolCall(
  toolName: string,
  input: unknown,
  context: ToolContext,
): string {
  switch (toolName) {
    case "merchant_history": {
      const parsed = MerchantHistoryInput.safeParse(input);
      if (!parsed.success) return `Invalid input: ${parsed.error.message}`;
      return handleMerchantHistory(parsed.data.merchant_name, context);
    }
    case "nearby_transactions": {
      const parsed = NearbyTransactionsInput.safeParse(input);
      if (!parsed.success) return `Invalid input: ${parsed.error.message}`;
      return handleNearbyTransactions(parsed.data.date, parsed.data.days_range ?? 3, context);
    }
    case "category_info": {
      const parsed = CategoryInfoInput.safeParse(input);
      if (!parsed.success) return `Invalid input: ${parsed.error.message}`;
      return handleCategoryInfo(parsed.data.category_name, context);
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}

function handleMerchantHistory(
  merchantName: string,
  context: ToolContext,
): string {
  const lower = merchantName.toLowerCase();

  // Check KB first
  const kb = context.knowledgeBase.get(lower);
  if (kb) {
    const historyStr =
      kb.categoryHistory.length > 0
        ? kb.categoryHistory
            .map((h) => `${h.categoryName}: ${String(h.count)} times`)
            .join(", ")
        : "no history";
    return `Merchant: ${kb.merchantName}\nType: ${kb.merchantType}\nDescription: ${kb.description}\nMulti-category: ${String(kb.multiCategory)}\nDefault category: ${kb.defaultCategory?.name ?? "none"}\nHistory: ${historyStr}\nSource: ${kb.source}\nConfidence: ${kb.confidence}`;
  }

  // Fall back to transaction history
  const txns = context.allTransactions.filter(
    (t) => t.merchant.name.toLowerCase() === lower,
  );

  if (txns.length === 0) {
    return `No transactions found for merchant "${merchantName}".`;
  }

  const catCounts = new Map<string, number>();
  for (const t of txns) {
    catCounts.set(t.category.name, (catCounts.get(t.category.name) ?? 0) + 1);
  }

  const sorted = [...catCounts.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([cat, count]) => `${cat}: ${String(count)} times`)
    .join(", ");

  return `Merchant: ${merchantName}\nTotal transactions: ${String(txns.length)}\nCategory distribution: ${sorted}`;
}

function handleNearbyTransactions(
  dateStr: string,
  daysRange: number,
  context: ToolContext,
): string {
  const targetDate = new Date(dateStr + "T00:00:00");
  const rangeMs = daysRange * 24 * 60 * 60 * 1000;

  const nearby = context.allTransactions.filter((t) => {
    const txnDate = new Date(t.date + "T00:00:00");
    return Math.abs(txnDate.getTime() - targetDate.getTime()) <= rangeMs;
  });

  if (nearby.length === 0) {
    return `No transactions found within ${String(daysRange)} days of ${dateStr}.`;
  }

  const lines = nearby
    .slice(0, 20) // Limit output
    .map((t) => {
      const sign = t.amount < 0 ? "-" : "+";
      return `${t.date} | ${sign}$${Math.abs(t.amount).toFixed(2)} | ${t.merchant.name} | ${t.category.name}`;
    })
    .join("\n");

  return `Transactions within ${String(daysRange)} days of ${dateStr} (${String(nearby.length)} total, showing up to 20):\n${lines}`;
}

function handleCategoryInfo(
  categoryName: string,
  context: ToolContext,
): string {
  const lower = categoryName.toLowerCase();
  const def = context.categoryDefinitions.find(
    (d) => d.name.toLowerCase() === lower,
  );

  if (!def) {
    return `Category "${categoryName}" not found. Available categories: ${context.categoryDefinitions.map((d) => d.name).join(", ")}`;
  }

  let text = `Category: ${def.name} (${def.group})\nDescription: ${def.description}`;
  if (def.examples.length > 0) {
    text += `\nExamples: ${def.examples.join(", ")}`;
  }
  if (def.notThisCategory.length > 0) {
    text += `\nNOT this category: ${def.notThisCategory.join("; ")}`;
  }
  return text;
}
