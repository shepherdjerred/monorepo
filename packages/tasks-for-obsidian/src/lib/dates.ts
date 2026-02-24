function toStartOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDate(dateStr: string): Date {
  return new Date(dateStr);
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

export function isUpcoming(dateStr?: string, days: number = 7): boolean {
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
