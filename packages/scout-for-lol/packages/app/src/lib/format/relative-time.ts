const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function plural(count: number, unit: string): string {
  return `${count.toString()} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * When something happened, the way a sentence says it: "Just now", "5 minutes
 * ago", "2 hours ago", "Yesterday", "3 days ago", then the date.
 */
export function relativeWhen(atMs: number, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - atMs);
  if (elapsed < MINUTE_MS) return "Just now";
  if (elapsed < HOUR_MS) {
    return `${plural(Math.floor(elapsed / MINUTE_MS), "minute")} ago`;
  }
  if (elapsed < DAY_MS) {
    return `${plural(Math.floor(elapsed / HOUR_MS), "hour")} ago`;
  }
  const days = Math.floor(elapsed / DAY_MS);
  if (days === 1) return "Yesterday";
  return days < 7 ? `${days.toString()} days ago` : MONTH_DAY.format(atMs);
}

/** The lower-case form for the end of a sentence: "yesterday", "2 hours ago". */
export function relativeWhenInline(atMs: number, nowMs: number): string {
  const text = relativeWhen(atMs, nowMs);
  return text === "Just now" || text === "Yesterday"
    ? text.toLowerCase()
    : text;
}
