import { z } from "zod";

const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const PricePointSchema = z.object({
  date: DateString,
  price: z.number().positive(),
});

export const PurchaseSchema = z.object({
  date: DateString,
  quantity: z.number().int().positive(),
  pricePaid: z.number().positive(),
});

export const ComponentSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  ticker: z.string().regex(/^[A-Z0-9]{2,6}$/),
  name: z.string().min(1),
  category: z.enum([
    "CPU",
    "COOLER",
    "PASTE",
    "MOBO",
    "RAM",
    "SSD",
    "NVME",
    "CASE",
    "PSU",
    "FAN",
  ]),
  manufacturer: z.string().min(1),
  partNumber: z.string().min(1),
  purchases: z.array(PurchaseSchema).min(1),
  pcppUrl: z.url().optional(),
  history: z.array(PricePointSchema).min(2),
});

export const PortfolioSchema = z.object({
  owner: z.string(),
  buildName: z.string(),
  buildUrl: z.url().optional(),
  updatedAt: z.string(),
  components: z.array(ComponentSchema).min(1),
});

export type PricePoint = z.infer<typeof PricePointSchema>;
export type Purchase = z.infer<typeof PurchaseSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Portfolio = z.infer<typeof PortfolioSchema>;
