import { z } from "zod";
import type { MonarchCategory } from "../monarch/types.ts";
import type { EnrichedTransaction } from "../enrichment/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import type { ProposedChange, ProposedSplit } from "./types.ts";
import type { CategoryDefinition } from "../knowledge/types.ts";
import { callClaudeAndParse } from "./claude.ts";
import { computeSplits } from "./claude.ts";
import { formatCategoryDefinitions } from "../knowledge/definitions.ts";
import { log } from "../logger.ts";

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
      splits: z
        .array(
          z.object({
            itemName: z.string(),
            amount: z.number(),
            categoryId: z.string(),
            categoryName: z.string(),
          }),
        )
        .optional(),
    }),
  ),
});

function formatEnrichmentContext(
  enrichment: TransactionEnrichment | undefined,
): string {
  if (!enrichment) return "";

  const parts: string[] = [];

  if (enrichment.items && enrichment.items.length > 0) {
    const itemList = enrichment.items
      .map((i) => `"${i.title}" ($${i.price.toFixed(2)})`)
      .join(", ");
    parts.push(`Items: ${itemList}`);
  }

  if (enrichment.paymentNote !== undefined && enrichment.paymentNote !== "") {
    const dir = enrichment.paymentDirection ?? "unknown";
    const party = enrichment.paymentCounterparty ?? "unknown";
    parts.push(`Venmo ${dir} ${party}: "${enrichment.paymentNote}"`);
  }

  if (enrichment.billBreakdown && enrichment.billBreakdown.length > 0) {
    const breakdown = enrichment.billBreakdown
      .map((b) => `${b.serviceType}: $${b.amount.toFixed(2)}`)
      .join(", ");
    parts.push(`Bill breakdown: ${breakdown}`);
  }

  if (enrichment.receiptItems && enrichment.receiptItems.length > 0) {
    const items = enrichment.receiptItems
      .map(
        (i) =>
          `"${i.title}" ($${i.price.toFixed(2)}${i.isSubscription ? ", subscription" : ""})`,
      )
      .join(", ");
    parts.push(`Receipt items: ${items}`);
  }

  if (enrichment.insuranceLines && enrichment.insuranceLines.length > 0) {
    const lines = enrichment.insuranceLines
      .map((l) => `${l.policyType}: $${l.amount.toFixed(2)}`)
      .join(", ");
    parts.push(`Insurance: ${lines}`);
  }

  if (enrichment.billingPeriods && enrichment.billingPeriods.length > 0) {
    const periods = enrichment.billingPeriods
      .map((p) => `${p.period}: $${p.amount.toFixed(2)}`)
      .join(", ");
    parts.push(`Billing periods: ${periods}`);
  }

  if (
    enrichment.merchantDescription !== undefined &&
    enrichment.merchantDescription !== ""
  ) {
    parts.push(`Merchant: ${enrichment.merchantDescription}`);
  }

  if (parts.length === 0) return "";
  return ` | Enrichment: ${parts.join(" | ")}`;
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
      "splits": []
    }
  ]
}

When shouldSplit is true, the categoryId/categoryName should be the primary category, and splits should contain the breakdown.`;
}

export async function classifyTier2(
  _categories: MonarchCategory[],
  definitions: CategoryDefinition[],
  transactions: EnrichedTransaction[],
  batchSize: number,
): Promise<ProposedChange[]> {
  const changes: ProposedChange[] = [];

  const batches: EnrichedTransaction[][] = [];
  for (let i = 0; i < transactions.length; i += batchSize) {
    batches.push(transactions.slice(i, i + batchSize));
  }

  const concurrency = 3;
  let completed = 0;

  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (batch) => {
        const prompt = buildTier2Prompt(definitions, batch);
        const result = await callClaudeAndParse(
          prompt,
          Tier2ClassificationSchema,
        );
        return { batch, result };
      }),
    );

    for (const { batch, result } of results) {
      for (const classification of result.transactions) {
        const enriched = batch[classification.transactionIndex];
        if (!enriched) continue;
        const txn = enriched.transaction;

        const isSplit =
          classification.shouldSplit &&
          classification.splits !== undefined &&
          classification.splits.length > 1;

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
      completed += batch.length;
    }
    log.progress(completed, transactions.length, "tier 2 classified");
  }

  log.info(
    `Tier 2: ${String(changes.length)} changes from ${String(transactions.length)} transactions`,
  );

  return changes;
}
