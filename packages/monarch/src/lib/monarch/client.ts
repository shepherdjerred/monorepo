import {
  setToken,
  getTransactions,
  getTransactionCategories,
  updateTransaction,
  updateTransactionSplits,
} from "monarch-money-api";
import type {
  MonarchTransaction,
  MonarchCategory,
  MerchantGroup,
} from "./types.ts";
import { log } from "../logger.ts";

export function initMonarch(token: string): void {
  setToken(token);
}

export async function fetchAllTransactions(
  startDate: string,
  endDate: string,
): Promise<MonarchTransaction[]> {
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
