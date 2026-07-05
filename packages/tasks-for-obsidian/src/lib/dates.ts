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
  const future = new Date(today);
  future.setDate(future.getDate() + days);
  return date.getTime() > today.getTime() && date.getTime() <= future.getTime();
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
