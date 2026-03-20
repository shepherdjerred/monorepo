import { z } from "zod";
import { DescriptionSchema } from "./enums.ts";

export const RawPerkStyleSelectionSchema = z
  .object({
    perk: z.number(),
    var1: z.number(),
    var2: z.number(),
    var3: z.number(),
  })
  .strict();

export const RawPerkStyleSchema = z
  .object({
    description: DescriptionSchema,
    selections: z.array(RawPerkStyleSelectionSchema),
    style: z.number(),
  })
  .strict();

export const RawPerkStatsSchema = z
  .object({
    defense: z.number(),
    flex: z.number(),
    offense: z.number(),
  })
  .strict();

export const RawPerksSchema = z
  .object({
    statPerks: RawPerkStatsSchema,
    styles: z.array(RawPerkStyleSchema),
  })
  .strict();

export type RawPerks = z.infer<typeof RawPerksSchema>;
