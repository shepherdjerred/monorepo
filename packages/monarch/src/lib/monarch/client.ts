import path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { MonarchCategory } from "./types.ts";
import { MonarchTransactionSchema } from "./types.ts";
import type { MonarchTransaction } from "./types.ts";
import { log } from "../logger.ts";
import {
  deleteTransactionMutation,
  getCategories,
  getTransactions,
  updateTransaction,
  updateTransactionSplits,
} from "./api.ts";
import type { PayloadError } from "./api.ts";

const TxnCacheSchema = z.object({
  cachedAt: z.string(),
  transactions: z.array(MonarchTransactionSchema),
});

const CACHE_DIR = path.join(homedir(), ".monarch-cache");
const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

export async function initMonarch(): Promise<void> {
  // Authentication is loaded lazily from .monarch-session.json by gqlRequest().
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

  log.info(
    `Loaded ${String(parsed.transactions.length)} transactions from cache (${String(Math.round(age / 60_000))}m old)`,
  );
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
    JSON.stringify(
      { cachedAt: new Date().toISOString(), transactions },
      null,
      2,
    ),
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
  const response = await getCategories();
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
      log.info(
        `${label} failed (attempt ${String(attempt + 1)}/${String(maxRetries)}), retrying in ${String(delay)}ms...`,
      );
      await sleep(delay);
    }
  }
  throw new Error("unreachable");
}

function formatPayloadErrors(errors: PayloadError[]): string {
  return errors
    .map((error) => {
      const fieldErrors = error.fieldErrors.flatMap((fieldError) =>
        fieldError.messages.map((message) => `${fieldError.field}: ${message}`),
      );
      const details =
        fieldErrors.length === 0 ? "" : ` (${fieldErrors.join("; ")})`;
      return `${error.code}: ${error.message}${details}`;
    })
    .join("; ");
}

function assertNoPayloadErrors(
  label: string,
  errors: PayloadError[] | null,
): void {
  if (errors === null || errors.length === 0) return;
  throw new Error(`${label} failed: ${formatPayloadErrors(errors)}`);
}

export async function applyCategory(
  transactionId: string,
  categoryId: string,
): Promise<void> {
  const result = await withRetry(`updateTransaction(${transactionId})`, () =>
    updateTransaction({ transactionId, categoryId }),
  );
  assertNoPayloadErrors(
    `updateTransaction(${transactionId})`,
    result.updateTransaction.errors,
  );
  const actualCategoryId = result.updateTransaction.transaction.category.id;
  if (actualCategoryId !== categoryId) {
    log.error(
      `Category update may have failed for ${transactionId}: expected ${categoryId}, got ${actualCategoryId}`,
    );
  }
  await sleep(500);
}

export async function deleteTransaction(transactionId: string): Promise<void> {
  const result = await withRetry(`deleteTransaction(${transactionId})`, () =>
    deleteTransactionMutation(transactionId),
  );
  assertNoPayloadErrors(
    `deleteTransaction(${transactionId})`,
    result.deleteTransaction.errors,
  );
  if (!result.deleteTransaction.deleted) {
    throw new Error(`Delete failed for transaction ${transactionId}`);
  }
  await sleep(500);
}

export async function setTransactionNotes(
  transactionId: string,
  notes: string,
): Promise<void> {
  const result = await withRetry(`setNotes(${transactionId})`, () =>
    updateTransaction({ transactionId, notes }),
  );
  assertNoPayloadErrors(
    `setNotes(${transactionId})`,
    result.updateTransaction.errors,
  );
  await sleep(500);
}

export async function flagForReview(transactionId: string): Promise<void> {
  const result = await withRetry(`flagForReview(${transactionId})`, () =>
    updateTransaction({ transactionId, needsReview: true }),
  );
  assertNoPayloadErrors(
    `flagForReview(${transactionId})`,
    result.updateTransaction.errors,
  );
  if (!result.updateTransaction.transaction.needsReview) {
    throw new Error(`Flag for review may have failed for ${transactionId}`);
  }
  await sleep(500);
}

export async function applySplits(
  transactionId: string,
  splits: {
    merchantName?: string;
    amount: number;
    categoryId: string;
    notes?: string;
    date?: string;
  }[],
): Promise<void> {
  const result = await withRetry(`applySplits(${transactionId})`, () =>
    updateTransactionSplits(transactionId, splits),
  );
  const rawErrors = result.updateTransactionSplit.errors;
  assertNoPayloadErrors(`applySplits(${transactionId})`, rawErrors);
  const txn = result.updateTransactionSplit.transaction;
  log.debug(
    `Split applied: ${String(txn.splitTransactions.length)} sub-transactions created`,
  );

  // Apply date overrides on sub-transactions
  const subTxns: { id: string }[] = txn.splitTransactions;
  for (const [i, split] of splits.entries()) {
    const subTxn = subTxns[i];
    if (subTxn && split.date !== undefined && split.date !== "") {
      const subId = subTxn.id;
      const dateOverride = split.date;
      log.debug(`  Moving sub-transaction ${subId} to ${dateOverride}`);
      await withRetry(`updateDate(${subId})`, async () => {
        const updateDateResult = await updateTransaction({
          transactionId: subId,
          date: dateOverride,
        });
        assertNoPayloadErrors(
          `updateDate(${subId})`,
          updateDateResult.updateTransaction.errors,
        );
        return updateDateResult;
      });
      await sleep(500);
    }
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

// A card bill, a balance transfer and card cash back all arrive as "Venmo",
// and none of them is a payment to a person. Which field carries that signal
// varies: Monarch often shows the merchant as a bare "Venmo" and keeps the
// detail in the bank description ("Venmo Credit Card payment"), so both are
// tested. Checking only the merchant name let 43 card payments, transfers and
// cash-back rows into the P2P path, where the CSV could never describe them.
export function isVenmoP2P(name: string, plaidName: string): boolean {
  const combined = `${name} ${plaidName}`.toLowerCase();
  return (
    combined.includes("venmo") &&
    !combined.includes("credit card") &&
    !combined.includes("cash back")
  );
}

export function isBiltTransaction(name: string, plaidName: string): boolean {
  const combined = `${name} ${plaidName}`.toLowerCase();
  return (
    combined.includes("bilt") && !combined.includes("credit card cash back")
  );
}

export function isUsaaInsurance(name: string, plaidName: string): boolean {
  const lower = name.toLowerCase();
  const plaidLower = plaidName.toLowerCase();
  return lower.includes("usaa") || plaidLower.includes("usaa");
}

export function isSclTransaction(name: string, plaidName: string): boolean {
  const lower = name.toLowerCase();
  const plaidLower = plaidName.toLowerCase();
  return (
    lower.includes("seattle city light") ||
    plaidLower.includes("seattle city light") ||
    lower.includes("scl") ||
    plaidLower.includes("scl")
  );
}

// Apple's emailed receipts cover purchases wherever they were made — the App
// Store, apple.com, and the retail stores, which arrive as a bare "Apple"
// merchant with the detail in the bank description. Matching only
// "apple services" and "apple.com" reached 32 transactions while the mailbox
// held 210 parsed receipts.
//
// The same name also appears on things no receipt can describe: paying the
// Apple Card bill, Apple Cash transfers, and the daily interest postings in
// the Apple Savings account. Those are excluded by name rather than by their
// Monarch category, which the pipeline is meant to be free to change.
const APPLE_NON_PURCHASE = [
  "apple card, cash", // the card and savings account itself
  "applecard gsbank", // paying the card bill
  "apple gs savings",
  "apple savings",
  "apple cash",
  "apple pay",
];

export function isAppleMerchant(name: string, plaidName: string): boolean {
  const combined = `${name} ${plaidName}`.toLowerCase();
  return (
    combined.includes("apple") &&
    !APPLE_NON_PURCHASE.some((p) => combined.includes(p))
  );
}

// Payroll deposits from the employer. The amount is part of the test: an
// expense at the same merchant is not a paycheck.
const PAYROLL_MERCHANT_PATTERNS = ["pinterest"];

function isPayrollDeposit(
  name: string,
  plaidName: string,
  amount: number,
): boolean {
  if (amount <= 0) return false;
  const lower = `${name} ${plaidName}`.toLowerCase();
  if (lower.includes("class a")) return false; // brokerage, not payroll
  return PAYROLL_MERCHANT_PATTERNS.some((p) => lower.includes(p));
}

// Restricted stock lapses in the equity brokerage account. They move no cash,
// so a zero amount is part of the test — a sale of the same stock is not a
// vest and this export cannot describe it.
function isEquityVest(
  name: string,
  plaidName: string,
  amount: number,
): boolean {
  if (amount !== 0) return false;
  const lower = `${name} ${plaidName}`.toLowerCase();
  return lower.includes("class a") && lower.includes("pinterest");
}

// Loan servicers whose statements the loan path can read. Upstart services
// several loans at once and the bank records them all under one name, which is
// why the loan is identified from the servicer's mail rather than from here.
// A servicer's merchant also covers non-loan spending — Audi bills parts and a
// down payment under the same name — so an unmatched row here is expected and
// is reported rather than guessed at.
const LOAN_SERVICER_PATTERNS = [
  "upstart",
  "audi financial",
  "audi fin",
  "edfinancial",
  "dept of education",
  "department of education",
];

function isLoanPayment(
  name: string,
  plaidName: string,
  amount: number,
): boolean {
  // Money leaving only: a refund or disbursement is not a repayment.
  if (amount >= 0) return false;
  const combined = `${name} ${plaidName}`.toLowerCase();
  return LOAN_SERVICER_PATTERNS.some((p) => combined.includes(p));
}

// Cash arriving from the brokerage. "Les Schwab" is a tire shop and shares
// nothing with the broker but a surname, so the match is on the full name.
const BROKERAGE_PATTERNS = ["charles schwab", "schwab brokerage"];

function isBrokerageTransfer(
  name: string,
  plaidName: string,
  amount: number,
): boolean {
  // Money in only: a purchase at this merchant is not a sale's proceeds.
  if (amount <= 0) return false;
  const combined = `${name} ${plaidName}`.toLowerCase();
  return BROKERAGE_PATTERNS.some((p) => combined.includes(p));
}

const COSTCO_MERCHANT_PATTERNS = ["costco", "costco whse", "costco.com"];

export function isCostcoMerchant(name: string, plaidName: string): boolean {
  const lower = name.toLowerCase();
  const plaidLower = plaidName.toLowerCase();
  return COSTCO_MERCHANT_PATTERNS.some(
    (p) => lower.includes(p) || plaidLower.includes(p),
  );
}

export type SeparateDeepPathsResult = {
  amazonTransactions: MonarchTransaction[];
  venmoTransactions: MonarchTransaction[];
  biltTransactions: MonarchTransaction[];
  usaaTransactions: MonarchTransaction[];
  sclTransactions: MonarchTransaction[];
  appleTransactions: MonarchTransaction[];
  costcoTransactions: MonarchTransaction[];
  paystubTransactions: MonarchTransaction[];
  equityTransactions: MonarchTransaction[];
  loanTransactions: MonarchTransaction[];
  brokerageTransactions: MonarchTransaction[];
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
  const paystubTransactions: MonarchTransaction[] = [];
  const equityTransactions: MonarchTransaction[] = [];
  const loanTransactions: MonarchTransaction[] = [];
  const brokerageTransactions: MonarchTransaction[] = [];
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
    } else if (isPayrollDeposit(merchantName, t.plaidName, t.amount)) {
      paystubTransactions.push(t);
    } else if (isEquityVest(merchantName, t.plaidName, t.amount)) {
      equityTransactions.push(t);
    } else if (isLoanPayment(merchantName, t.plaidName, t.amount)) {
      loanTransactions.push(t);
    } else if (isBrokerageTransfer(merchantName, t.plaidName, t.amount)) {
      brokerageTransactions.push(t);
    } else {
      regularTransactions.push(t);
    }
  }

  return {
    amazonTransactions,
    venmoTransactions,
    biltTransactions,
    usaaTransactions,
    sclTransactions,
    appleTransactions,
    costcoTransactions,
    paystubTransactions,
    equityTransactions,
    loanTransactions,
    brokerageTransactions,
    regularTransactions,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
