// @bun
// src/model/weekly-parlay.ts
import { z } from "zod";
// src/model/weekly-parlay.json
var weekly_parlay_default = {
  timezone: "America/Los_Angeles",
  slot: 0,
  openHour: 12,
  bettingCloseHour: 0,
  openActionBudgetMinutes: 4,
  finalHour: 11,
  updateHour: 19,
  updateCount: 6,
  actions: ["open", "reminder", "start", "progress", "finalize"]
};

// src/model/weekly-parlay.ts
var WeeklyParlayLifecycleSchema = z.strictObject({
  timezone: z.string().min(1),
  slot: z.number().int().nonnegative(),
  openHour: z.number().int().min(0).max(23),
  bettingCloseHour: z.number().int().min(0).max(23),
  openActionBudgetMinutes: z.number().int().positive(),
  finalHour: z.number().int().min(0).max(23),
  updateHour: z.number().int().min(0).max(23),
  updateCount: z.number().int().positive(),
  actions: z.tuple([
    z.literal("open"),
    z.literal("reminder"),
    z.literal("start"),
    z.literal("progress"),
    z.literal("finalize")
  ])
});
var WEEKLY_PARLAY_LIFECYCLE = WeeklyParlayLifecycleSchema.parse(weekly_parlay_default);
var WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS = WEEKLY_PARLAY_LIFECYCLE.openActionBudgetMinutes * 60 * 1000;
export {
  WEEKLY_PARLAY_LIFECYCLE,
  WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS
};
