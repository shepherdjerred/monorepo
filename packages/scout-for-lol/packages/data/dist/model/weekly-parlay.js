// @bun
// src/model/bucks/weekly-parlay.ts
import { z } from "zod";
// src/model/bucks/weekly-parlay.json
var weekly_parlay_default = {
  timezone: "America/Los_Angeles",
  slot: 0,
  openHour: 12,
  bettingCloseHour: 0,
  openActionBudgetMinutes: 4,
  catchupMinimumBettingHours: 6,
  finalHour: 11,
  updateHour: 19,
  updateCount: 6,
  actions: [
    "open",
    "reminder",
    "start",
    "progress",
    "finalize",
    "cancel",
    "analytics_sync"
  ]
};

// src/model/bucks/weekly-parlay.ts
var WeeklyParlayLifecycleSchema = z.strictObject({
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
    z.literal("cancel"),
    z.literal("analytics_sync")
  ])
});
var WEEKLY_PARLAY_LIFECYCLE = WeeklyParlayLifecycleSchema.parse(weekly_parlay_default);
var WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS = WEEKLY_PARLAY_LIFECYCLE.openActionBudgetMinutes * 60 * 1000;
var WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_MS = WEEKLY_PARLAY_LIFECYCLE.catchupMinimumBettingHours * 60 * 60 * 1000;
var WeeklyParlayCatchupWindowSchema = z.strictObject({
  kind: z.literal("catch_up"),
  openAt: z.iso.datetime(),
  bettingClosesAt: z.iso.datetime(),
  scoringStartsAt: z.iso.datetime(),
  scoringEndsAt: z.iso.datetime()
});
var WeeklyParlayControlActionSchema = z.strictObject({
  periodKey: z.iso.date(),
  slot: z.number().int().nonnegative().default(WEEKLY_PARLAY_LIFECYCLE.slot),
  action: z.enum(WEEKLY_PARLAY_LIFECYCLE.actions),
  updateIndex: z.number().int().min(0).max(WEEKLY_PARLAY_LIFECYCLE.updateCount - 1).optional(),
  window: WeeklyParlayCatchupWindowSchema.optional()
}).superRefine((action, context) => {
  if (action.action === "progress" && action.updateIndex === undefined) {
    context.addIssue({
      code: "custom",
      path: ["updateIndex"],
      message: "Progress actions require an update index."
    });
  }
  if (action.action !== "progress" && action.updateIndex !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["updateIndex"],
      message: "Only progress actions accept an update index."
    });
  }
  if (action.action !== "open" && action.window !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["window"],
      message: "Only open actions accept a catch-up window."
    });
  }
});
export {
  WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_MS,
  WEEKLY_PARLAY_LIFECYCLE,
  WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS,
  WeeklyParlayCatchupWindowSchema,
  WeeklyParlayControlActionSchema
};
