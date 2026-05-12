import { CronExpressionParser } from "cron-parser";
import { z } from "zod";

export const DEFAULT_COMPETITION_CRON = "0 0 * * *";

const MIN_FIRE_GAP_MS = 23 * 60 * 60 * 1000;
const FIRE_SAMPLE_COUNT = 10;

export const CronPresets = [
  { label: "Daily — midnight UTC", value: "0 0 * * *" },
  { label: "Daily — 9am UTC", value: "0 9 * * *" },
  { label: "Daily — noon UTC", value: "0 12 * * *" },
  { label: "Weekly — Sunday midnight UTC", value: "0 0 * * 0" },
  { label: "Weekly — Monday midnight UTC", value: "0 0 * * 1" },
  { label: "Monthly — 1st midnight UTC", value: "0 0 1 * *" },
] as const;

export const CompetitionCronSchema = z
  .string()
  .trim()
  .min(1, { message: "CRON expression must not be empty" })
  .superRefine((value, ctx) => {
    let iterator;
    try {
      iterator = CronExpressionParser.parse(value, { tz: "UTC" });
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: `Invalid CRON expression: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    let previous = iterator.next().toDate();
    for (let i = 1; i < FIRE_SAMPLE_COUNT; i++) {
      const current = iterator.next().toDate();
      if (current.getTime() - previous.getTime() < MIN_FIRE_GAP_MS) {
        ctx.addIssue({
          code: "custom",
          message:
            "Schedule must fire at most once per day (minimum 23h between fires).",
        });
        return;
      }
      previous = current;
    }
  });

export type CompetitionCron = z.infer<typeof CompetitionCronSchema>;

export function computeNextScheduledUpdateAt(
  cronExpression: string,
  from: Date,
): Date {
  return CronExpressionParser.parse(cronExpression, {
    currentDate: from,
    tz: "UTC",
  })
    .next()
    .toDate();
}
