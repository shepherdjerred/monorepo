import type { Page, Locator } from "playwright";
import { chromium } from "playwright";
import path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { AmazonOrder, AmazonItem, AmazonCache } from "./types.ts";
import { log } from "../logger.ts";

const AmazonCacheSchema = z.object({
  scrapedAt: z.string(),
  orders: z.array(
    z.object({
      orderId: z.string(),
      date: z.string(),
      total: z.number(),
      items: z.array(
        z.object({
          title: z.string(),
          price: z.number(),
          quantity: z.number(),
          orderDate: z.string(),
          orderId: z.string(),
        }),
      ),
    }),
  ),
});

const CACHE_PATH = path.join(homedir(), ".monarch-amazon-cache.json");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function loadCache(): Promise<AmazonOrder[] | null> {
  const file = Bun.file(CACHE_PATH);
  const exists = await file.exists();
  if (!exists) return null;

  const raw = await file.text();
  const cache: AmazonCache = AmazonCacheSchema.parse(JSON.parse(raw));
  const age = Date.now() - new Date(cache.scrapedAt).getTime();

  if (age > CACHE_MAX_AGE_MS) {
    log.info("Amazon cache expired, will re-scrape");
    return null;
  }

  log.info(`Loaded ${String(cache.orders.length)} orders from cache`);
  return cache.orders;
}

async function saveCache(orders: AmazonOrder[]): Promise<void> {
  const cache: AmazonCache = {
    scrapedAt: new Date().toISOString(),
    orders,
  };
  await Bun.write(CACHE_PATH, JSON.stringify(cache, null, 2));
  log.info(`Saved ${String(orders.length)} orders to cache`);
}

export async function scrapeAmazonOrders(
  years: number[],
  forceScrape: boolean,
): Promise<AmazonOrder[]> {
  if (!forceScrape) {
    const cached = await loadCache();
    if (cached) return cached;
  }

  log.info("Launching browser for Amazon login...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto("https://www.amazon.com/gp/css/order-history");

    log.info(
      "Please log in to Amazon in the browser window (including 2FA if needed)...",
    );

    await page.waitForURL("**/your-orders/**", { timeout: 300_000 });
    log.info("Login detected! Starting scrape...");

    const allOrders: AmazonOrder[] = [];

    for (const year of years) {
      log.info(`Scraping orders for ${String(year)}...`);
      const yearOrders = await scrapeYear(page, year);
      allOrders.push(...yearOrders);
      log.info(`  Found ${String(yearOrders.length)} orders for ${String(year)}`);
    }

    await saveCache(allOrders);
    return allOrders;
  } finally {
    await browser.close();
  }
}

async function scrapeYear(
  page: Page,
  year: number,
): Promise<AmazonOrder[]> {
  const orders: AmazonOrder[] = [];
  const url = `https://www.amazon.com/gp/your-account/order-history?timeFilter=year-${String(year)}`;
  await page.goto(url);
  await page.waitForLoadState("domcontentloaded");

  let pageNum = 1;
  let hasMore = true;

  while (hasMore) {
    log.debug(`  Page ${String(pageNum)}...`);
    await page.waitForTimeout(1500);

    const orderCards = await page.locator(".order-card, .order").all();

    if (orderCards.length === 0) {
      const altCards = await page
        .locator('[class*="order-card"], [data-component="order"]')
        .all();
      if (altCards.length === 0) {
        hasMore = false;
        continue;
      }

      for (const card of altCards) {
        const order = await extractOrderFromCard(card);
        if (order) orders.push(order);
      }
    } else {
      for (const card of orderCards) {
        const order = await extractOrderFromCard(card);
        if (order) orders.push(order);
      }
    }

    const nextButton = page.locator(
      'li.a-last a, a:has-text("Next"), [aria-label="Next"]',
    );
    if (
      (await nextButton.count()) > 0 &&
      (await nextButton.first().isVisible())
    ) {
      await nextButton.first().click();
      await page.waitForLoadState("domcontentloaded");
      pageNum++;
    } else {
      hasMore = false;
    }
  }

  return orders;
}

async function extractOrderFromCard(
  card: Locator,
): Promise<AmazonOrder | null> {
  try {
    const dateText = await card
      .locator(
        '.a-color-secondary.value, [class*="order-date"], .order-info .value',
      )
      .first()
      .textContent();

    const totalText = await card
      .locator(
        '.a-color-price, [class*="grand-total"], .order-info .value >> nth=1',
      )
      .first()
      .textContent();

    const orderIdText = await card
      .locator(
        '.a-color-secondary.value >> nth=2, [class*="order-id"], bdi',
      )
      .first()
      .textContent();

    if (dateText === null || dateText === "" || totalText === null || totalText === "") {
      return null;
    }

    const date = parseAmazonDate(dateText.trim());
    const total = parsePrice(totalText.trim());
    const orderId =
      orderIdText !== null && orderIdText !== ""
        ? orderIdText.trim()
        : `unknown-${String(Date.now())}`;

    const itemElements = await card
      .locator(
        '.yohtmlc-item, [class*="item-title"], .a-fixed-left-grid-inner .a-text-bold, .a-link-normal[href*="/dp/"]',
      )
      .all();

    const items: AmazonItem[] = [];
    for (const el of itemElements) {
      const title = await el.textContent();
      if (title === null || title.trim() === "") continue;

      let itemPrice: number;
      try {
        const priceEl = await el
          .locator('.. >> .a-color-price, .. >> [class*="price"]')
          .first()
          .textContent();
        itemPrice =
          priceEl === null
            ? total / Math.max(itemElements.length, 1)
            : parsePrice(priceEl);
      } catch {
        log.debug(`Could not extract item price for "${title.trim()}", estimating from order total`);
        itemPrice = total / Math.max(itemElements.length, 1);
      }

      items.push({
        title: title.trim(),
        price: itemPrice,
        quantity: 1,
        orderDate: date,
        orderId,
      });
    }

    if (items.length === 0) {
      items.push({
        title: "Unknown Amazon Purchase",
        price: total,
        quantity: 1,
        orderDate: date,
        orderId,
      });
    }

    return { orderId, date, total, items };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to extract order from card: ${message}`);
    return null;
  }
}

function parseAmazonDate(text: string): string {
  const cleaned = text.replaceAll(/\s+/g, " ").trim();
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0] ?? cleaned;
  }
  return cleaned;
}

function parsePrice(text: string): number {
  const cleaned = text.replaceAll(/[^\d,.]/g, "");
  const match = /[\d,]+\.\d{2}/.exec(cleaned);
  if (match?.[0] === undefined) return 0;
  return Number.parseFloat(match[0].replaceAll(",", ""));
}
