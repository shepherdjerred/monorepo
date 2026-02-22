import path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { AmazonBatchOrderClassification, TransactionClassification } from "./types.ts";
import { log } from "../logger.ts";

const CACHE_DIR = path.join(homedir(), ".monarch-cache");
const ORDER_CACHE_PATH = path.join(CACHE_DIR, "classifications.json");
const WEEK_CACHE_PATH = path.join(CACHE_DIR, "week-classifications.json");

// --- Order classification cache (Amazon/Costco) ---

const CachedClassificationSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      price: z.number(),
      categoryId: z.string(),
      categoryName: z.string(),
    }),
  ),
  needsSplit: z.boolean(),
});

const OrderCacheFileSchema = z.record(z.string(), CachedClassificationSchema);

type CachedClassification = z.infer<typeof CachedClassificationSchema>;

let orderCache: Map<string, CachedClassification> | undefined;

async function ensureOrderCacheLoaded(): Promise<Map<string, CachedClassification>> {
  if (orderCache !== undefined) return orderCache;

  orderCache = new Map();
  const file = Bun.file(ORDER_CACHE_PATH);
  if (await file.exists()) {
    const raw: unknown = JSON.parse(await file.text());
    const parsed = OrderCacheFileSchema.parse(raw);
    for (const [key, value] of Object.entries(parsed)) {
      orderCache.set(key, value);
    }
    log.info(`Loaded ${String(orderCache.size)} cached order classifications`);
  }
  return orderCache;
}

export async function getCachedClassification(
  orderId: string,
): Promise<CachedClassification | undefined> {
  const c = await ensureOrderCacheLoaded();
  return c.get(orderId);
}

export async function cacheClassifications(
  entries: { orderId: string; classification: AmazonBatchOrderClassification }[],
): Promise<void> {
  const c = await ensureOrderCacheLoaded();
  for (const { orderId, classification } of entries) {
    c.set(orderId, {
      items: classification.items,
      needsSplit: classification.needsSplit,
    });
  }
  const obj: Record<string, CachedClassification> = Object.fromEntries(c);
  await Bun.write(ORDER_CACHE_PATH, JSON.stringify(obj, null, 2));
}

// --- Week classification cache ---

const CachedWeekSchema = z.object({
  transactionIds: z.array(z.string()),
  results: z.array(
    z.object({
      transactionId: z.string(),
      categoryId: z.string(),
      categoryName: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

const WeekCacheFileSchema = z.record(z.string(), CachedWeekSchema);

type CachedWeek = z.infer<typeof CachedWeekSchema>;

let weekCache: Map<string, CachedWeek> | undefined;

async function ensureWeekCacheLoaded(): Promise<Map<string, CachedWeek>> {
  if (weekCache !== undefined) return weekCache;

  weekCache = new Map();
  const file = Bun.file(WEEK_CACHE_PATH);
  if (await file.exists()) {
    const raw: unknown = JSON.parse(await file.text());
    const parsed = WeekCacheFileSchema.parse(raw);
    for (const [key, value] of Object.entries(parsed)) {
      weekCache.set(key, value);
    }
    log.info(`Loaded ${String(weekCache.size)} cached week classifications`);
  }
  return weekCache;
}

function weekCacheKey(weekKey: string, transactionIds: string[]): string {
  return `${weekKey}:${[...transactionIds].toSorted().join(",")}`;
}

export async function getCachedWeek(
  weekKey: string,
  classifiableIds: string[],
): Promise<TransactionClassification[] | undefined> {
  const c = await ensureWeekCacheLoaded();
  const key = weekCacheKey(weekKey, classifiableIds);
  const entry = c.get(key);
  if (entry === undefined) return undefined;
  return entry.results;
}

export async function cacheWeekClassification(
  weekKey: string,
  classifiableIds: string[],
  results: TransactionClassification[],
): Promise<void> {
  const c = await ensureWeekCacheLoaded();
  const key = weekCacheKey(weekKey, classifiableIds);
  c.set(key, { transactionIds: classifiableIds, results });
  const obj: Record<string, CachedWeek> = Object.fromEntries(c);
  await Bun.write(WEEK_CACHE_PATH, JSON.stringify(obj, null, 2));
}
