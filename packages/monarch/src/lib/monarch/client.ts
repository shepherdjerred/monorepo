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

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (attempt === maxRetries) throw error;
      const delay = 1000 * 2 ** attempt + Math.floor(Math.random() * 500);
      log.info(`${label} failed (attempt ${String(attempt + 1)}/${String(maxRetries)}), retrying in ${String(delay)}ms...`);
      await sleep(delay);
    }
  }
  throw new Error("unreachable");
}

export async function applyCategory(
  transactionId: string,
  categoryId: string,
): Promise<void> {
  const result = await withRetry(`updateTransaction(${transactionId})`, () =>
    updateTransaction({ transactionId, categoryId }),
  );
  const actualCategoryId = result.updateTransaction.transaction.category.id;
  if (actualCategoryId !== categoryId) {
    log.error(`Category update may have failed for ${transactionId}: expected ${categoryId}, got ${actualCategoryId}`);
  }
  await sleep(500);
}

export async function flagForReview(transactionId: string): Promise<void> {
  await withRetry(`flagForReview(${transactionId})`, () =>
    updateTransaction({ transactionId, needsReview: true }),
  );
  await sleep(500);
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
  const result = await withRetry(`applySplits(${transactionId})`, () =>
    updateTransactionSplits(transactionId, splits),
  );
  const rawErrors: unknown = result.updateTransactionSplit.errors;
  if (rawErrors === null) {
    const txn = result.updateTransactionSplit.transaction;
    log.debug(`Split applied: ${String(txn.splitTransactions.length)} sub-transactions created`);
  } else {
    log.error(`Split failed for ${transactionId}: ${JSON.stringify(rawErrors)}`);
    log.debug(`Split data: ${JSON.stringify(splits)}`);
  }
  await sleep(500);
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

export function isVenmoP2P(name: string, plaidName: string): boolean {
  const lower = name.toLowerCase();
  const plaidLower = plaidName.toLowerCase();
  const hasVenmo = lower.includes("venmo") || plaidLower.includes("venmo");
  if (!hasVenmo) return false;
  return !lower.includes("credit card") && !lower.includes("cash back");
}

export function isBiltTransaction(name: string, plaidName: string): boolean {
  const lower = name.toLowerCase();
  const plaidLower = plaidName.toLowerCase();
  const hasBilt = lower.includes("bilt") || plaidLower.includes("bilt");
  if (!hasBilt) return false;
  return !lower.includes("credit card cash back");
}

export function isUsaaInsurance(name: string, plaidName: string): boolean {
  const lower = name.toLowerCase();
  const plaidLower = plaidName.toLowerCase();
  return lower.includes("usaa") || plaidLower.includes("usaa");
}

export function isSclTransaction(name: string, plaidName: string): boolean {
  const lower = name.toLowerCase();
  const plaidLower = plaidName.toLowerCase();
  return lower.includes("seattle city light") || plaidLower.includes("seattle city light") ||
    lower.includes("scl") || plaidLower.includes("scl");
}

const APPLE_MERCHANT_PATTERNS = [
  "apple services",
  "apple.com",
  "apple.com/bill",
];

export function isAppleMerchant(name: string, plaidName: string): boolean {
  const lower = name.toLowerCase();
  const plaidLower = plaidName.toLowerCase();
  return APPLE_MERCHANT_PATTERNS.some((p) => lower.includes(p) || plaidLower.includes(p));
}

const COSTCO_MERCHANT_PATTERNS = [
  "costco",
  "costco whse",
  "costco.com",
];

export function isCostcoMerchant(name: string, plaidName: string): boolean {
  const lower = name.toLowerCase();
  const plaidLower = plaidName.toLowerCase();
  return COSTCO_MERCHANT_PATTERNS.some((p) => lower.includes(p) || plaidLower.includes(p));
}

export type SeparateDeepPathsResult = {
  amazonTransactions: MonarchTransaction[];
  venmoTransactions: MonarchTransaction[];
  biltTransactions: MonarchTransaction[];
  usaaTransactions: MonarchTransaction[];
  sclTransactions: MonarchTransaction[];
  appleTransactions: MonarchTransaction[];
  costcoTransactions: MonarchTransaction[];
  regularTransactions: MonarchTransaction[];
};

export function separateDeepPaths(
  transactions: MonarchTransaction[],
): SeparateDeepPathsResult {
  const amazonTransactions: MonarchTransaction[] = [];
  const venmoTransactions: MonarchTransaction[] = [];
  const biltTransactions: MonarchTransaction[] = [];
  const usaaTransactions: MonarchTransaction[] = [];
  const sclTransactions: MonarchTransaction[] = [];
  const appleTransactions: MonarchTransaction[] = [];
  const costcoTransactions: MonarchTransaction[] = [];
  const regularTransactions: MonarchTransaction[] = [];

  for (const t of transactions) {
    const merchantName = t.merchant.name;

    if (isAmazonMerchant(merchantName) || isAmazonMerchant(t.plaidName)) {
      amazonTransactions.push(t);
    } else if (isVenmoP2P(merchantName, t.plaidName)) {
      venmoTransactions.push(t);
    } else if (isBiltTransaction(merchantName, t.plaidName)) {
      biltTransactions.push(t);
    } else if (isUsaaInsurance(merchantName, t.plaidName)) {
      usaaTransactions.push(t);
    } else if (isSclTransaction(merchantName, t.plaidName)) {
      sclTransactions.push(t);
    } else if (isAppleMerchant(merchantName, t.plaidName)) {
      appleTransactions.push(t);
    } else if (isCostcoMerchant(merchantName, t.plaidName)) {
      costcoTransactions.push(t);
    } else {
      regularTransactions.push(t);
    }
  }

  return { amazonTransactions, venmoTransactions, biltTransactions, usaaTransactions, sclTransactions, appleTransactions, costcoTransactions, regularTransactions };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
