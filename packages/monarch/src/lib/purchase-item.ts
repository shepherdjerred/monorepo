import { z } from "zod";

// The shape every vendor's order cache stores per purchased item. Vendor
// directories are isolated from each other, so the shared fragment lives
// here and each cache schema extends it.
export const PurchasedItemSchema = z.object({
  title: z.string(),
  price: z.number(),
  quantity: z.number(),
});
