import { z } from "zod";
import rawLifecycle from "./weekly-parlay.json";

const WeeklyParlayLifecycleSchema = z.strictObject({
  timezone: z.string().min(1),
  slot: z.number().int().nonnegative(),
  openHour: z.number().int().min(0).max(23),
  bettingCloseHour: z.number().int().min(0).max(23),
  openActionBudgetMinutes: z.number().int().positive(),
  catchupMinimumBettingHours: z.number().int().positive(),
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

export const WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS =
  WEEKLY_PARLAY_LIFECYCLE.openActionBudgetMinutes * 60 * 1000;
export const WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_MS =
  WEEKLY_PARLAY_LIFECYCLE.catchupMinimumBettingHours * 60 * 60 * 1000;
