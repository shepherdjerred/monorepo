/** Recap schedule arithmetic.
 *
 *  Split from `recap.ts` because that module pulls in the Discord client
 *  (which logs in at import time), which would make these untestable. */
import { CronExpressionParser } from "cron-parser";

export const DEFAULT_RECAP_CRON = "0 17 * * 5";

/** Next fire time for a CRON expression, evaluated in UTC.
 *  Throws on an invalid expression so a bad config is rejected at write time
 *  rather than silently never firing. */
export function computeNextRecapAt(cron: string, from: Date): Date {
  return CronExpressionParser.parse(cron, { currentDate: from, tz: "UTC" })
    .next()
    .toDate();
}

export function isValidCron(cron: string): boolean {
  // cron-parser accepts an empty string, which would store a schedule that
  // silently never fires. Scout's competition schema guards the same way.
  if (cron.trim() === "") {
    return false;
  }
  try {
    CronExpressionParser.parse(cron, { tz: "UTC" });
    return true;
  } catch {
    return false;
  }
}

/** A recap can only be enabled when its next dispatch has somewhere to go. */
export function canEnableRecap(
  enabled: boolean,
  channelId: string | null,
): boolean {
  return !enabled || channelId !== null;
}
