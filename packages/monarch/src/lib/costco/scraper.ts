import { z } from "zod";
import type { CostcoOrder, CostcoCache } from "./types.ts";
import { log } from "../logger.ts";
import { COSTCO_ORDERS_PATH } from "../finance-vault.ts";
import { PurchasedItemSchema } from "../purchase-item.ts";

const CostcoCacheSchema = z.object({
  scrapedAt: z.string(),
  orders: z.array(
    z.object({
      orderId: z.string(),
      date: z.string(),
      total: z.number(),
      items: z.array(PurchasedItemSchema),
      source: z.enum(["online", "warehouse"]),
    }),
  ),
});

export async function loadCostcoOrders(
  ordersPath = COSTCO_ORDERS_PATH,
): Promise<CostcoOrder[]> {
  const file = Bun.file(ordersPath);
  if (!(await file.exists())) {
    log.warn(
      `costco-orders.json not found at ${ordersPath}, returning empty orders`,
    );
    return [];
  }
  const raw = JSON.parse(await file.text()) as unknown;
  const cache: CostcoCache = CostcoCacheSchema.parse(raw);
  log.info(
    `Loaded ${String(cache.orders.length)} Costco orders from the finance vault`,
  );
  return cache.orders;
}
