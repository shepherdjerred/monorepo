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
      gold: z.object({
        base: z.number(),
        purchasable: z.boolean(),
        total: z.number(),
        sell: z.number(),
      }),
      from: z.array(z.string()).optional(),
      into: z.array(z.string()).optional(),
      maps: z.record(z.string(), z.boolean()).default({}),
      tags: z.array(z.string()).default([]),
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
      gold: {
        base: number;
        purchasable: boolean;
        total: number;
        sell: number;
      };
      from?: string[] | undefined;
      into?: string[] | undefined;
      maps: Record<string, boolean>;
      tags: string[];
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
    gold: itemDataEntry.gold,
    from: itemDataEntry.from,
    into: itemDataEntry.into,
    maps: itemDataEntry.maps,
    tags: itemDataEntry.tags,
  };
}
