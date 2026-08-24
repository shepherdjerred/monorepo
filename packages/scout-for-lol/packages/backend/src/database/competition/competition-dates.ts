import { SeasonIdSchema } from "@scout-for-lol/data";
import { z } from "zod";
import { differenceInCalendarDays } from "date-fns";

/**
 * How a competition's window is expressed: fixed dates or a League season.
 *
 * Kept out of `validation.ts` because the query helpers consume the derived
 * type while `validation.ts` calls into those same helpers — declaring it
 * there made the two modules import each other.
 */
export const MAX_COMPETITION_DURATION_DAYS = 90;

/**
 * Fixed-date competition schema
 * Enforces date ordering and duration limits at the type level
 */
const FixedDateCompetitionSchema = z
  .object({
    type: z.literal("FIXED_DATES"),
    startDate: z.date(),
    endDate: z.date(),
  })
  .refine((data) => data.startDate < data.endDate, {
    message: "startDate must be before endDate",
    path: ["startDate"],
  })
  .superRefine((data, ctx) => {
    const durationDays = differenceInCalendarDays(data.endDate, data.startDate);
    if (durationDays > MAX_COMPETITION_DURATION_DAYS) {
      ctx.addIssue({
        code: "custom",
        message: `Competition duration cannot exceed ${MAX_COMPETITION_DURATION_DAYS.toString()} days (got ${durationDays.toString()} days)`,
        path: ["endDate"],
      });
    }
  });

/**
 * Season-based competition schema
 * No date constraints - follows League's season timing
 * Uses predefined season IDs only
 */
const SeasonBasedCompetitionSchema = z.object({
  type: z.literal("SEASON"),
  seasonId: SeasonIdSchema,
});

/**
 * Discriminated union for competition dates
 * Type system enforces XOR constraint - can't have both fixed dates AND season
 */
export const CompetitionDatesSchema = z.discriminatedUnion("type", [
  FixedDateCompetitionSchema,
  SeasonBasedCompetitionSchema,
]);

export type CompetitionDates = z.infer<typeof CompetitionDatesSchema>;
