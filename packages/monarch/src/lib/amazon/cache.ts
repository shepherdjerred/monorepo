import { rename } from "node:fs/promises";
import { z } from "zod";
import type { AmazonOrder, AmazonCache, AmazonCharge } from "./types.ts";
import {
  AMAZON_ORDERS_PATH,
  LEGACY_AMAZON_ORDERS_PATH,
  resolveCachePath,
} from "../finance-vault.ts";
import { PurchasedItemSchema } from "../purchase-item.ts";
import { log } from "../logger.ts";

// The order cache is hours of headed scraping, so it lives in the vault
// alongside the other durable finance data rather than in scratch. Writes are
// merges: a scrape covering one year must never discard the others.

// What an order has always carried. The charge list is the only thing the two
// cache versions disagree about, so it is the only thing either schema adds.
const OrderSchema = z.object({
  orderId: z.string(),
  date: z.string(),
  total: z.number(),
  items: z.array(
    PurchasedItemSchema.extend({
      orderDate: z.string(),
      orderId: z.string(),
    }),
  ),
});

export const AmazonCacheSchema = z.object({
  version: z.literal(2),
  scrapedAt: z.string(),
  orders: z.array(
    OrderSchema.extend({
      charges: z.array(
        z.object({
          date: z.string(),
          amount: z.number(),
          description: z.string(),
        }),
      ),
    }),
  ),
});

// The pre-charge cache, written before card charges were scraped. Read rather
// than discarded — a default scrape only covers the current and previous
// years, so throwing this away silently loses every older order that was
// already paid for in scraping time.
const LegacyAmazonCacheSchema = z.object({
  version: z.literal(1),
  scrapedAt: z.string(),
  orders: z.array(OrderSchema),
});

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_ITEM_TITLE = "Unknown Amazon Purchase";

async function readCacheFile(): Promise<AmazonCache | null> {
  const cachePath = await resolveCachePath(
    AMAZON_ORDERS_PATH,
    LEGACY_AMAZON_ORDERS_PATH,
  );
  const file = Bun.file(cachePath);
  return (await file.exists())
    ? parseAmazonCache(JSON.parse(await file.text()))
    : null;
}

// Reads either schema. A v1 cache is migrated, not discarded: returning null
// for it dropped every order already scraped, and the default scrape that
// followed only covers the current and previous years, so the merge wrote a
// cache with the older history missing.
export function parseAmazonCache(parsed: unknown): AmazonCache {
  const versionProbe = z
    .object({ version: z.number().optional() })
    .parse(parsed);
  if (versionProbe.version === 1) {
    const legacy = LegacyAmazonCacheSchema.parse(parsed);
    log.info(
      `Migrating ${String(legacy.orders.length)} orders from the pre-charge Amazon cache`,
    );
    return {
      version: 2,
      scrapedAt: legacy.scrapedAt,
      orders: legacy.orders.map((order) => ({ ...order, charges: [] })),
    };
  }
  return AmazonCacheSchema.parse(parsed);
}

export async function loadCache(): Promise<AmazonOrder[] | null> {
  const cache = await readCacheFile();
  if (cache === null) return null;

  const age = Date.now() - new Date(cache.scrapedAt).getTime();
  if (age > CACHE_MAX_AGE_MS) {
    log.info("Amazon cache expired, will re-scrape");
    return null;
  }

  log.info(`Loaded ${String(cache.orders.length)} orders from cache`);
  return cache.orders;
}

// Everything already scraped, regardless of age — the base a merge builds on.
export async function loadCachedOrdersIgnoringAge(): Promise<AmazonOrder[]> {
  const cache = await readCacheFile();
  return cache?.orders ?? [];
}

function isPlaceholder(order: AmazonOrder): boolean {
  return order.items.every((item) => item.title === UNKNOWN_ITEM_TITLE);
}

function mergeCharges(
  existing: AmazonCharge[],
  scraped: AmazonCharge[],
): AmazonCharge[] {
  const seen = new Map<string, AmazonCharge>();
  for (const charge of [...existing, ...scraped]) {
    seen.set(
      `${charge.date}|${charge.amount.toFixed(2)}|${charge.description}`,
      charge,
    );
  }
  return [...seen.values()];
}

function mergeOrder(existing: AmazonOrder, scraped: AmazonOrder): AmazonOrder {
  // Prefer whichever side actually knows what was bought.
  const preferScrapedItems =
    scraped.items.length > existing.items.length ||
    (isPlaceholder(existing) && !isPlaceholder(scraped));
  return {
    orderId: existing.orderId,
    date: scraped.total === 0 ? existing.date : scraped.date,
    total: scraped.total === 0 ? existing.total : scraped.total,
    items: preferScrapedItems ? scraped.items : existing.items,
    charges: mergeCharges(existing.charges, scraped.charges),
  };
}

export function mergeOrders(
  existing: AmazonOrder[],
  scraped: AmazonOrder[],
): AmazonOrder[] {
  const byId = new Map(existing.map((order) => [order.orderId, order]));
  for (const order of scraped) {
    const prior = byId.get(order.orderId);
    byId.set(order.orderId, prior ? mergeOrder(prior, order) : order);
  }
  return [...byId.values()].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || a.orderId.localeCompare(b.orderId),
  );
}

export async function saveMergedCache(
  scraped: AmazonOrder[],
): Promise<AmazonOrder[]> {
  const existing = await loadCachedOrdersIgnoringAge();
  const merged = mergeOrders(existing, scraped);
  const added = merged.length - existing.length;

  // Revalidate before writing: a merge must never emit a shape the loader
  // would reject.
  const cache: AmazonCache = AmazonCacheSchema.parse({
    version: 2,
    scrapedAt: new Date().toISOString(),
    orders: merged,
  });

  // Temp + rename, so a crash mid-write cannot destroy hours of scraping.
  const tempPath = `${AMAZON_ORDERS_PATH}.tmp`;
  await Bun.write(tempPath, JSON.stringify(cache, null, 2));
  await rename(tempPath, AMAZON_ORDERS_PATH);

  log.info(
    `Merged ${String(scraped.length)} scraped orders into ${String(existing.length)} cached (${String(added)} new, ${String(scraped.length - added)} updated)`,
  );
  return merged;
}
