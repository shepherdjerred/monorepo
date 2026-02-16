import { z } from "zod";
import itemData from "./assets/item.json" with { type: "json" };

export const ItemSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      name: z.string(),
      description: z.string(), // Full HTML description with stats
      plaintext: z.string().optional(), // Short plain text description
      stats: z.record(z.string(), z.number()).optional(), // Item stats
    }),
  ),
});

export const items = ItemSchema.parse(itemData);

export function getItemInfo(itemId: number):
  | {
      name: string;
      description: string;
      plaintext?: string | undefined;
      stats?: Record<string, number> | undefined;
    }
  | undefined {
  const itemDataEntry = items.data[itemId.toString()];
  if (!itemDataEntry) {
    return undefined;
  }
  return {
    name: itemDataEntry.name,
    description: itemDataEntry.description, // Full tooltip
    plaintext: itemDataEntry.plaintext,
    stats: itemDataEntry.stats,
  };
}
