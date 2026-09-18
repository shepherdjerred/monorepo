import type { Locator, Page } from "playwright";
import type { AmazonCharge } from "./types.ts";
import {
  foldTransactionRows,
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
    if (!(await advanceToNextPage(page))) break;
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

// Reading the page can fail partway through because the history re-renders
// under the locators we are holding, which detaches them. That is a property
// of scraping someone else's page, not of the data: the charges gathered so
// far are still correct, and the order scrape that precedes this is an hour
// of work that should not be discarded because one page blinked. Stopping
// early is reported, and `scrapeTransactionHistory`'s caller still throws if
// the whole pass produced no charges at all.
async function advanceToNextPage(page: Page): Promise<boolean> {
  const nextButton = page
    .locator('.a-button:has(.a-button-text:text-is("Next Page"))')
    .last();
  try {
    if ((await nextButton.count()) === 0) return false;
    const buttonClass = (await nextButton.getAttribute("class")) ?? "";
    if (buttonClass.includes("a-button-disabled")) return false;
    await nextButton.click();
    await page.waitForLoadState("domcontentloaded");
    return true;
  } catch (error: unknown) {
    log.warn(`Stopped paging the transaction history: ${reason(error)}`);
    return false;
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
  if ((await target.count()) === 0) return "";
  return (await target.textContent()) ?? "";
}
