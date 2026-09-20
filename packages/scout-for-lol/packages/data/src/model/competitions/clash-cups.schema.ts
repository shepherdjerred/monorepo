import { z } from "zod";
import { PlatformRouteSchema } from "#src/model/core/routes.ts";

/**
 * Language-neutral Clash cup calendar (`clash-cups.json`).
 *
 * Clash-v1 does not return past tournaments. This file is a committed map from
 * UTC calendar date + queue onto a cup `nameKey` and day, used only when a
 * game was never snapshotted. It is not scraped at runtime.
 */

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const DateOnlySchema = z
  .string()
  .regex(DATE_ONLY_REGEX, "expected a YYYY-MM-DD calendar date")
  .refine((value) => {
    const parts = value.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "expected a real calendar date (valid month 01-12 and day for that month)");

export const ClashCupQueueSchema = z.enum(["clash", "aram clash"]);
export type ClashCupQueue = z.infer<typeof ClashCupQueueSchema>;

export const ClashCupDaySchema = z.enum(["day_1", "day_2"]);
export type ClashCupDay = z.infer<typeof ClashCupDaySchema>;

export const ClashCupSourceSchema = z.enum(["manual"]);
export type ClashCupSource = z.infer<typeof ClashCupSourceSchema>;

export const ClashCupSchema = z
  .strictObject({
    nameKey: z.string().min(1),
    queue: ClashCupQueueSchema,
    saturday: DateOnlySchema,
    sunday: DateOnlySchema.nullable(),
    shards: z.array(PlatformRouteSchema).min(1).optional(),
    source: ClashCupSourceSchema.default("manual"),
  })
  .superRefine((cup, ctx) => {
    if (cup.sunday !== null && cup.sunday <= cup.saturday) {
      ctx.addIssue({
        code: "custom",
        message: `sunday (${cup.sunday}) must be after saturday (${cup.saturday})`,
        path: ["sunday"],
      });
    }
  });
export type ClashCup = z.infer<typeof ClashCupSchema>;

export const ClashCupsFileSchema = z
  .strictObject({
    cups: z.array(ClashCupSchema).min(1),
  })
  .superRefine((file, ctx) => {
    for (const [index, cup] of file.cups.entries()) {
      if (index === 0) {
        continue;
      }
      const previous = file.cups[index - 1];
      if (previous === undefined) {
        continue;
      }
      if (cup.saturday < previous.saturday) {
        ctx.addIssue({
          code: "custom",
          message: `cups must be sorted ascending by saturday; cup ${index.toString()} (${cup.saturday}) is before cup ${(index - 1).toString()} (${previous.saturday})`,
          path: ["cups", index, "saturday"],
        });
      }
    }
  });
export type ClashCupsFile = z.infer<typeof ClashCupsFileSchema>;
