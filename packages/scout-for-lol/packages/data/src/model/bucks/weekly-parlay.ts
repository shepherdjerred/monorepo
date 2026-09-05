import { z } from "zod";
import rawLifecycle from "./weekly-parlay.json" with { type: "json" };

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
    z.literal("cancel"),
    z.literal("analytics_sync"),
  ]),
});

export const WEEKLY_PARLAY_LIFECYCLE =
  WeeklyParlayLifecycleSchema.parse(rawLifecycle);
export type WeeklyParlayLifecycle = z.infer<typeof WeeklyParlayLifecycleSchema>;

export const WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS =
  WEEKLY_PARLAY_LIFECYCLE.openActionBudgetMinutes * 60 * 1000;
export const WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_MS =
  WEEKLY_PARLAY_LIFECYCLE.catchupMinimumBettingHours * 60 * 60 * 1000;

export const WeeklyParlayCatchupWindowSchema = z.strictObject({
  kind: z.literal("catch_up"),
  openAt: z.iso.datetime(),
  bettingClosesAt: z.iso.datetime(),
  scoringStartsAt: z.iso.datetime(),
  scoringEndsAt: z.iso.datetime(),
});

export const WeeklyParlayControlActionSchema = z
  .strictObject({
    periodKey: z.iso.date(),
    slot: z.number().int().nonnegative().default(WEEKLY_PARLAY_LIFECYCLE.slot),
    action: z.enum(WEEKLY_PARLAY_LIFECYCLE.actions),
    updateIndex: z
      .number()
      .int()
      .min(0)
      .max(WEEKLY_PARLAY_LIFECYCLE.updateCount - 1)
      .optional(),
    window: WeeklyParlayCatchupWindowSchema.optional(),
  })
  .superRefine((action, context) => {
    if (action.action === "progress" && action.updateIndex === undefined) {
      context.addIssue({
        code: "custom",
        path: ["updateIndex"],
        message: "Progress actions require an update index.",
      });
    }
    if (action.action !== "progress" && action.updateIndex !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["updateIndex"],
        message: "Only progress actions accept an update index.",
      });
    }
    if (action.action !== "open" && action.window !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["window"],
        message: "Only open actions accept a catch-up window.",
      });
    }
  });

export type WeeklyParlayControlAction = z.infer<
  typeof WeeklyParlayControlActionSchema
>;
