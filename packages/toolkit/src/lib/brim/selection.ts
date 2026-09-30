import { formatPercent } from "#lib/brim/rank.ts";
import type { RankedEntry, RankResult } from "#lib/brim/rank.ts";

export type PickerOption = {
  readonly key: string;
  readonly entry: RankedEntry;
};

/** Selectable entries in cursor order: ranked budgets, then other windows. */
export function pickerOptions(result: RankResult): PickerOption[] {
  return [...result.ranked, ...result.other].map((entry) => ({
    key: entry.provider,
    entry,
  }));
}

/** Wrap-around cursor movement for the picker list. */
export function moveIndex(index: number, delta: 1 | -1, count: number): number {
  return count <= 0 ? 0 : (index + delta + count) % count;
}

function formatBudget(entry: RankedEntry): string {
  if (entry.budgetUsed !== null && entry.budgetKind !== null) {
    return `${entry.budgetKind} ${formatPercent(entry.budgetUsed)} used`;
  }
  if (entry.fallbackWindow !== null) {
    const [label, used] = entry.fallbackWindow;
    return `${label} ${formatPercent(used)} used`;
  }
  return "no budget data";
}

/** Budget pressure, mirroring Brim's remaining-based quota thresholds. */
export type Pressure = "ok" | "low" | "critical";

export function pressureForRemaining(
  remaining: number | null,
): Pressure | null {
  if (remaining === null || !Number.isFinite(remaining)) return null;
  if (remaining < 10) return "critical";
  return remaining < 30 ? "low" : "ok";
}

export function pressureColor(
  pressure: Pressure | null,
): "green" | "yellow" | "red" {
  switch (pressure) {
    case "critical":
      return "red";
    case "low":
      return "yellow";
    case "ok":
    case null:
      return "green";
  }
}

/** Fixed-width block bar of budget consumption (█ used, ░ remaining). */
export function usageBar(used: number, width = 10): string {
  const clamped = Math.min(100, Math.max(0, used));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Column widths that keep every picker row aligned. */
export type ColumnWidths = {
  readonly name: number;
  readonly kind: number;
  readonly percent: number;
  readonly fiveHour: number;
  readonly pace: number;
};

export function columnWidths(entries: readonly RankedEntry[]): ColumnWidths {
  let name = 0;
  for (const entry of entries) {
    name = Math.max(name, entry.displayName.length);
  }
  return { name, kind: 7, percent: 5, fiveHour: 4, pace: 7 };
}

/** Remaining budget percent for pressure coloring, or null when unknown. */
export function budgetRemaining(entry: RankedEntry): number | null {
  const used = entry.budgetUsed ?? entry.fallbackWindow?.[1] ?? null;
  return used === null ? null : 100 - used;
}

export function formatPickerName(entry: RankedEntry): string {
  const names =
    entry.accountLabel === null
      ? [entry.displayName]
      : [entry.displayName, `(${entry.accountLabel})`];
  return names.join(" ");
}

export function formatPickerStats(entry: RankedEntry): string {
  const parts: string[] = [formatBudget(entry)];
  parts.push(
    entry.fiveHourUsed === null
      ? "5h n/a"
      : `5h ${formatPercent(entry.fiveHourUsed)} used`,
  );
  if (entry.pace !== null) parts.push(`pace ${entry.pace}`);
  if (entry.budgetResetsIn !== null)
    parts.push(`resets in ${entry.budgetResetsIn}`);
  return parts.join(" · ");
}

/** One-line row text shared by the plain renderer and the Ink picker. */
export function formatPickerRow(entry: RankedEntry): string {
  return `${formatPickerName(entry)} — ${formatPickerStats(entry)}`;
}

/**
 * Compact stats for the boxed Ink picker, where every row must fit the
 * terminal width: labels shrink to `weekly 8% · 5h 1% · ahead · 3d`.
 */
export function formatCompactStats(entry: RankedEntry): string {
  const parts: string[] = [];
  if (entry.budgetUsed !== null && entry.budgetKind !== null) {
    parts.push(`${entry.budgetKind} ${formatPercent(entry.budgetUsed)}`);
  } else if (entry.fallbackWindow !== null) {
    const [label, used] = entry.fallbackWindow;
    parts.push(`${label} ${formatPercent(used)}`);
  }
  parts.push(
    entry.fiveHourUsed === null
      ? "5h n/a"
      : `5h ${formatPercent(entry.fiveHourUsed)}`,
  );
  if (entry.pace !== null) parts.push(entry.pace);
  if (entry.budgetResetsIn !== null) parts.push(entry.budgetResetsIn);
  return parts.join(" · ");
}

/**
 * Column-aligned stats for the boxed Ink picker: every segment is padded so
 * bars, percents, and countdowns line up across rows of different widths.
 */
export function formatAlignedStats(
  entry: RankedEntry,
  widths: ColumnWidths,
): string {
  const parts: string[] = [];
  if (entry.budgetUsed !== null && entry.budgetKind !== null) {
    const percent = formatPercent(entry.budgetUsed).padStart(widths.percent);
    parts.push(`${entry.budgetKind.padEnd(widths.kind)} ${percent}`);
  } else if (entry.fallbackWindow !== null) {
    const [label, used] = entry.fallbackWindow;
    parts.push(`${label} ${formatPercent(used)}`);
  }
  const fiveHour =
    entry.fiveHourUsed === null
      ? "n/a".padStart(widths.fiveHour)
      : formatPercent(entry.fiveHourUsed).padStart(widths.fiveHour);
  parts.push(`5h ${fiveHour}`);
  if (entry.pace !== null) {
    parts.push(entry.pace.padEnd(widths.pace));
  } else if (entry.budgetResetsIn !== null) {
    parts.push("".padEnd(widths.pace));
  }
  if (entry.budgetResetsIn !== null) parts.push(entry.budgetResetsIn);
  return parts.join(" · ");
}
