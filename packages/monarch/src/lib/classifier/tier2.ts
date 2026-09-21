import { z } from "zod";
import type { EnrichedTransaction } from "../enrichment/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import type { ProposedChange, ProposedSplit } from "./types.ts";
import type { CategoryDefinition } from "../knowledge/types.ts";
import {
  callLlmAndParseWithUsage,
  getModelId,
  getTracker,
  isWebSearchEnabled,
} from "./llm.ts";
import { computeSplits } from "./llm.ts";
import { formatCategoryDefinitions } from "../knowledge/definitions.ts";
import { log } from "../logger.ts";
import {
  buildTier2CheckpointBatch,
  getTier2BatchKey,
  getTier2PromptHash,
  loadTier2Checkpoint,
  type Tier2CheckpointStore,
  type TokenUsage,
} from "./tier2-checkpoint.ts";

function buildSplitChange(
  txn: {
    id: string;
    date: string;
    merchant: { name: string };
    amount: number;
    category: { name: string; id: string };
  },
  classification: {
    confidence: "high" | "medium" | "low";
    splits?:
      | {
          itemName: string;
          amount: number;
          categoryId: string;
          categoryName: string;
        }[]
      | undefined;
  },
  enrichmentSource: string | undefined,
): ProposedChange {
  const splitItems = (classification.splits ?? []).map((s) => ({
    amount: s.amount,
    categoryId: s.categoryId,
    itemName: s.itemName,
    categoryName: s.categoryName,
  }));

  const proratedSplits = computeSplits(txn.amount, splitItems);
  const splits: ProposedSplit[] = proratedSplits.map((s) => ({
    itemName: s.itemName,
    amount: s.amount,
    categoryId: s.categoryId,
    categoryName: s.categoryName,
  }));

  return {
    transactionId: txn.id,
    transactionDate: txn.date,
    merchantName: txn.merchant.name,
    amount: txn.amount,
    currentCategory: txn.category.name,
    currentCategoryId: txn.category.id,
    proposedCategory: "SPLIT",
    proposedCategoryId: "",
    confidence: classification.confidence,
    type: "split",
    splits,
    tier: 2,
    enrichmentSource,
  };
}

const Tier2ClassificationSchema = z.object({
  transactions: z.array(
    z.object({
      transactionIndex: z.number(),
      categoryId: z.string(),
      categoryName: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      shouldSplit: z.boolean(),
      // OpenAI strict structured outputs reject optional properties, so the
      // schema states the prompt's actual contract: every split carries all
      // four fields and splits is [] when shouldSplit is false.
      splits: z.array(
        z
          .object({
            itemName: z.string(),
            amount: z.number(),
            categoryId: z.string(),
            categoryName: z.string(),
          })
          .transform((s) => ({
            ...s,
            itemName: s.itemName === "" ? s.categoryName : s.itemName,
          })),
      ),
    }),
  ),
});

type Tier2ClassificationResult = z.infer<typeof Tier2ClassificationSchema>;

export type Tier2ClassifierResult = {
  result: Tier2ClassificationResult;
  usage: TokenUsage | undefined;
};

export type Tier2Classifier = (
  prompt: string,
) => Promise<Tier2ClassifierResult>;

export type Tier2Options = {
  checkpointFile?: string | undefined;
  classifier?: Tier2Classifier | undefined;
};

export type ClassifyTier2Params = {
  definitions: CategoryDefinition[];
  transactions: EnrichedTransaction[];
  batchSize: number;
  checkpointFile?: string | undefined;
  classifier?: Tier2Classifier | undefined;
};

type Tier2BatchWork = {
  batchNumber: number;
  batch: EnrichedTransaction[];
  prompt: string;
  promptHash: string;
  transactionIds: string[];
  checkpointKey: string;
};

// One renderer per enrichment field. A list keeps a new source to one entry
// rather than another branch in a function every source has to grow.
type EnrichmentRenderer = (e: TransactionEnrichment) => string | undefined;

function labelledAmounts<T extends { amount: number }>(
  label: string,
  lines: T[] | undefined,
  name: (line: T) => string,
): string | undefined {
  if (lines === undefined || lines.length === 0) return undefined;
  const rendered = lines
    .map((line) => `${name(line)}: $${line.amount.toFixed(2)}`)
    .join(", ");
  return `${label}: ${rendered}`;
}

const ENRICHMENT_RENDERERS: EnrichmentRenderer[] = [
  // Period and totals only: no employer identifiers or line-item detail
  // reach the model.
  (e) =>
    e.payslip === undefined
      ? undefined
      : `Payroll ${e.payslip.periodStart}..${e.payslip.periodEnd}: gross $${e.payslip.grossPay.toFixed(2)}, net $${e.payslip.netPay.toFixed(2)}`,
  (e) =>
    e.vest === undefined
      ? undefined
      : `RSU vest ${e.vest.vestDate}: ${String(e.vest.shares)} ${e.vest.symbol} shares released at $${e.vest.fairMarketValue.toFixed(2)}, ${String(e.vest.netShares)} deposited after tax withholding. No cash moved.`,
  (e) =>
    e.loan === undefined
      ? undefined
      : `Loan ${e.loan.loanId}: $${e.loan.principal.toFixed(2)} principal + $${e.loan.interest.toFixed(2)} interest, $${e.loan.balanceAfter.toFixed(2)} still owed`,
  (e) =>
    e.items === undefined || e.items.length === 0
      ? undefined
      : `Items: ${e.items.map((i) => `"${i.title}" ($${i.price.toFixed(2)})`).join(", ")}`,
  (e) =>
    e.paymentNote === undefined || e.paymentNote === ""
      ? undefined
      : `Venmo ${e.paymentDirection ?? "unknown"} ${e.paymentCounterparty ?? "unknown"}: "${e.paymentNote}"`,
  (e) =>
    labelledAmounts("Bill breakdown", e.billBreakdown, (b) => b.serviceType),
  (e) =>
    e.receiptItems === undefined || e.receiptItems.length === 0
      ? undefined
      : `Receipt items: ${e.receiptItems
          .map(
            (i) =>
              `"${i.title}" ($${i.price.toFixed(2)}${i.isSubscription ? ", subscription" : ""})`,
          )
          .join(", ")}`,
  (e) => labelledAmounts("Insurance", e.insuranceLines, (l) => l.policyType),
  (e) => labelledAmounts("Billing periods", e.billingPeriods, (p) => p.period),
  (e) =>
    e.merchantDescription === undefined || e.merchantDescription === ""
      ? undefined
      : `Merchant: ${e.merchantDescription}`,
];

function formatEnrichmentContext(
  enrichment: TransactionEnrichment | undefined,
): string {
  if (!enrichment) return "";
  const parts = ENRICHMENT_RENDERERS.map((render) => render(enrichment)).filter(
    (part) => part !== undefined,
  );
  return parts.length === 0 ? "" : ` | Enrichment: ${parts.join(" | ")}`;
}

function buildTier2Prompt(
  definitions: CategoryDefinition[],
  batch: EnrichedTransaction[],
): string {
  const categoryText = formatCategoryDefinitions(definitions);

  const txnList = batch
    .map((enriched, idx) => {
      const txn = enriched.transaction;
      const sign = txn.amount < 0 ? "-" : "+";
      const amount = `${sign}$${Math.abs(txn.amount).toFixed(2)}`;
      const bankDesc =
        txn.plaidName === "" ? "" : ` | bank: "${txn.plaidName}"`;
      const acct = ` | acct: ${txn.account.displayName}`;
      const current = ` | current: ${txn.category.name}`;
      const enrichmentCtx = formatEnrichmentContext(enriched.enrichment);

      return `  [#${String(idx)}] ${txn.date} | ${amount} | ${txn.merchant.name}${bankDesc}${acct}${current}${enrichmentCtx}`;
    })
    .join("\n");

  return `Classify each transaction into the most appropriate category. Use enrichment data when available to make more accurate decisions.

IMPORTANT:
- If a transaction has item-level enrichment with items from DIFFERENT categories, set shouldSplit=true and provide splits with item names, amounts, and categories.
- If all items belong to the same category, set shouldSplit=false.
- For bill breakdowns (rent+utilities), propose a split with each service as a separate line.
- For insurance with multiple policy types, propose a split.
- Always respond with valid JSON (no markdown fences).

Available categories:
${categoryText}

Transactions to classify:
${txnList}

Respond with JSON:
{
  "transactions": [
    {
      "transactionIndex": 0,
      "categoryId": "...",
      "categoryName": "...",
      "confidence": "high"|"medium"|"low",
      "shouldSplit": false,
      "splits": [
        {
          "itemName": "<short human-readable description of this line item>",
          "amount": 12.34,
          "categoryId": "...",
          "categoryName": "..."
        }
      ]
    }
  ]
}

When shouldSplit is true:
- The top-level categoryId/categoryName should be the primary category for the transaction.
- The "splits" array MUST contain the breakdown, and each split MUST include all four fields: itemName, amount, categoryId, categoryName.
- itemName is required for every split — use the source item title, bill line, or a concise description.
When shouldSplit is false, set "splits" to an empty array [].`;
}

function buildChangesFromResult(
  batch: EnrichedTransaction[],
  result: Tier2ClassificationResult,
): ProposedChange[] {
  const changes: ProposedChange[] = [];

  for (const classification of result.transactions) {
    const enriched = batch[classification.transactionIndex];
    if (!enriched) continue;
    const txn = enriched.transaction;

    const isSplit =
      classification.shouldSplit && classification.splits.length > 1;

    if (isSplit) {
      changes.push(
        buildSplitChange(
          txn,
          classification,
          enriched.enrichment?.enrichmentSource,
        ),
      );
    } else if (classification.categoryId !== txn.category.id) {
      changes.push({
        transactionId: txn.id,
        transactionDate: txn.date,
        merchantName: txn.merchant.name,
        amount: txn.amount,
        currentCategory: txn.category.name,
        currentCategoryId: txn.category.id,
        proposedCategory: classification.categoryName,
        proposedCategoryId: classification.categoryId,
        confidence: classification.confidence,
        type: "recategorize",
        tier: 2,
        enrichmentSource: enriched.enrichment?.enrichmentSource,
      });
    }
  }

  return changes;
}

async function defaultTier2Classifier(
  prompt: string,
): Promise<Tier2ClassifierResult> {
  return callLlmAndParseWithUsage(prompt, Tier2ClassificationSchema);
}

function buildBatchWorkItems(
  definitions: CategoryDefinition[],
  transactions: EnrichedTransaction[],
  batchSize: number,
): Tier2BatchWork[] {
  const batches: EnrichedTransaction[][] = [];
  for (let i = 0; i < transactions.length; i += batchSize) {
    batches.push(transactions.slice(i, i + batchSize));
  }

  return batches.map((batch, index) => {
    const prompt = buildTier2Prompt(definitions, batch);
    const transactionIds = batch.map((enriched) => enriched.transaction.id);
    return {
      batchNumber: index + 1,
      batch,
      prompt,
      promptHash: getTier2PromptHash(prompt),
      transactionIds,
      checkpointKey: getTier2BatchKey({
        prompt,
        model: getModelId(),
        batchSize,
        webSearchEnabled: isWebSearchEnabled(),
        transactionIds,
      }),
    };
  });
}

function recordRecoveredUsage(usage: TokenUsage | undefined): void {
  if (usage === undefined) return;
  getTracker()?.recordCached(usage.inputTokens, usage.outputTokens);
}

function describeThrownValue(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "Unknown non-error throw";
  }
}

async function classifyBatchWithCheckpoint(params: {
  work: Tier2BatchWork;
  classifier: Tier2Classifier;
  checkpoint: Tier2CheckpointStore | undefined;
  batchSize: number;
  totalBatches: number;
}): Promise<{ changes: ProposedChange[]; fromCheckpoint: boolean }> {
  const { work, classifier, checkpoint, batchSize, totalBatches } = params;
  const cached = checkpoint?.get(work.checkpointKey);
  if (cached !== undefined) {
    recordRecoveredUsage(cached.usage);
    return { changes: cached.changes, fromCheckpoint: true };
  }

  const { result, usage } = await classifier(work.prompt);
  const changes = buildChangesFromResult(work.batch, result);

  if (checkpoint !== undefined) {
    await checkpoint.set(
      work.checkpointKey,
      buildTier2CheckpointBatch({
        transactionIds: work.transactionIds,
        model: getModelId(),
        batchSize,
        promptHash: work.promptHash,
        changes,
        usage,
      }),
    );
    log.info(
      `Saved Tier 2 checkpoint batch ${String(work.batchNumber)}/${String(totalBatches)}`,
    );
  }

  return { changes, fromCheckpoint: false };
}

export async function classifyTier2(
  params: ClassifyTier2Params,
): Promise<ProposedChange[]> {
  const changes: ProposedChange[] = [];
  const {
    definitions,
    transactions,
    batchSize,
    checkpointFile,
    classifier: configuredClassifier,
  } = params;

  const batchWorkItems = buildBatchWorkItems(
    definitions,
    transactions,
    batchSize,
  );
  const classifier = configuredClassifier ?? defaultTier2Classifier;
  const checkpoint =
    checkpointFile === undefined
      ? undefined
      : await loadTier2Checkpoint(checkpointFile);

  if (checkpoint !== undefined) {
    const skipped = batchWorkItems.filter(
      (work) => checkpoint.get(work.checkpointKey) !== undefined,
    ).length;
    log.info(
      `Loaded ${String(checkpoint.size())} completed Tier 2 batches from checkpoint`,
    );
    log.info(
      `Skipped ${String(skipped)}/${String(batchWorkItems.length)} Tier 2 batches from checkpoint`,
    );
  }

  const concurrency = 3;
  let completed = 0;

  for (let i = 0; i < batchWorkItems.length; i += concurrency) {
    const chunk = batchWorkItems.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map((work) =>
        classifyBatchWithCheckpoint({
          work,
          classifier,
          checkpoint,
          batchSize,
          totalBatches: batchWorkItems.length,
        }),
      ),
    );

    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        changes.push(...result.value.changes);
      } else {
        failures.push(result.reason);
      }
    }

    completed += chunk
      .filter((_, index) => results[index]?.status === "fulfilled")
      .reduce((sum, work) => sum + work.batch.length, 0);
    log.progress(completed, transactions.length, "tier 2 classified");

    if (failures.length === 1) {
      const failure = failures[0];
      if (failure instanceof Error) throw failure;
      throw new Error(describeThrownValue(failure));
    }

    if (failures.length > 1) {
      const failureDescriptions = failures
        .map(
          (failure, index) =>
            `${String(index + 1)}. ${describeThrownValue(failure)}`,
        )
        .join("\n");
      throw new Error(
        `Tier 2 classification failed for ${String(failures.length)} batches:\n${failureDescriptions}`,
      );
    }
  }

  log.info(
    `Tier 2: ${String(changes.length)} changes from ${String(transactions.length)} transactions`,
  );

  return changes;
}
