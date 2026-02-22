import { z } from "zod";
import type { CostcoOrder, CostcoCache } from "./types.ts";
import { log } from "../logger.ts";
import costcoOrdersJson from "./costco-orders.json";

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

export function loadCostcoOrders(): CostcoOrder[] {
  const cache: CostcoCache = CostcoCacheSchema.parse(costcoOrdersJson);
  log.info(`Loaded ${String(cache.orders.length)} Costco orders from hardcoded data`);
  return cache.orders;
}
