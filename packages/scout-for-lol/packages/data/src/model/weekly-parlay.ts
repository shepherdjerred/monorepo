import { z } from "zod";
import rawLifecycle from "./weekly-parlay.json";

const WeeklyParlayLifecycleSchema = z.strictObject({
  timezone: z.string().min(1),
  slot: z.number().int().nonnegative(),
  openHour: z.number().int().min(0).max(23),
  bettingCloseHour: z.number().int().min(0).max(23),
  finalHour: z.number().int().min(0).max(23),
  updateHour: z.number().int().min(0).max(23),
  updateCount: z.number().int().positive(),
  actions: z.tuple([
    z.literal("open"),
    z.literal("reminder"),
    z.literal("start"),
    z.literal("progress"),
    z.literal("finalize"),
  ]),
});

export const WEEKLY_PARLAY_LIFECYCLE =
  WeeklyParlayLifecycleSchema.parse(rawLifecycle);
export type WeeklyParlayLifecycle = z.infer<typeof WeeklyParlayLifecycleSchema>;
