export type Priority = "highest" | "high" | "medium" | "normal" | "low" | "none";

export const PRIORITY_ORDER: Record<Priority, number> = {
  highest: 0,
  high: 1,
  medium: 2,
  normal: 3,
  low: 4,
  none: 5,
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  highest: "#dc2626",
  high: "#f97316",
  medium: "#3b82f6",
  normal: "#6b7280",
  low: "#9ca3af",
  none: "#d1d5db",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  highest: "P1",
  high: "P2",
  medium: "P3",
  normal: "Normal",
  low: "P4",
  none: "None",
};

export const ALL_PRIORITIES: readonly Priority[] = ["highest", "high", "medium", "normal", "low", "none"] as const;

export function comparePriority(a: Priority, b: Priority): number {
  return PRIORITY_ORDER[a] - PRIORITY_ORDER[b];
}
