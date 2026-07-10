/**
 * Format a Date as a local-time `YYYY-MM-DD` string.
 *
 * Local (not UTC) is the contract: "today", stats windows, and recurring
 * instance dates all track the server's wall clock, so a task due today
 * doesn't roll over at UTC midnight. Defined once and shared by the task
 * repository, the v2 routes, and the legacy routes so the day boundary is
 * computed identically everywhere.
 */
export function ymd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}
