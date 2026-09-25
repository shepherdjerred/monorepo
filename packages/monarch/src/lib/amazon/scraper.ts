import type { Page, Locator, BrowserContext, Browser } from "playwright";
import { chromium } from "playwright";
import path from "node:path";
import { homedir } from "node:os";
import type { AmazonOrder, AmazonItem, AmazonCharge } from "./types.ts";
import {
  loadCache,
  loadCachedOrdersIgnoringAge,
  saveMergedCache,
} from "./cache.ts";
import { scrapeTransactionHistory } from "./charges-scraper.ts";
import { autoLogin } from "./login.ts";
import { parseAmazonDate, parsePrice } from "./transactions-parser.ts";
import { log } from "../logger.ts";

// The browser session is cheap to re-establish (one login), so unlike the
// order cache it stays in scratch rather than the vault.
const STATE_PATH = path.join(homedir(), ".monarch-amazon-state.json");

async function saveBrowserState(context: BrowserContext): Promise<void> {
  await context.storageState({ path: STATE_PATH });
  log.debug("Saved browser state for future sessions");
}

async function hasSavedState(): Promise<boolean> {
  return Bun.file(STATE_PATH).exists();
}

type OrderSummary = {
  orderId: string;
  date: string;
  total: number;
};

const ORDERS_PAGE_MARKERS =
  '#time-filter, select[name="timeFilter"], .order-card, .order, h1:has-text("Your Orders")';

async function isOnOrdersPage(page: Page): Promise<boolean> {
  return (await page.locator(ORDERS_PAGE_MARKERS).count()) > 0;
}

async function waitForOrdersPage(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isOnOrdersPage(page)) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(
    `Never reached the Amazon orders page after login (stuck on ${page.url()})`,
  );
}

export async function scrapeAmazonOrders(
  years: number[],
  forceScrape: boolean,
): Promise<AmazonOrder[]> {
  if (!forceScrape) {
    const cached = await loadCache();
    if (cached) return cached;
  }

  // Item details never change once an order is placed, so a stale cache only
  // needs new orders re-detailed. --force-scrape means "distrust the cache
  // entirely," so it gets an empty map and re-fetches everything.
  let existingByOrderId = new Map<string, AmazonOrder>();
  if (!forceScrape) {
    const existingOrders = await loadCachedOrdersIgnoringAge();
    existingByOrderId = new Map(
      existingOrders.map((order) => [order.orderId, order]),
    );
  }

  log.info("Launching browser...");
  const browser = await launchBrowser();
  const savedState = await hasSavedState();
  const context = savedState
    ? await browser.newContext({ storageState: STATE_PATH })
    : await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto("https://www.amazon.com/gp/css/order-history");
    await page.waitForLoadState("domcontentloaded");

    // Amazon serves the signed-in orders page from both /your-orders/ and
    // /gp/css/order-history, so detect login by page content, not URL.
    if (await isOnOrdersPage(page)) {
      log.info("Logged in with saved session");
    } else {
      log.info("Login required, using 1Password for credentials...");
      await autoLogin(page);
      // Generous window: a captcha shown in the headed browser can be
      // solved manually and the scrape continues.
      await waitForOrdersPage(page, 120_000);
      log.info("Login successful, session saved for next time");
    }
    await saveBrowserState(context);

    const summaries: OrderSummary[] = [];

    for (const year of years) {
      log.info(`Collecting orders for ${String(year)}...`);
      const yearSummaries = await collectOrderSummaries(page, year);
      summaries.push(...yearSummaries);
      log.info(
        `  Found ${String(yearSummaries.length)} orders for ${String(year)}`,
      );
    }

    log.info("Scraping card charges from the transaction history...");
    const earliestYear = Math.min(...years);
    const chargesByOrder = await scrapeTransactionHistory(
      page,
      `${String(earliestYear)}-01-01`,
    );
    // Zero charges parsed off the payments page is parse drift. Asserting it
    // here rather than on the per-order join means an old scrape whose charges
    // have legitimately aged out of the history still keeps its orders.
    if (chargesByOrder.size === 0) {
      throw new Error(
        "No card charges parsed from the transaction history — Amazon markup changed",
      );
    }

    log.info(`Fetching item details for ${String(summaries.length)} orders...`);
    const allOrders = await fetchOrderDetails(
      page,
      summaries,
      chargesByOrder,
      existingByOrderId,
    );

    // Save state again after successful scrape
    await saveBrowserState(context);
    return await saveMergedCache(allOrders);
  } finally {
    await browser.close();
  }
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: false });
  } catch {
    return chromium.launch({ headless: false });
  }
}

async function collectOrderSummaries(
  page: Page,
  year: number,
): Promise<OrderSummary[]> {
  const summaries: OrderSummary[] = [];

  // Paginate via the startIndex query parameter instead of clicking the
  // "Next" button: the button's markup varies between listing variants and a
  // missed selector used to end the loop silently, dropping months of orders.
  let startIndex = 0;
  for (;;) {
    const url = `https://www.amazon.com/gp/your-account/order-history?timeFilter=year-${String(year)}&startIndex=${String(startIndex)}`;
    log.debug(`  Page at startIndex=${String(startIndex)}...`);
    await page.goto(url);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    const { cards, strict } = await getOrderCards(page);
    if (cards.length === 0) break;

    const before = summaries.length;
    for (const card of cards) {
      const summary = await extractOrderSummary(card);
      if (summary) summaries.push(summary);
    }
    if (summaries.length === before) {
      // Real order cards that all fail to parse means the listing markup
      // changed; stop loudly instead of looping forever on the same page.
      // The fuzzy fallback selector also matches empty-state containers on
      // the page past the end of the list — that is a normal terminus.
      if (strict) {
        throw new Error(
          `Order listing for ${String(year)} at startIndex=${String(startIndex)} rendered ${String(cards.length)} cards but none parsed`,
        );
      }
      log.debug(
        `  End of ${String(year)} listing at startIndex=${String(startIndex)}`,
      );
      break;
    }

    startIndex += cards.length;
  }

  return summaries;
}

async function getOrderCards(
  page: Page,
): Promise<{ cards: Locator[]; strict: boolean }> {
  const cards = await page.locator(".order-card, .order").all();
  if (cards.length > 0) return { cards, strict: true };
  const altCards = await page
    .locator('[class*="order-card"], [data-component="order"]')
    .all();
  return { cards: altCards, strict: false };
}

async function extractOrderSummary(
  card: Locator,
): Promise<OrderSummary | null> {
  try {
    const dateText = await card
      .locator(".a-column.a-span3 .a-size-base.a-color-secondary")
      .first()
      .textContent();

    const totalText = await card
      .locator(".a-column.a-span2 .a-size-base.a-color-secondary")
      .first()
      .textContent();

    const orderIdText = await card
      .locator(".yohtmlc-order-id span:not(.a-text-caps)")
      .first()
      .textContent();

    const date = dateText?.trim();
    const total = totalText?.trim();
    if (
      date === undefined ||
      date === "" ||
      total === undefined ||
      total === ""
    )
      return null;

    // The order id is the cache's merge key, and no substitute for it is
    // unique: a content-derived one collides whenever two orders share a date
    // and total, and saveMergedCache would then fold them together and drop
    // one permanently. A card without an id is parse drift — report it and let
    // the caller's all-cards-failed check decide whether the markup moved.
    const rawId = orderIdText?.trim();
    if (rawId === undefined || rawId === "") {
      log.warn(
        `Order card dated ${date} for ${total} rendered no order id; skipping`,
      );
      return null;
    }
    return {
      orderId: rawId,
      date: parseAmazonDate(date),
      total: parsePrice(total),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to extract order summary: ${message}`);
    return null;
  }
}

async function fetchOrderDetails(
  page: Page,
  summaries: OrderSummary[],
  chargesByOrder: Map<string, AmazonCharge[]>,
  existingByOrderId: Map<string, AmazonOrder>,
): Promise<AmazonOrder[]> {
  const orders: AmazonOrder[] = [];
  let reused = 0;

  for (let i = 0; i < summaries.length; i++) {
    const summary = summaries[i];
    if (!summary) continue;
    log.progress(i + 1, summaries.length, "order details fetched");

    const existing = existingByOrderId.get(summary.orderId);
    let items: AmazonItem[];
    if (existing) {
      items = existing.items;
      reused++;
    } else {
      items = await scrapeOrderDetail(page, summary);
    }
    orders.push({
      orderId: summary.orderId,
      date: summary.date,
      total: summary.total,
      items,
      charges: chargesByOrder.get(summary.orderId) ?? [],
    });
  }

  if (reused > 0) {
    log.info(
      `Reused cached item details for ${String(reused)}/${String(orders.length)} orders already scraped`,
    );
  }

  // Individual orders may legitimately carry no card charges
  // (gift-card-only), but zero joins across an entire scrape means the
  // transaction-history parse drifted and matching would silently regress.
  const withCharges = orders.filter((o) => o.charges.length > 0).length;
  log.info(
    `Charges joined for ${String(withCharges)}/${String(orders.length)} orders`,
  );
  if (withCharges === 0 && orders.length > 0 && chargesByOrder.size > 0) {
    throw new Error(
      `Scraped ${String(orders.length)} orders and ${String(chargesByOrder.size)} charged orders but joined none of them; the order ids on the transaction-history page no longer match the order summaries. Fix the parse rather than caching chargeless orders, which would silently fall back to order-total matching.`,
    );
  }

  return orders;
}

async function scrapeOrderDetail(
  page: Page,
  summary: OrderSummary,
): Promise<AmazonItem[]> {
  const detailUrl = `https://www.amazon.com/your-orders/order-details?orderID=${summary.orderId}`;

  try {
    await page.goto(detailUrl);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    const items: { title: string; price: number }[] = [];

    // Use [data-component="itemTitle"] to target only order item links,
    // excluding recommendation carousel and footer links
    const mainContent = page.locator('[role="main"]');
    const titleLinks = await mainContent
      .locator('[data-component="itemTitle"] a[href*="/dp/"]')
      .all();

    for (const link of titleLinks) {
      const title = await link.textContent();
      if (title === null || title.trim() === "" || title.trim().length < 10)
        continue;

      const trimmed = title.trim();

      // Skip price-like text, unit prices, and promotional links
      if (trimmed.startsWith("$")) continue;
      if (trimmed.startsWith("(")) continue;
      if (trimmed.startsWith("List Price")) continue;
      if (/^Amazon\s+(?:Secured|Business|Store)\s+Card/i.test(trimmed))
        continue;

      // Deduplicate: skip if we already have this title (image + text links)
      if (items.some((existing) => existing.title === trimmed)) continue;

      const price = await extractItemPrice(link);
      items.push({ title: trimmed, price });
    }

    if (items.length === 0) {
      return [makeUnknownItem(summary)];
    }

    distributeUnpricedItems(items, summary.total);

    return items.map((item) => ({
      title: item.title,
      price: item.price,
      quantity: 1,
      orderDate: summary.date,
      orderId: summary.orderId,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to scrape order ${summary.orderId}: ${message}`);
    return [makeUnknownItem(summary)];
  }
}

async function extractItemPrice(link: Locator): Promise<number> {
  const grid = link
    .locator("xpath=ancestor::div[contains(@class,'a-fixed-left-grid-inner')]")
    .first();
  if ((await grid.count()) === 0) return 0;

  // Try data-component="unitPrice" first
  const unitPriceEl = grid.locator('[data-component="unitPrice"]');
  if ((await unitPriceEl.count()) > 0) {
    const priceText = (await unitPriceEl.first().textContent()) ?? "";
    const price = parsePrice(priceText);
    if (price > 0) return price;
  }

  // Fallback: find price in the right column of the grid
  const rightCol = grid.locator('.a-col-right, [class*="a-text-right"]');
  if ((await rightCol.count()) > 0) {
    const priceText = (await rightCol.first().textContent()) ?? "";
    return parsePrice(priceText);
  }

  return 0;
}

function makeUnknownItem(summary: OrderSummary): AmazonItem {
  return {
    title: "Unknown Amazon Purchase",
    price: summary.total,
    quantity: 1,
    orderDate: summary.date,
    orderId: summary.orderId,
  };
}

function distributeUnpricedItems(
  items: { title: string; price: number }[],
  total: number,
): void {
  const pricedTotal = items.reduce((sum, item) => sum + item.price, 0);
  const unpricedItems = items.filter((item) => item.price === 0);

  if (unpricedItems.length > 0 && pricedTotal < total) {
    const remainder = total - pricedTotal;
    const each = remainder / unpricedItems.length;
    for (const item of unpricedItems) {
      item.price = Math.round(each * 100) / 100;
    }
  }
}
