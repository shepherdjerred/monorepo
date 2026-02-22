import type { MonarchTransaction } from "./types.ts";

export type WeekGroup = {
  weekKey: string; // "2026-W08"
  startDate: string; // Monday ISO date
  endDate: string; // Sunday ISO date
  transactions: MonarchTransaction[];
};

export type WeekWindow = {
  previous: WeekGroup | undefined;
  current: WeekGroup;
  next: WeekGroup | undefined;
};

export function getISOWeekKey(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const dayOfWeek = date.getUTCDay();
  // Adjust to Thursday of the same ISO week
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() - ((dayOfWeek + 6) % 7) + 3);
  const jan1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(
    ((thursday.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${String(thursday.getUTCFullYear())}-W${String(weekNumber).padStart(2, "0")}`;
}

export function getWeekBounds(weekKey: string): {
  start: string;
  end: string;
} {
  const [yearStr, weekStr] = weekKey.split("-W");
  const year = Number(yearStr);
  const week = Number(weekStr);

  // Jan 4th is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay();
  // Monday of week 1
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - ((dayOfWeek + 6) % 7));

  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    start: monday.toISOString().split("T")[0] ?? "",
    end: sunday.toISOString().split("T")[0] ?? "",
  };
}

export function groupByWeek(
  transactions: MonarchTransaction[],
): WeekGroup[] {
  const weekMap = new Map<string, MonarchTransaction[]>();

  for (const txn of transactions) {
    const key = getISOWeekKey(txn.date);
    const existing = weekMap.get(key);
    if (existing) {
      existing.push(txn);
    } else {
      weekMap.set(key, [txn]);
    }
  }

  const weeks: WeekGroup[] = [];
  for (const [weekKey, txns] of weekMap) {
    const bounds = getWeekBounds(weekKey);
    txns.sort((a, b) => a.date.localeCompare(b.date));
    weeks.push({
      weekKey,
      startDate: bounds.start,
      endDate: bounds.end,
      transactions: txns,
    });
  }

  weeks.sort((a, b) => a.weekKey.localeCompare(b.weekKey));
  return weeks;
}

export function buildWeekWindows(weeks: WeekGroup[]): WeekWindow[] {
  return weeks.map((current, i) => ({
    previous: weeks[i - 1],
    current,
    next: weeks[i + 1],
  }));
}
