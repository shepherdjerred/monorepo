import type { Page, Locator, FrameLocator } from "playwright";
import { chromium } from "playwright";
import path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { CostcoOrder, CostcoItem, CostcoCache } from "./types.ts";
import { log } from "../logger.ts";
import { parseReceiptLines } from "./receipt-parser.ts";

const CostcoCacheSchema = z.object({
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
        }),
      ),
      source: z.enum(["online", "warehouse"]),
    }),
  ),
});

const CACHE_PATH = path.join(homedir(), ".monarch-costco-cache.json");
const PROFILE_DIR = path.join(homedir(), ".monarch-costco-profile");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function loadCache(): Promise<CostcoOrder[] | null> {
  const file = Bun.file(CACHE_PATH);
  if (!(await file.exists())) return null;

  const raw = await file.text();
  const cache: CostcoCache = CostcoCacheSchema.parse(JSON.parse(raw));
  const age = Date.now() - new Date(cache.scrapedAt).getTime();

  if (age > CACHE_MAX_AGE_MS) {
    log.info("Costco cache expired, will re-scrape");
    return null;
  }

  log.info(`Loaded ${String(cache.orders.length)} Costco orders from cache`);
  return cache.orders;
}

async function saveCache(orders: CostcoOrder[]): Promise<void> {
  const cache: CostcoCache = {
    scrapedAt: new Date().toISOString(),
    orders,
  };
  await Bun.write(CACHE_PATH, JSON.stringify(cache, null, 2));
  log.info(`Saved ${String(orders.length)} Costco orders to cache`);
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

async function getCostcoCredentials(): Promise<{
  email: string;
  password: string;
}> {
  log.info("Fetching Costco credentials from 1Password...");
  const [email, password] = await Promise.all([
    runOp(["item", "get", "Costco", "--fields", "username", "--reveal"]),
    runOp(["item", "get", "Costco", "--fields", "password", "--reveal"]),
  ]);
  return { email, password };
}

function getLoginFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[src*="signin.costco.com"]');
}


async function autoLogin(page: Page): Promise<void> {
  const { email, password } = await getCostcoCredentials();

  // Login form is inside an iframe from signin.costco.com (Azure B2C)
  const frame = getLoginFrame(page);

  const emailField = frame.locator('#signInName');
  await emailField.waitFor({ state: "visible", timeout: 15_000 });
  await emailField.fill(email);

  const passwordField = frame.locator('#password');
  await passwordField.fill(password);

  const signInBtn = frame.locator('#next');
  await signInBtn.click();

  // Wait for login to complete — iframe disappears and SPA loads
  await page.locator('iframe[src*="signin.costco.com"]').waitFor({ state: "hidden", timeout: 60_000 });
  await page.waitForTimeout(3000);
}


function extractUserId(url: string): string | null {
  const match = /#\/app\/([\da-f-]+)\//i.exec(url);
  return match?.[1] ?? null;
}

export async function scrapeCostcoOrders(
  forceScrape: boolean,
): Promise<CostcoOrder[]> {
  if (!forceScrape) {
    const cached = await loadCache();
    if (cached) return cached;
  }

  log.info("Launching browser for Costco...");
  // Use persistent context with assistantMode to avoid Akamai bot detection.
  // assistantMode disables navigator.webdriver and other automation markers.
  // Cookies persist natively in the Chrome profile directory between runs.
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: "chrome",
    ignoreDefaultArgs: ["--disable-extensions"],
    // @ts-expect-error -- assistantMode is an undocumented Playwright option that disables automation markers
    assistantMode: true,
  });
  const page = context.pages()[0] ?? await context.newPage();

  try {
    await page.goto("https://www.costco.com/myaccount/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    const loginIframeCount = await page.locator('iframe[src*="signin.costco.com"]').count();
    if (loginIframeCount > 0) {
      log.info("Costco login required...");
      await autoLogin(page);
      log.info("Costco login successful");
    } else {
      log.info("Logged into Costco with persistent profile");
    }

    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    const userId = extractUserId(currentUrl);
    if (userId === null) {
      throw new Error(`Could not extract userId from URL: ${currentUrl}`);
    }
    log.debug(`Costco userId: ${userId}`);

    await page.goto(`https://www.costco.com/myaccount/#/app/${userId}/ordersandpurchases`);
    await page.waitForTimeout(3000);

    const heading = page.locator('text="Orders and Purchases", text="Orders & Purchases"').first();
    await heading.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
      log.warn("Could not find Orders heading, continuing anyway...");
    });

    const onlineOrders = await scrapeOnlineOrders(page, userId);
    log.info(`Found ${String(onlineOrders.length)} online orders`);

    const warehouseOrders = await scrapeWarehouseOrders(page);
    log.info(`Found ${String(warehouseOrders.length)} warehouse orders`);

    const allOrders = [...onlineOrders, ...warehouseOrders];

    await saveCache(allOrders);
    return allOrders;
  } finally {
    await context.close();
  }
}

type OnlineOrderSummary = {
  orderId: string;
  date: string;
  total: number;
  detailUrl: string;
};

async function scrapeOnlineOrders(page: Page, userId: string): Promise<CostcoOrder[]> {
  log.info("Scraping online orders...");
  const summaries: OnlineOrderSummary[] = [];

  await iterateDateRanges(page, async () => {
    const cards = await page.locator('[class*="order-card"], [class*="order-tile"], [data-testid*="order"]').all();

    for (const card of cards) {
      const summary = await extractOnlineSummary(card, userId);
      if (summary !== null && !summaries.some((s) => s.orderId === summary.orderId)) {
        summaries.push(summary);
      }
    }
  });

  log.info(`Found ${String(summaries.length)} online order summaries`);

  const orders: CostcoOrder[] = [];
  for (const [i, summary] of summaries.entries()) {
    log.progress(i + 1, summaries.length, "online order details fetched");
    const items = await scrapeOnlineOrderDetail(page, summary);
    orders.push({
      orderId: summary.orderId,
      date: summary.date,
      total: summary.total,
      items,
      source: "online",
    });
  }

  return orders;
}

async function extractOnlineSummary(card: Locator, userId: string): Promise<OnlineOrderSummary | null> {
  try {
    const text = await card.textContent() ?? "";

    const orderMatch = /\d{10,}/.exec(text);
    const orderId = orderMatch?.[0];
    if (orderId === undefined) return null;

    const dateMatch = /(\w+ \d{1,2},\s*\d{4})/.exec(text);
    const rawDate = dateMatch?.[1];
    if (rawDate === undefined) return null;
    const date = parseCostcoDate(rawDate);
    if (date === "") return null;

    const total = parsePrice(text);
    if (total <= 0) return null;

    return {
      orderId,
      date,
      total,
      detailUrl: `https://www.costco.com/myaccount/#/app/${userId}/orderdetails/${orderId}`,
    };
  } catch {
    return null;
  }
}

async function scrapeOnlineOrderDetail(
  page: Page,
  summary: OnlineOrderSummary,
): Promise<CostcoItem[]> {
  try {
    await page.goto(summary.detailUrl);
    await page.waitForTimeout(3000);

    const items: CostcoItem[] = [];
    const productEls = await page.locator('[class*="product-name"], [class*="item-name"], [class*="item-description"] a, [data-testid*="product"]').all();

    for (const el of productEls) {
      const rawTitle = await el.textContent();
      const title = rawTitle?.trim() ?? "";
      if (title.length < 3) continue;
      if (items.some((existing) => existing.title === title)) continue;

      const parent = el.locator("xpath=ancestor::div[contains(@class,'item') or contains(@class,'product') or contains(@class,'row')]").first();
      let price = 0;
      const priceEl = parent.locator('[class*="price"], [data-testid*="price"]').first();
      if ((await priceEl.count()) > 0) {
        const priceText = await priceEl.textContent();
        price = parsePrice(priceText ?? "");
      }
      items.push({ title, price, quantity: 1 });
    }

    if (items.length === 0) {
      return [{ title: "Unknown Costco Online Purchase", price: summary.total, quantity: 1 }];
    }
    return items;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to scrape Costco online order ${summary.orderId}: ${message}`);
    return [{ title: "Unknown Costco Online Purchase", price: summary.total, quantity: 1 }];
  }
}

async function scrapeWarehouseOrders(page: Page): Promise<CostcoOrder[]> {
  log.info("Scraping warehouse receipts...");

  const warehouseTab = page.locator('text="Warehouse", text="In-Warehouse"').first();
  try {
    await warehouseTab.waitFor({ state: "visible", timeout: 10_000 });
    await warehouseTab.click();
    await page.waitForTimeout(3000);
  } catch {
    log.warn("Could not find Warehouse tab, skipping in-store receipts");
    return [];
  }

  const allOrders: CostcoOrder[] = [];
  const seenKeys = new Set<string>();

  await iterateDateRanges(page, async () => {
    const receiptButtons = await page.locator('button:has-text("View Receipt"), a:has-text("View Receipt")').all();
    log.debug(`Found ${String(receiptButtons.length)} receipt buttons in current period`);

    for (const btn of receiptButtons) {
      const order = await scrapeOneWarehouseReceipt(page, btn, seenKeys);
      if (order !== null) {
        allOrders.push(order);
      }
    }
  });

  return allOrders;
}

async function scrapeOneWarehouseReceipt(
  page: Page,
  btn: Locator,
  seenKeys: Set<string>,
): Promise<CostcoOrder | null> {
  try {
    const card = btn.locator("xpath=ancestor::div[contains(@class,'card') or contains(@class,'receipt') or contains(@class,'tile')]").first();
    const cardText = await card.textContent().catch(() => "") ?? "";

    const dateMatch = /(\d{1,2}\/\d{1,2}\/\d{2,4}|\w+ \d{1,2},\s*\d{4})/.exec(cardText);
    const rawDate = dateMatch?.[1];
    const date = rawDate === undefined ? "" : parseCostcoDate(rawDate);
    const total = parsePrice(cardText);

    const dedupeKey = `${date}-${String(total)}`;
    if (seenKeys.has(dedupeKey)) return null;
    seenKeys.add(dedupeKey);

    await btn.click();
    await page.waitForTimeout(2000);

    const items = await parseWarehouseReceipt(page);
    await closeDialog(page);

    const receiptTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const finalTotal = total > 0 ? total : receiptTotal;

    return {
      orderId: `warehouse-${date}-${String(Math.round(finalTotal * 100))}`,
      date,
      total: finalTotal,
      items,
      source: "warehouse",
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to scrape warehouse receipt: ${message}`);
    await page.keyboard.press("Escape").catch((_: unknown) => {
      log.debug("Could not press Escape to close dialog");
    });
    await page.waitForTimeout(500);
    return null;
  }
}

async function closeDialog(page: Page): Promise<void> {
  const closeBtn = page.locator('dialog button[aria-label="Close"], dialog button:has-text("Close"), [class*="modal"] button[aria-label="Close"], button[class*="close"]').first();
  await ((await closeBtn.count()) > 0
    ? closeBtn.click()
    : page.keyboard.press("Escape"));
  await page.waitForTimeout(500);
}

async function parseWarehouseReceipt(page: Page): Promise<CostcoItem[]> {
  const rows = await page.locator('dialog table tbody tr, [class*="modal"] table tbody tr, [role="dialog"] table tbody tr').all();

  const lines: string[] = [];
  if (rows.length > 0) {
    for (const row of rows) {
      const cells = await row.locator("td").all();
      const cellTexts: string[] = [];
      for (const cell of cells) {
        const text = await cell.textContent() ?? "";
        cellTexts.push(text.trim());
      }
      lines.push(cellTexts.join(" ").trim());
    }
  } else {
    const dialogText = await page.locator('dialog, [class*="modal"], [role="dialog"]').first().textContent().catch(() => null);
    if (dialogText === null || dialogText === "") {
      return [{ title: "Unknown Costco Warehouse Purchase", price: 0, quantity: 1 }];
    }
    lines.push(...dialogText.split("\n").map((l) => l.trim()).filter((l) => l !== ""));
  }

  return parseReceiptLines(lines);
}

async function iterateDateRanges(page: Page, callback: () => Promise<void>): Promise<void> {
  await callback();

  const combobox = page.locator('select[class*="date"], select[class*="period"], [role="combobox"], select').first();
  if ((await combobox.count()) === 0) return;

  const options = await combobox.locator("option").all();
  if (options.length <= 1) return;

  for (const option of options.slice(1)) {
    const value = await option.getAttribute("value") ?? "";
    const label = await option.textContent() ?? "";
    if (value === "" && label === "") continue;

    log.debug(`Selecting date range: ${label.trim()}`);
    await combobox.selectOption(value === ""
      ? { label: label.trim() }
      : value);
    await page.waitForTimeout(3000);

    await callback();
  }
}

function parseCostcoDate(text: string): string {
  const cleaned = text.replaceAll(/\s+/g, " ").trim();

  const slashMatch = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(cleaned);
  if (slashMatch?.[1] !== undefined && slashMatch[2] !== undefined && slashMatch[3] !== undefined) {
    const month = slashMatch[1].padStart(2, "0");
    const day = slashMatch[2].padStart(2, "0");
    let year = slashMatch[3];
    if (year.length === 2) {
      year = `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }

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
