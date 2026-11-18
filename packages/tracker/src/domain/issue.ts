import type { z } from "zod";
import type { Impact, StateTypeSchema, Urgency } from "#shared/schema.ts";

export function parseIdentifier(value: string): {
  teamKey: string;
  number: number;
} {
  const match = /^([A-Z][A-Z0-9]*)[- ]([1-9]\d*)$/u.exec(
    value.toUpperCase().trim(),
  );
  if (match?.[1] === undefined || match[2] === undefined)
    throw new Error("Invalid issue identifier");
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number))
    throw new TypeError("Invalid issue number");
  return { teamKey: match[1], number };
}

/**
 * Levels in an issue hierarchy, counting the top-level issue as the first.
 * An issue on the last level cannot take sub-issues.
 */
export const MAX_ISSUE_DEPTH = 5;

export function identifier(teamKey: string, number: number): string {
  return `${teamKey}-${String(number)}`;
}

/**
 * Deterministic priority (0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low)
 * derived from impact, urgency, and vote count when neither is pinned manually.
 */
export function computePriority(input: {
  impact: Impact | null;
  urgency: Urgency | null;
  voteCount: number;
}): number {
  if (input.impact === null && input.urgency === null) return 0;
  const imp = input.impact ?? "medium";
  const urg = input.urgency ?? "medium";
  if ((imp === "high" && urg === "high") || input.voteCount >= 25) return 1;
  if (
    (imp === "high" && urg === "medium") ||
    (imp === "medium" && urg === "high") ||
    input.voteCount >= 8
  )
    return 2;
  return (imp === "medium" && urg === "medium") ||
    (imp === "high" && urg === "low") ||
    (imp === "low" && urg === "high")
    ? 3
    : 4;
}

/**
 * Resolves the next `{ priority, priorityManual }` state from the current row
 * and an incoming create/update/vote patch.
 */
export function resolveIssuePriority(
  current: {
    priority: number;
    priorityManual: boolean;
    impact: Impact | null;
    urgency: Urgency | null;
    voteCount: number;
  },
  patch: {
    priority?: number | undefined;
    priorityManual?: boolean | undefined;
    impact?: Impact | null | undefined;
    urgency?: Urgency | null | undefined;
    voteCount?: number | undefined;
  },
): { priority: number; priorityManual: boolean } {
  const impact = patch.impact === undefined ? current.impact : patch.impact;
  const urgency = patch.urgency === undefined ? current.urgency : patch.urgency;
  const voteCount = patch.voteCount ?? current.voteCount;

  if (patch.priorityManual === false) {
    return {
      priority: computePriority({ impact, urgency, voteCount }),
      priorityManual: false,
    };
  }
  if (patch.priority !== undefined) {
    const manual =
      impact === null && urgency === null && patch.priority === 0
        ? false
        : (patch.priorityManual ?? true);
    return {
      priority: patch.priority,
      priorityManual: manual,
    };
  }
  if (current.priorityManual) {
    return { priority: current.priority, priorityManual: true };
  }
  return {
    priority: computePriority({ impact, urgency, voteCount }),
    priorityManual: false,
  };
}

export function transitionTimestamps(
  type: z.infer<typeof StateTypeSchema>,
  previous: {
    startedAt: Date | null;
    completedAt: Date | null;
    canceledAt: Date | null;
  },
  now: Date,
) {
  return {
    startedAt: ["started", "completed"].includes(type)
      ? (previous.startedAt ?? now)
      : null,
    completedAt: type === "completed" ? (previous.completedAt ?? now) : null,
    canceledAt: ["canceled", "duplicate"].includes(type)
      ? (previous.canceledAt ?? now)
      : null,
  };
}

export function midpoint(
  before: number | undefined,
  after: number | undefined,
): number | null {
  if (before === undefined && after === undefined) return 1024;
  if (before === undefined) return (after ?? 0) - 1024;
  if (after === undefined) return before + 1024;
  if (after <= before) throw new Error("Invalid board neighbors");
  const next = before + (after - before) / 2;
  return next === before || next === after || after - before < 0.000001
    ? null
    : next;
}

export function searchTokens(value: string): string {
  return (
    value
      .normalize("NFKC")
      .match(/[\p{L}\p{N}]+/gu)
      ?.map((token) => `${token}:*`)
      .join(" & ") ?? ""
  );
}
