import type { Page, Locator, BrowserContext } from "playwright";
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
const STATE_PATH = path.join(homedir(), ".monarch-amazon-state.json");
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

async function runOp(args: string[]): Promise<string> {
  const proc = Bun.spawn(["op", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`op CLI failed: ${stderr.trim()}`);
  }
  return output.trim();
}

async function getAmazonCredentials(): Promise<{
  email: string;
  password: string;
}> {
  log.info("Fetching Amazon credentials from 1Password...");
  const [email, password] = await Promise.all([
    runOp(["item", "get", "Amazon", "--fields", "username", "--reveal"]),
    runOp(["item", "get", "Amazon", "--fields", "password", "--reveal"]),
  ]);
  return { email, password };
}

async function getAmazonTotp(): Promise<string> {
  return runOp(["item", "get", "Amazon", "--otp"]);
}

async function autoLogin(page: Page): Promise<void> {
  const { email, password } = await getAmazonCredentials();

  // Fill email
  const emailField = page.locator('#ap_email');
  await emailField.fill(email);

  const continueBtn = page.locator('input#continue');
  if (await continueBtn.isVisible()) {
    await continueBtn.click();
    await page.waitForLoadState("domcontentloaded");
  }

  // Fill password
  const passwordField = page.locator('#ap_password');
  await passwordField.waitFor({ state: "visible", timeout: 10_000 });
  await passwordField.fill(password);

  const signInBtn = page.locator('#signInSubmit');
  await signInBtn.click();
  await page.waitForLoadState("domcontentloaded");

  // Handle TOTP if prompted
  const otpField = page.locator('#auth-mfa-otpcode, input[name="otpCode"]');
  if (await otpField.isVisible({ timeout: 3000 }).catch(() => false)) {
    log.info("2FA required, fetching TOTP from 1Password...");
    const totp = await getAmazonTotp();
    await otpField.fill(totp);
    const submitOtp = page.locator('#auth-signin-button, button[type="submit"]');
    await submitOtp.click();
    await page.waitForLoadState("domcontentloaded");
  }

  // Handle "Don't ask again on this device" checkbox
  const rememberCheck = page.locator('#auth-mfa-remember-device');
  if (await rememberCheck.isVisible().catch(() => false)) {
    await rememberCheck.check();
  }

  // Handle passkey nudge ("Not now" or "Skip")
  const skipPasskey = page.locator(
    'input[value="Not now"], a:has-text("Not now"), button:has-text("Not now"), a:has-text("Skip")',
  );
  if (await skipPasskey.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await skipPasskey.first().click();
    await page.waitForLoadState("domcontentloaded");
  }
}

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

export async function scrapeAmazonOrders(
  years: number[],
  forceScrape: boolean,
): Promise<AmazonOrder[]> {
  if (!forceScrape) {
    const cached = await loadCache();
    if (cached) return cached;
  }

  log.info("Launching browser...");
  const browser = await chromium.launch({ headless: false });
  const savedState = await hasSavedState();
  const context = savedState
    ? await browser.newContext({ storageState: STATE_PATH })
    : await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto("https://www.amazon.com/gp/css/order-history");

    // Check if we landed on the orders page (saved cookies worked)
    // or if we need to log in
    const url = page.url();
    const isLoggedIn = url.includes("/your-orders/") || url.includes("order-history");

    if (!isLoggedIn || url.includes("/ap/signin")) {
      log.info("Login required, using 1Password for credentials...");
      await autoLogin(page);
      await page.waitForURL("**/your-orders/**", { timeout: 60_000 });
      await saveBrowserState(context);
      log.info("Login successful, session saved for next time");
    } else {
      // Verify we're actually on the orders page (cookies might be stale)
      try {
        await page.waitForURL("**/your-orders/**", { timeout: 10_000 });
        log.info("Logged in with saved session");
      } catch {
        log.info("Saved session expired, logging in with 1Password...");
        await page.goto("https://www.amazon.com/gp/css/order-history");
        await autoLogin(page);
        await page.waitForURL("**/your-orders/**", { timeout: 60_000 });
        await saveBrowserState(context);
        log.info("Login successful, session saved for next time");
      }
    }

    const summaries: OrderSummary[] = [];

    for (const year of years) {
      log.info(`Collecting orders for ${String(year)}...`);
      const yearSummaries = await collectOrderSummaries(page, year);
      summaries.push(...yearSummaries);
      log.info(`  Found ${String(yearSummaries.length)} orders for ${String(year)}`);
    }

    log.info(`Fetching item details for ${String(summaries.length)} orders...`);
    const allOrders = await fetchOrderDetails(page, summaries);

    // Save state again after successful scrape
    await saveBrowserState(context);
    await saveCache(allOrders);
    return allOrders;
  } finally {
    await browser.close();
  }
}

async function collectOrderSummaries(
  page: Page,
  year: number,
): Promise<OrderSummary[]> {
  const summaries: OrderSummary[] = [];
  const url = `https://www.amazon.com/gp/your-account/order-history?timeFilter=year-${String(year)}`;
  await page.goto(url);
  await page.waitForLoadState("domcontentloaded");

  let pageNum = 1;
  let hasMore = true;

  while (hasMore) {
    log.debug(`  Page ${String(pageNum)}...`);
    await page.waitForTimeout(1500);

    const cards = await getOrderCards(page);
    if (cards.length === 0) {
      hasMore = false;
      continue;
    }

    for (const card of cards) {
      const summary = await extractOrderSummary(card);
      if (summary) summaries.push(summary);
    }

    hasMore = await goToNextPage(page);
    if (hasMore) pageNum++;
  }

  return summaries;
}

async function getOrderCards(page: Page): Promise<Locator[]> {
  const cards = await page.locator(".order-card, .order").all();
  if (cards.length > 0) return cards;
  const altCards = await page
    .locator('[class*="order-card"], [data-component="order"]')
    .all();
  return altCards;
}

async function goToNextPage(page: Page): Promise<boolean> {
  const nextButton = page.locator(
    'li.a-last a, a:has-text("Next"), [aria-label="Next"]',
  );
  if (
    (await nextButton.count()) > 0 &&
    (await nextButton.first().isVisible())
  ) {
    await nextButton.first().click();
    await page.waitForLoadState("domcontentloaded");
    return true;
  }
  return false;
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
    if (date === undefined || date === "" || total === undefined || total === "") return null;

    const rawId = orderIdText?.trim();
    return {
      orderId: rawId !== undefined && rawId !== "" ? rawId : `unknown-${String(Date.now())}`,
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
): Promise<AmazonOrder[]> {
  const orders: AmazonOrder[] = [];

  for (let i = 0; i < summaries.length; i++) {
    const summary = summaries[i];
    if (!summary) continue;
    log.progress(i + 1, summaries.length, "order details fetched");

    const items = await scrapeOrderDetail(page, summary);
    orders.push({
      orderId: summary.orderId,
      date: summary.date,
      total: summary.total,
      items,
    });
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
    const titleLinks = await mainContent.locator('[data-component="itemTitle"] a[href*="/dp/"]').all();

    for (const link of titleLinks) {
      const title = await link.textContent();
      if (title === null || title.trim() === "" || title.trim().length < 10) continue;

      const trimmed = title.trim();

      // Skip price-like text, unit prices, and promotional links
      if (trimmed.startsWith("$")) continue;
      if (trimmed.startsWith("(")) continue;
      if (trimmed.startsWith("List Price")) continue;
      if (/^Amazon\s+(?:Secured|Business|Store)\s+Card/i.test(trimmed)) continue;

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
  const grid = link.locator("xpath=ancestor::div[contains(@class,'a-fixed-left-grid-inner')]").first();
  if ((await grid.count()) === 0) return 0;

  // Try data-component="unitPrice" first
  const unitPriceEl = grid.locator('[data-component="unitPrice"]');
  if ((await unitPriceEl.count()) > 0) {
    const priceText = await unitPriceEl.first().textContent() ?? "";
    const price = parsePrice(priceText);
    if (price > 0) return price;
  }

  // Fallback: find price in the right column of the grid
  const rightCol = grid.locator('.a-col-right, [class*="a-text-right"]');
  if ((await rightCol.count()) > 0) {
    const priceText = await rightCol.first().textContent() ?? "";
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
