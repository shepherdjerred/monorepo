import { z } from "zod";
declare const WeeklyParlayLifecycleSchema: z.ZodObject<{
    timezone: z.ZodString;
    slot: z.ZodNumber;
    openHour: z.ZodNumber;
    bettingCloseHour: z.ZodNumber;
    openActionBudgetMinutes: z.ZodNumber;
    finalHour: z.ZodNumber;
    updateHour: z.ZodNumber;
    updateCount: z.ZodNumber;
    actions: z.ZodTuple<[z.ZodLiteral<"open">, z.ZodLiteral<"reminder">, z.ZodLiteral<"start">, z.ZodLiteral<"progress">, z.ZodLiteral<"finalize">], null>;
}, z.core.$strict>;
export declare const WEEKLY_PARLAY_LIFECYCLE: {
    timezone: string;
    slot: number;
    openHour: number;
    bettingCloseHour: number;
    openActionBudgetMinutes: number;
    finalHour: number;
    updateHour: number;
    updateCount: number;
    actions: ["open", "reminder", "start", "progress", "finalize"];
};
export type WeeklyParlayLifecycle = z.infer<typeof WeeklyParlayLifecycleSchema>;
export declare const WEEKLY_PARLAY_OPEN_ACTION_BUDGET_MS: number;
export {};
