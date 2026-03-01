import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CostcoOrder, CostcoCache } from "./types.ts";
import { log } from "../logger.ts";

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

const ORDERS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "costco-orders.json");

export async function loadCostcoOrders(): Promise<CostcoOrder[]> {
  const file = Bun.file(ORDERS_PATH);
  if (!(await file.exists())) {
    log.warn("costco-orders.json not found, returning empty orders");
    return [];
  }
  const raw = JSON.parse(await file.text()) as unknown;
  const cache: CostcoCache = CostcoCacheSchema.parse(raw);
  log.info(
    `Loaded ${String(cache.orders.length)} Costco orders from hardcoded data`,
  );
  return cache.orders;
}
