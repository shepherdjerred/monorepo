const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a historical timestamp falls in the current UTC Monday-Sunday week.
 *
 * The year is intentionally ignored. The caller filters out recent rows first,
 * so this matches the same calendar week from the older archive, including
 * weeks that cross New Year's Day. */
export function isInHistoricalUtcWeek(datetime: Date, now: Date): boolean {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const weekStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysSinceMonday,
    ),
  );

  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(weekStart.getTime() + offset * DAY_MS);
    if (
      datetime.getUTCMonth() === day.getUTCMonth() &&
      datetime.getUTCDate() === day.getUTCDate()
    ) {
      return true;
    }
  }
  return false;
}
