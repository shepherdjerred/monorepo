import {
  setToken,
  getTransactions,
  getTransactionCategories,
  updateTransaction,
  updateTransactionSplits,
} from "monarch-money-api";
import path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type {
  MonarchCategory,
  MerchantGroup,
} from "./types.ts";
import {
  MonarchTransactionSchema,
} from "./types.ts";
import type { MonarchTransaction } from "./types.ts";
import { log } from "../logger.ts";

const TxnCacheSchema = z.object({
  cachedAt: z.string(),
  transactions: z.array(MonarchTransactionSchema),
});

const CACHE_DIR = path.join(homedir(), ".monarch-cache");
const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

export function initMonarch(token: string): void {
  setToken(token);
}

function txnCachePath(startDate: string, endDate: string): string {
  return path.join(CACHE_DIR, `transactions-${startDate}-${endDate}.json`);
}

async function loadTxnCache(
  startDate: string,
  endDate: string,
): Promise<MonarchTransaction[] | null> {
  const cachePath = txnCachePath(startDate, endDate);
  const file = Bun.file(cachePath);
  if (!(await file.exists())) return null;

  const raw: unknown = await file.json();
  const parsed = TxnCacheSchema.parse(raw);
  const age = Date.now() - new Date(parsed.cachedAt).getTime();

  if (age > CACHE_MAX_AGE_MS) {
    log.info("Transaction cache expired, will re-fetch");
    return null;
  }

  log.info(`Loaded ${String(parsed.transactions.length)} transactions from cache (${String(Math.round(age / 60_000))}m old)`);
  return parsed.transactions;
}

async function saveTxnCache(
  startDate: string,
  endDate: string,
  transactions: MonarchTransaction[],
): Promise<void> {
  const cachePath = txnCachePath(startDate, endDate);
  await Bun.write(
    cachePath,
    JSON.stringify({ cachedAt: new Date().toISOString(), transactions }, null, 2),
  );
  log.info(`Cached ${String(transactions.length)} transactions`);
}

export async function fetchAllTransactions(
  startDate: string,
  endDate: string,
  forceFetch = false,
): Promise<MonarchTransaction[]> {
  if (!forceFetch) {
    const cached = await loadTxnCache(startDate, endDate);
    if (cached) return cached;
  }

  const pageSize = 100;
  const allTransactions: MonarchTransaction[] = [];
  let offset = 0;
  let totalCount = Infinity;

  while (offset < totalCount) {
    log.progress(offset, totalCount, "transactions fetched");
    const response = await getTransactions({
      limit: pageSize,
      offset,
      startDate,
      endDate,
    });

    totalCount = response.allTransactions.totalCount;
    const results = response.allTransactions.results;
    allTransactions.push(...results);
    offset += pageSize;

    if (results.length < pageSize) break;
  }

  log.info(`Fetched ${String(allTransactions.length)} transactions total`);
  await saveTxnCache(startDate, endDate, allTransactions);
  return allTransactions;
}

export async function fetchCategories(): Promise<MonarchCategory[]> {
  const response = await getTransactionCategories();
  return response.categories.filter((c) => !c.isDisabled);
}

export async function applyCategory(
  transactionId: string,
  categoryId: string,
): Promise<void> {
  await updateTransaction({ transactionId, categoryId });
  await sleep(200);
}

export async function flagForReview(transactionId: string): Promise<void> {
  await updateTransaction({ transactionId, needsReview: true });
  await sleep(200);
}

export async function applySplits(
  transactionId: string,
  splits: {
    merchantName?: string;
    amount: number;
    categoryId: string;
    notes?: string;
  }[],
): Promise<void> {
  await updateTransactionSplits(transactionId, splits);
  await sleep(200);
}

const AMAZON_MERCHANT_PATTERNS = [
  "amazon",
  "amzn",
  "amazon.com",
  "amzn mktp",
  "amazon prime",
  "amazon markeplace",
];

function isAmazonMerchant(name: string): boolean {
  const lower = name.toLowerCase();
  return AMAZON_MERCHANT_PATTERNS.some((p) => lower.includes(p));
}

export function groupByMerchant(
  transactions: MonarchTransaction[],
): {
  amazonTransactions: MonarchTransaction[];
  merchantGroups: MerchantGroup[];
} {
  const amazonTransactions: MonarchTransaction[] = [];
  const groupMap = new Map<string, MonarchTransaction[]>();

  for (const t of transactions) {
    const merchantName = t.merchant.name;

    if (isAmazonMerchant(merchantName) || isAmazonMerchant(t.plaidName)) {
      amazonTransactions.push(t);
      continue;
    }

    const existing = groupMap.get(merchantName);
    if (existing) {
      existing.push(t);
    } else {
      groupMap.set(merchantName, [t]);
    }
  }

  const merchantGroups: MerchantGroup[] = [];
  for (const [merchantName, txns] of groupMap) {
    const plaidNames = [
      ...new Set(txns.map((t) => t.plaidName).filter(Boolean)),
    ];
    const totalAmount = txns.reduce(
      (sum, t) => sum + Math.abs(t.amount),
      0,
    );
    const first = txns[0];

    merchantGroups.push({
      merchantName,
      transactions: txns,
      totalAmount,
      count: txns.length,
      plaidNames,
      currentCategory: first?.category.name ?? "Uncategorized",
      currentCategoryId: first?.category.id ?? "",
    });
  }

  merchantGroups.sort((a, b) => b.totalAmount - a.totalAmount);

  return { amazonTransactions, merchantGroups };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
