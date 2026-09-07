import { z } from "zod";
declare const WeeklyParlayLifecycleSchema: z.ZodObject<{
    timezone: z.ZodString;
    slot: z.ZodNumber;
    openHour: z.ZodNumber;
    bettingCloseHour: z.ZodNumber;
    openActionBudgetMinutes: z.ZodNumber;
    catchupMinimumBettingHours: z.ZodNumber;
    finalHour: z.ZodNumber;
    updateHour: z.ZodNumber;
    updateCount: z.ZodNumber;
    actions: z.ZodTuple<[z.ZodLiteral<"open">, z.ZodLiteral<"reminder">, z.ZodLiteral<"start">, z.ZodLiteral<"progress">, z.ZodLiteral<"finalize">, z.ZodLiteral<"cancel">, z.ZodLiteral<"analytics_sync">], null>;
}, z.core.$strict>;
export declare const WEEKLY_PARLAY_LIFECYCLE: {
    timezone: string;
    slot: number;
    openHour: number;
    bettingCloseHour: number;
    openActionBudgetMinutes: number;
    catchupMinimumBettingHours: number;
    finalHour: number;
    updateHour: number;
    updateCount: number;
    actions: ["open", "reminder", "start", "progress", "finalize", "cancel", "analytics_sync"];
};
export type WeeklyParlayLifecycle = z.infer<typeof WeeklyParlayLifecycleSchema>;
export declare const WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS: number;
export declare const WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_MS: number;
export declare const WeeklyParlayCatchupWindowSchema: z.ZodObject<{
    kind: z.ZodLiteral<"catch_up">;
    openAt: z.ZodISODateTime;
    bettingClosesAt: z.ZodISODateTime;
    scoringStartsAt: z.ZodISODateTime;
    scoringEndsAt: z.ZodISODateTime;
}, z.core.$strict>;
export declare const WeeklyParlayControlActionSchema: z.ZodObject<{
    periodKey: z.ZodISODate;
    slot: z.ZodDefault<z.ZodNumber>;
    action: z.ZodEnum<{
        analytics_sync: "analytics_sync";
        cancel: "cancel";
        finalize: "finalize";
        open: "open";
        progress: "progress";
        reminder: "reminder";
        start: "start";
    }>;
    updateIndex: z.ZodOptional<z.ZodNumber>;
    window: z.ZodOptional<z.ZodObject<{
        kind: z.ZodLiteral<"catch_up">;
        openAt: z.ZodISODateTime;
        bettingClosesAt: z.ZodISODateTime;
        scoringStartsAt: z.ZodISODateTime;
        scoringEndsAt: z.ZodISODateTime;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type WeeklyParlayControlAction = z.infer<typeof WeeklyParlayControlActionSchema>;
export {};
