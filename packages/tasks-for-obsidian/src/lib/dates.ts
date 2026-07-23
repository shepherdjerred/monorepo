function toStartOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Parse a task date string into a local Date.
 *
 * Date-only strings ("YYYY-MM-DD") MUST be interpreted in local time: the
 * platform `new Date("2026-07-10")` parses them as UTC midnight, and reading
 * the local components then shifts the day backwards for any negative-UTC
 * offset (a task due today classifies as overdue, tomorrow's shows as today).
 * Full timestamps carry their own offset and are parsed as-is.
 */
export function parseLocalDate(dateStr: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
    );
  }
  return new Date(dateStr);
}

function parseDate(dateStr: string): Date {
  return parseLocalDate(dateStr);
}

/** Format a local Date as YYYY-MM-DD. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The upcoming Saturday as YYYY-MM-DD — Todoist's "this weekend". On a
 * Saturday this is today, matching how "this weekend" reads mid-weekend.
 */
export function nextSaturday(from = new Date()): string {
  const d = toStartOfDay(from);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return toISODate(d);
}

/**
 * The next Monday as YYYY-MM-DD, always strictly in the future — Todoist's
 * "next week" (never +7 days: on a Wednesday it's 5 days out, not 7).
 */
export function nextMonday(from = new Date()): string {
  const d = toStartOfDay(from);
  d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7 || 7));
  return toISODate(d);
}

export function isToday(dateStr?: string): boolean {
  if (!dateStr) return false;
  const date = toStartOfDay(parseDate(dateStr));
  const today = toStartOfDay(new Date());
  return date.getTime() === today.getTime();
}

export function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  const date = toStartOfDay(parseDate(dateStr));
  const today = toStartOfDay(new Date());
  return date.getTime() < today.getTime();
}

export function isUpcoming(dateStr?: string, days = 7): boolean {
  if (!dateStr) return false;
  const date = toStartOfDay(parseDate(dateStr));
  const today = toStartOfDay(new Date());
  if (date.getTime() <= today.getTime()) return false;
  if (!Number.isFinite(days)) return true;
  const future = new Date(today);
  future.setDate(future.getDate() + days);
  return date.getTime() <= future.getTime();
}

export function getDateGroup(dateStr: string): string {
  const date = toStartOfDay(parseDate(dateStr));
  const today = toStartOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + (7 - today.getDay()));

  if (date.getTime() < today.getTime()) return "Overdue";
  if (date.getTime() === today.getTime()) return "Today";
  if (date.getTime() === tomorrow.getTime()) return "Tomorrow";
  if (date.getTime() <= endOfWeek.getTime()) return "This Week";
  return formatDate(dateStr);
}

export function formatRelativeDate(dateStr: string): string {
  const date = toStartOfDay(parseDate(dateStr));
  const today = toStartOfDay(new Date());
  const diffMs = date.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < -1) return `${Math.abs(diffDays)}d ago`;
  if (diffDays === -1) return "Yesterday";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7) return `In ${diffDays}d`;
  return formatDate(dateStr);
}

export function formatDate(dateStr: string): string {
  const date = parseDate(dateStr);
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = date.getDate();
  return `${month} ${day}`;
}
