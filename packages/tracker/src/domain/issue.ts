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

function sizingMatrixPriority(
  impact: Impact | null,
  urgency: Urgency | null,
): number {
  if (impact === null && urgency === null) return 0;
  const imp = impact ?? "medium";
  const urg = urgency ?? "medium";
  if (imp === "high" && urg === "high") return 1;
  if (
    (imp === "high" && urg === "medium") ||
    (imp === "medium" && urg === "high")
  )
    return 2;
  return (imp === "medium" && urg === "medium") ||
    (imp === "high" && urg === "low") ||
    (imp === "low" && urg === "high")
    ? 3
    : 4;
}

function voteBoostTiers(voteCount: number): 0 | 1 | 2 | 3 {
  if (voteCount >= 20) return 3;
  if (voteCount >= 8) return 2;
  return voteCount >= 3 ? 1 : 0;
}

/**
 * Deterministic priority (0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low)
 * derived from impact, urgency, and vote count when not pinned manually.
 *
 * Votes promote priority by +1 tier at 3+ votes, +2 tiers at 8+ votes, and
 * +3 tiers (Urgent) at 20+ votes; untriaged issues with 3+ votes self-escalate
 * starting at Medium (3 at 3–7 votes, 2 at 8–19 votes, 1 at 20+ votes).
 */
export function computePriority(input: {
  impact: Impact | null;
  urgency: Urgency | null;
  voteCount: number;
}): number {
  const base = sizingMatrixPriority(input.impact, input.urgency);
  const boost = voteBoostTiers(input.voteCount);
  if (base === 0) {
    return boost === 0 ? 0 : Math.max(1, 4 - boost);
  }
  return Math.max(1, base - boost);
}

/** True when `voteCount` actively lifted `computePriority` above base sizing. */
export function isVoteBoostedPriority(input: {
  impact: Impact | null;
  urgency: Urgency | null;
  voteCount: number;
}): boolean {
  const base = sizingMatrixPriority(input.impact, input.urgency);
  const computed = computePriority(input);
  return computed > 0 && (base === 0 || computed < base);
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
  const autoPriority = computePriority({ impact, urgency, voteCount });

  if (patch.priorityManual === false) {
    return {
      priority: autoPriority,
      priorityManual: false,
    };
  }
  if (patch.priority !== undefined) {
    const manual =
      autoPriority === 0 && patch.priority === 0
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
    priority: autoPriority,
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
