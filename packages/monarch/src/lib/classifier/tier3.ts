import { stepCountIs, ToolLoopAgent } from "ai";
import {
  generateValidatedObject,
  StructuredOutputUsageError,
  openRouterWebSearchTool,
  type GenerateValidatedObjectResult,
} from "@shepherdjerred/llm-runtime";
import { z } from "zod";
import type { MonarchCategory } from "../monarch/types.ts";
import type { EnrichedTransaction } from "../enrichment/types.ts";
import type { ProposedChange } from "./types.ts";
import type {
  CategoryDefinition,
  MerchantKnowledge,
} from "../knowledge/types.ts";
import { formatCategoryDefinitions } from "../knowledge/definitions.ts";
import { createTier3Tools } from "./tools.ts";
import type { ToolContext } from "./tools.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import {
  getModelId,
  getRuntime,
  getTracker,
  isWebSearchEnabled,
} from "./llm.ts";
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

/**
 * Per-run tier-3 failure counts by reason, surfaced in the end-of-run
 * summary so silent classification losses are visible.
 */
const tier3Failures: Record<string, number> = {};

function recordTier3Failure(reason: string): void {
  tier3Failures[reason] = (tier3Failures[reason] ?? 0) + 1;
}

export function getTier3FailureCounts(): Record<string, number> {
  return { ...tier3Failures };
}

async function runToolLoop(
  prompt: string,
  toolContext: ToolContext,
): Promise<Tier3Result> {
  const openRouter = getRuntime();
  const modelId = getModelId();
  const tracker = getTracker();
  const localTools = createTier3Tools(toolContext);
  const tools = isWebSearchEnabled()
    ? {
        ...localTools,
        web_search: openRouterWebSearchTool(openRouter, 3),
      }
    : localTools;
  const agent = new ToolLoopAgent({
    id: "monarch-tier3-research",
    instructions:
      "Research the transaction with the available tools. Build concise evidence for a later structured finalizer; do not rely on prose JSON parsing.",
    model: isWebSearchEnabled()
      ? openRouter.languageModel(modelId, ["tools", "webSearch"])
      : openRouter.languageModel(modelId, ["tools"]),
    tools,
    stopWhen: stepCountIs(5),
    maxOutputTokens: 4096,
    ...openRouter.callOptions({ workload: "monarch.tier3.tool-loop" }),
  });
  const research = await agent.generate({ prompt });
  const researchInputTokens = research.usage.inputTokens ?? 0;
  const researchOutputTokens = research.usage.outputTokens ?? 0;
  tracker?.record(researchInputTokens, researchOutputTokens);
  const evidence = JSON.stringify(
    research.steps.map((step) => ({
      text: step.text,
      toolCalls: step.toolCalls,
      toolResults: step.toolResults,
      finishReason: step.finishReason,
    })),
  ).slice(-60_000);
  const finalized = await finalizeTier3({
    runtime: openRouter,
    modelId,
    tracker,
    prompt,
    evidence,
  });
  return finalized.object;
}

/**
 * Runs the structured finalizer and records its usage on both outcomes. Every
 * semantic attempt is billable, and `classifySingleTier3` swallows the
 * exhaustion error to keep processing the run, so charging only the success
 * path would leave the end-of-run usage and estimated-cost summary silently
 * missing every attempt spent on transactions that failed to classify.
 */
export async function finalizeTier3(input: {
  runtime: ReturnType<typeof getRuntime>;
  modelId: string;
  tracker: ReturnType<typeof getTracker>;
  prompt: string;
  evidence: string;
}): Promise<GenerateValidatedObjectResult<typeof Tier3ResultSchema>> {
  try {
    const finalized = await generateValidatedObject(input.runtime, {
      model: input.modelId,
      schema: Tier3ResultSchema,
      schemaName: "monarch_tier3_classification",
      system:
        "Classify the transaction using only the recorded tool evidence. Return the exact requested structured result.",
      prompt: `${input.prompt}\n\nRecorded tool evidence:\n${input.evidence}`,
      workload: "monarch.tier3.finalize",
      maxOutputTokens: 4096,
    });
    input.tracker?.record(
      finalized.usage.tokens.input,
      finalized.usage.tokens.output,
    );
    return finalized;
  } catch (error: unknown) {
    if (error instanceof StructuredOutputUsageError) {
      input.tracker?.record(
        error.usage.tokens.input,
        error.usage.tokens.output,
      );
    }
    throw error;
  }
}

async function classifySingleTier3(
  definitions: CategoryDefinition[],
  enriched: EnrichedTransaction,
  toolContext: ToolContext,
): Promise<Tier3Result | undefined> {
  try {
    return await runToolLoop(
      buildTier3Prompt(definitions, enriched),
      toolContext,
    );
  } catch (error: unknown) {
    recordTier3Failure("classification_error");
    log.error(
      `Tier 3 classification failed for ${enriched.transaction.merchant.name} (txn ${enriched.transaction.id}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
