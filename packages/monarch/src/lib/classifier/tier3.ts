import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { MonarchCategory } from "../monarch/types.ts";
import type { EnrichedTransaction } from "../enrichment/types.ts";
import type { ProposedChange } from "./types.ts";
import type { CategoryDefinition, MerchantKnowledge } from "../knowledge/types.ts";
import { formatCategoryDefinitions } from "../knowledge/definitions.ts";
import { TIER3_TOOLS, handleToolCall } from "./tools.ts";
import type { ToolContext } from "./tools.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import { getClient, getModelId, getTracker, isWebSearchEnabled } from "./claude.ts";
import { log } from "../logger.ts";

const Tier3ResultSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
});

function buildTier3Prompt(
  definitions: CategoryDefinition[],
  enriched: EnrichedTransaction,
): string {
  const txn = enriched.transaction;
  const sign = txn.amount < 0 ? "-" : "+";
  const amount = `${sign}$${Math.abs(txn.amount).toFixed(2)}`;
  const bankDesc = txn.plaidName === "" ? "" : ` | bank: "${txn.plaidName}"`;
  const acct = ` | acct: ${txn.account.displayName}`;
  const notes = txn.notes === "" ? "" : ` | notes: "${txn.notes}"`;
  const recurring = txn.isRecurring ? " | recurring" : "";

  const categoryText = formatCategoryDefinitions(definitions);

  return `Classify this transaction. It has a cryptic or unknown merchant name, so use the available tools to research it.

Transaction:
  ${txn.date} | ${amount} | ${txn.merchant.name}${bankDesc}${acct}${notes}${recurring}
  Current category: ${txn.category.name}

Available categories:
${categoryText}

Steps:
1. Use merchant_history to check if this merchant has been categorized before
2. Use nearby_transactions to see what other transactions happened around the same time
3. If still unsure, use web_search to research the merchant
4. Use category_info if you need to clarify what belongs in a specific category

Respond with ONLY this JSON (no other text):
{
  "categoryId": "...",
  "categoryName": "...",
  "confidence": "high"|"medium"|"low",
  "reason": "brief explanation"
}`;
}

function jitteredDelay(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * baseMs * 0.5);
}

type Tier3Options = {
  categories: MonarchCategory[];
  definitions: CategoryDefinition[];
  transactions: EnrichedTransaction[];
  allTransactions: MonarchTransaction[];
  knowledgeBase: Map<string, MerchantKnowledge>;
};

export async function classifyTier3(
  options: Tier3Options,
): Promise<ProposedChange[]> {
  const { definitions, transactions, allTransactions, knowledgeBase } = options;
  const changes: ProposedChange[] = [];

  const toolContext: ToolContext = {
    allTransactions,
    knowledgeBase,
    categoryDefinitions: definitions,
  };

  // Process tier 3 transactions sequentially to avoid rate limits
  for (let i = 0; i < transactions.length; i++) {
    const enriched = transactions[i];
    if (!enriched) continue;

    log.progress(i + 1, transactions.length, "tier 3 classified");

    const result = await classifySingleTier3(
      definitions,
      enriched,
      toolContext,
    );

    if (result && result.categoryId !== enriched.transaction.category.id) {
      changes.push({
        transactionId: enriched.transaction.id,
        transactionDate: enriched.transaction.date,
        merchantName: enriched.transaction.merchant.name,
        amount: enriched.transaction.amount,
        currentCategory: enriched.transaction.category.name,
        currentCategoryId: enriched.transaction.category.id,
        proposedCategory: result.categoryName,
        proposedCategoryId: result.categoryId,
        confidence: result.confidence,
        type: "recategorize",
        reason: result.reason,
        tier: 3,
      });
    }
  }

  log.info(
    `Tier 3: ${String(changes.length)} changes from ${String(transactions.length)} transactions`,
  );

  return changes;
}

type Tier3Result = z.infer<typeof Tier3ResultSchema>;

function buildTools(): Anthropic.Messages.ToolUnion[] {
  const tools: Anthropic.Messages.ToolUnion[] = [...TIER3_TOOLS];
  if (isWebSearchEnabled()) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 3,
    });
  }
  return tools;
}

function processToolUseBlocks(
  response: Anthropic.Messages.Message,
  toolContext: ToolContext,
): Anthropic.Messages.ToolResultBlockParam[] {
  const results: Anthropic.Messages.ToolResultBlockParam[] = [];
  for (const block of response.content) {
    if (block.type !== "tool_use") continue;
    const result = handleToolCall(block.name, block.input, toolContext);
    results.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: result,
    });
  }
  return results;
}

function extractJsonFromText(text: string): string {
  let cleaned = text.trim();
  const fenceMatch =
    /```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/.exec(cleaned);
  if (fenceMatch?.[1] !== undefined && fenceMatch[1] !== "") {
    cleaned = fenceMatch[1].trim();
  }
  if (!cleaned.startsWith("{")) {
    const jsonStart = cleaned.indexOf("{");
    if (jsonStart !== -1) cleaned = cleaned.slice(jsonStart);
  }
  return cleaned;
}

async function runToolLoop(
  messages: Anthropic.Messages.MessageParam[],
  tools: Anthropic.Messages.ToolUnion[],
  toolContext: ToolContext,
): Promise<Tier3Result | undefined> {
  const claude = getClient();
  const modelId = getModelId();
  const tracker = getTracker();
  const maxToolRounds = 5;

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await claude.messages.create({
      model: modelId,
      max_tokens: 4096,
      system:
        "You are a personal finance categorization expert. Use the tools available to research unknown merchants before classifying. Always respond with valid JSON when you have enough information.",
      messages,
      tools,
    });

    tracker?.record(
      response.usage.input_tokens,
      response.usage.output_tokens,
    );

    const hasToolUse = response.content.some((b) => b.type === "tool_use");

    if (hasToolUse) {
      messages.push({ role: "assistant", content: response.content });
      const toolResults = processToolUseBlocks(response, toolContext);
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Extract text response
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("");

    if (text === "") return undefined;

    const cleaned = extractJsonFromText(text);
    const parsed: unknown = JSON.parse(cleaned);
    return Tier3ResultSchema.parse(parsed);
  }

  return undefined;
}

async function classifySingleTier3(
  definitions: CategoryDefinition[],
  enriched: EnrichedTransaction,
  toolContext: ToolContext,
): Promise<Tier3Result | undefined> {
  const maxRetries = 3;
  const tools = buildTools();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const messages: Anthropic.Messages.MessageParam[] = [
        { role: "user", content: buildTier3Prompt(definitions, enriched) },
      ];

      return await runToolLoop(messages, tools, toolContext);
    } catch (error: unknown) {
      if (error instanceof Anthropic.APIError && attempt < maxRetries) {
        const status = Number(error.status);
        if (status === 429 || status === 529 || status >= 500) {
          const delay = jitteredDelay(1000 * 2 ** attempt);
          log.warn(
            `Tier 3 API error (${String(status)}), retrying in ${String(Math.round(delay / 1000))}s...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      log.error(
        `Tier 3 classification failed for ${enriched.transaction.merchant.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  return undefined;
}
