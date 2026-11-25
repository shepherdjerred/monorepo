import type { Locator, Page } from "playwright";
import type { AmazonCharge } from "./types.ts";
import {
  foldTransactionRows,
  transactionRowsFromLinkText,
  type TransactionRow,
} from "./transactions-parser.ts";
import { log } from "../logger.ts";

const TRANSACTIONS_URL = "https://www.amazon.com/cpe/yourpayments/transactions";
// Runaway backstop far above any real history depth (~20 txns per page).
const MAX_PAGES = 300;

// Scrapes the payments transaction-history page once and returns the card
// charges grouped by order id. Amazon's order-details page no longer inlines
// charges — it links here ("View related transactions") instead.
export async function scrapeTransactionHistory(
  page: Page,
  sinceDate: string,
): Promise<Map<string, AmazonCharge[]>> {
  await page.goto(TRANSACTIONS_URL);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);

  // The rebuilt payments page renders transactions as append-on-scroll
  // links instead of the classic paged table; detect it by its test id
  // and fall back to the classic path when the old markup is served.
  const linkCount = await page
    .locator('[data-testid="transaction-link"]')
    .count();
  if (linkCount > 0) return scrapeLinkedTransactions(page, sinceDate);

  const byOrder = new Map<string, AmazonCharge[]>();
  let pageNum = 0;

  for (;;) {
    pageNum++;
    if (pageNum > MAX_PAGES) {
      throw new Error(
        `Transaction history exceeded ${String(MAX_PAGES)} pages without reaching ${sinceDate}`,
      );
    }
    await page.waitForTimeout(1000);

    const folded = foldTransactionRows(await extractRows(page));
    mergeCharges(byOrder, folded.byOrder);

    const reachedCutoff =
      folded.oldestDate !== undefined && folded.oldestDate < sinceDate;
    if (reachedCutoff) break;
    const advance = await advanceToNextPage(page);
    if (advance === "end-of-history") break;
    if (advance === "failed") {
      throw new Error(
        `Transaction history paging failed on page ${String(pageNum)} before reaching ${sinceDate}; the charges read so far cover only back to ${folded.oldestDate ?? "an unknown date"}. Re-run the scrape rather than caching a truncated charge set.`,
      );
    }
  }

  const chargeCount = [...byOrder.values()].reduce(
    (sum, list) => sum + list.length,
    0,
  );
  log.info(
    `Transaction history: ${String(chargeCount)} card charges across ${String(byOrder.size)} orders (${String(pageNum)} pages)`,
  );
  return byOrder;
}

// Append-on-scroll variant: each batch renders ~20 more transaction
// links. Links already read are never re-read (the fold would double
// their charges), and scrolling the last link into view is what loads
// the next batch — there is no usable pager control.
async function scrapeLinkedTransactions(
  page: Page,
  sinceDate: string,
): Promise<Map<string, AmazonCharge[]>> {
  const links = page.locator('[data-testid="transaction-link"]');
  const byOrder = new Map<string, AmazonCharge[]>();
  let processed = 0;
  let batches = 0;
  let oldestDate: string | undefined;

  for (;;) {
    batches++;
    if (batches > MAX_PAGES) {
      throw new Error(
        `Transaction history exceeded ${String(MAX_PAGES)} batches without reaching ${sinceDate}`,
      );
    }
    const count = await links.count();
    const rows: TransactionRow[] = [];
    for (let i = processed; i < count; i++) {
      rows.push(...transactionRowsFromLinkText(await links.nth(i).innerText()));
    }
    processed = count;

    const folded = foldTransactionRows(rows);
    mergeCharges(byOrder, folded.byOrder);
    if (
      folded.oldestDate !== undefined &&
      (oldestDate === undefined || folded.oldestDate < oldestDate)
    ) {
      oldestDate = folded.oldestDate;
    }
    if (oldestDate !== undefined && oldestDate < sinceDate) break;

    await links
      .last()
      .scrollIntoViewIfNeeded()
      .catch(() => {
        // A detached last link just means no further batch rendered.
      });
    await page.waitForTimeout(1500);
    if ((await links.count()) === processed) {
      log.warn(
        `Transaction history ended at ${oldestDate ?? "an unknown date"} before reaching ${sinceDate}`,
      );
      break;
    }
  }

  const chargeCount = [...byOrder.values()].reduce(
    (sum, list) => sum + list.length,
    0,
  );
  log.info(
    `Transaction history: ${String(chargeCount)} card charges across ${String(byOrder.size)} orders (${String(batches)} batches)`,
  );
  return byOrder;
}

function mergeCharges(
  into: Map<string, AmazonCharge[]>,
  from: Map<string, AmazonCharge[]>,
): void {
  for (const [orderId, charges] of from) {
    const existing = into.get(orderId) ?? [];
    into.set(orderId, [...existing, ...charges]);
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Running out of pages and failing to turn one look identical from the caller
// unless they are named apart. The history re-renders under the locators we
// hold and detaches them, so a click can throw on a page that does have a
// successor — and treating that as the end of the history caches a charge set
// that stops partway through, which is worse than no charges at all: the
// orders below the cut match on order total instead, attaching a whole order
// to one partial-shipment transaction.
type PageAdvance = "advanced" | "end-of-history" | "failed";

async function advanceToNextPage(page: Page): Promise<PageAdvance> {
  const nextButton = page
    .locator('.a-button:has(.a-button-text:text-is("Next Page"))')
    .last();
  try {
    if ((await nextButton.count()) === 0) return "end-of-history";
    const buttonClass = (await nextButton.getAttribute("class")) ?? "";
    if (buttonClass.includes("a-button-disabled")) return "end-of-history";
    await nextButton.click();
    await page.waitForLoadState("domcontentloaded");
    return "advanced";
  } catch (error: unknown) {
    log.warn(`Could not page the transaction history: ${reason(error)}`);
    return "failed";
  }
}

async function extractRows(page: Page): Promise<TransactionRow[]> {
  const elements = await page
    .locator(
      ".apx-transaction-date-container, .apx-transactions-line-item-component-container",
    )
    .all();

  const rows: TransactionRow[] = [];
  for (const el of elements) {
    try {
      const className = (await el.getAttribute("class")) ?? "";
      if (className.includes("apx-transaction-date-container")) {
        rows.push({ kind: "date", text: (await el.textContent()) ?? "" });
        continue;
      }
      rows.push({
        kind: "txn",
        amountText: await textOrEmpty(el, ".a-text-right span"),
        paymentMethod: await textOrEmpty(el, ".a-column.a-span9 span"),
        orderText: await textOrEmpty(el, 'a[href*="orderID="]'),
      });
    } catch (error: unknown) {
      // Once one row detaches the rest of this page's locators have too, so
      // return what was read rather than waiting out a timeout per row.
      log.warn(
        `Read ${String(rows.length)}/${String(elements.length)} transaction rows on this page: ${reason(error)}`,
      );
      break;
    }
  }
  return rows;
}

async function textOrEmpty(scope: Locator, selector: string): Promise<string> {
  const target = scope.locator(selector).first();
  return (await target.count()) === 0
    ? ""
    : ((await target.textContent()) ?? "");
}
