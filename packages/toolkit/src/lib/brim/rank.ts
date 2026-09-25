import { z } from "zod";
import { COCOA_EPOCH_OFFSET_SECONDS, cocoaToMs } from "#lib/brim/cache.ts";
import type { UsageSnapshot, UsageWindow } from "#lib/brim/cache.ts";

const StaleDetailSchema = z.object({ reason: z.string().min(1) });

/** Canonical provider order, mirroring Brim's `ProviderID.allCases`. */
export const PROVIDER_ORDER: readonly string[] = [
  "claude-code",
  "codex",
  "antigravity",
  "cursor",
  "grok",
  "kimi",
  "muse",
];

const DISPLAY_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  antigravity: "Google Antigravity",
  cursor: "Cursor",
  grok: "Grok",
  kimi: "Kimi Code",
  muse: "Meta Muse",
};

export function displayName(provider: string): string {
  return DISPLAY_NAMES[provider] ?? provider;
}

export type PaceStatus = "ahead" | "on-pace" | "behind";

/** The quota budget a ranking entry is ordered by. */
export type BudgetKind = "weekly" | "monthly";

export type RankedEntry = {
  readonly provider: string;
  readonly displayName: string;
  readonly accountLabel: string | null;
  readonly available: boolean;
  /** Non-null when `available` is false. */
  readonly reason: string | null;
  readonly fiveHourUsed: number | null;
  /**
   * Most-consumed weekly/monthly window, or null for `other` entries.
   * Multi-pool providers rank by their tightest pool: the spawned session
   * cannot choose which pool it consumes, so the roomiest pool must not
   * mask an exhausted one.
   */
  readonly budgetUsed: number | null;
  readonly budgetKind: BudgetKind | null;
  readonly pace: PaceStatus | null;
  /** Human countdown to the budget reset, or null when unknown. */
  readonly budgetResetsIn: string | null;
  /**
   * Best remaining window for entries with no weekly/monthly budget
   * (e.g. Kimi's shared usage), as `[label, usedPercent]`.
   */
  readonly fallbackWindow: readonly [string, number] | null;
  /** Human age of the snapshot, or null when unknown. */
  readonly snapshotAge: string | null;
};

export type RankResult = {
  /** Providers with a weekly/monthly budget, least consumption first. */
  readonly ranked: readonly RankedEntry[];
  /** Available providers with neither budget; shown with their best window. */
  readonly other: readonly RankedEntry[];
  readonly unavailable: readonly RankedEntry[];
};

export type RankOptions = {
  /** Minimum 5-hour *remaining* percent to stay available. Default 10. */
  readonly minFiveHourRemaining?: number;
  /** Millis since the Unix epoch. Defaults to now. */
  readonly nowMs?: number;
};

const WEEK_SECONDS = 7 * 86_400;
/**
 * Cursor-style billing cycles have no machine-readable length, so monthly
 * pacing assumes a 30-day cycle. Ranking degrades to plain consumption order
 * when the reset falls outside it.
 */
const MONTH_SECONDS = 30 * 86_400;
const ON_PACE_TOLERANCE = 0.15;

function kindKey(window: UsageWindow): string {
  const keys = Object.keys(window.kind);
  const first = keys[0];
  return first ?? "";
}

/** Mirrors `UsageWindow.isWeekly`: exact weekly kinds plus weekly labels. */
export function isWeeklyWindow(window: UsageWindow): boolean {
  return (
    kindKey(window) === "weekly" ||
    window.label.toLowerCase().includes("weekly")
  );
}

export function isMonthlyWindow(window: UsageWindow): boolean {
  return (
    kindKey(window) === "monthly" ||
    window.label.toLowerCase().includes("monthly")
  );
}

/**
 * The 5-hour gate window: Brim labels these exactly `5-hour` (Claude, Kimi,
 * Muse) or `<model> 5-hour` (Antigravity's per-model buckets).
 */
export function isFiveHourWindow(window: UsageWindow): boolean {
  return window.label.toLowerCase().includes("5-hour");
}

function usedValue(window: UsageWindow): number | null {
  const used = window.usedPercent;
  if (used === null || used === undefined) return null;
  return Number.isFinite(used) ? used : null;
}

function paceForDuration(
  used: number,
  secondsRemaining: number,
  totalSeconds: number,
): PaceStatus | null {
  if (
    !Number.isFinite(secondsRemaining) ||
    secondsRemaining <= 0 ||
    secondsRemaining > totalSeconds
  ) {
    return null;
  }
  const remaining = 100 - used;
  const daysRemaining = secondsRemaining / 86_400;
  const evenPace = 100 / (totalSeconds / 86_400);
  const actualPace = remaining / daysRemaining;
  if (actualPace >= evenPace * (1 + ON_PACE_TOLERANCE)) return "ahead";
  return actualPace <= evenPace * (1 - ON_PACE_TOLERANCE)
    ? "behind"
    : "on-pace";
}

/**
 * Port of Brim's `WindowPacing.compute`: compares remaining-per-day against
 * an even weekly burn. Returns null for non-weekly windows, missing data, or
 * resets outside the (0, 7d] range. Times are Cocoa seconds; only their
 * difference matters, so no epoch conversion is needed.
 */
export function computePace(
  window: UsageWindow,
  nowCocoaSeconds: number,
): PaceStatus | null {
  if (kindKey(window) !== "weekly") return null;
  const used = usedValue(window);
  const resetAt = window.resetAt;
  return used === null || resetAt === null || resetAt === undefined
    ? null
    : paceForDuration(used, resetAt - nowCocoaSeconds, WEEK_SECONDS);
}

/**
 * Monthly equivalent of `computePace` over an assumed 30-day billing cycle.
 * Cursor exposes no machine-readable cycle length, so this is a ranking aid,
 * not Brim-parity display data.
 */
export function computeMonthlyPace(
  window: UsageWindow,
  nowCocoaSeconds: number,
): PaceStatus | null {
  if (kindKey(window) !== "monthly") return null;
  const used = usedValue(window);
  const resetAt = window.resetAt;
  return used === null || resetAt === null || resetAt === undefined
    ? null
    : paceForDuration(used, resetAt - nowCocoaSeconds, MONTH_SECONDS);
}

/** Display rounding for provider percentages (86.4155 -> "86.4%"). */
export function formatPercent(used: number): string {
  return `${String(Math.round(used * 10) / 10)}%`;
}

function paceRank(pace: PaceStatus | null): number {
  switch (pace) {
    case "ahead":
      return 0;
    case "on-pace":
      return 1;
    case "behind":
      return 2;
    case null:
      return 3;
  }
}

/** Port of Brim's `QuotaTimeFormatter.compactCountdown`. */
export function countdown(fromSeconds: number, toSeconds: number): string {
  const seconds = Math.floor(toSeconds - fromSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "now";
  if (seconds > 1e12) return "unknown";
  if (seconds < 60) return "<1m";
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0)
    return hours > 0
      ? `${String(days)}d ${String(hours)}h`
      : `${String(days)}d`;
  if (hours > 0)
    return minutes > 0
      ? `${String(hours)}h ${String(minutes)}m`
      : `${String(hours)}h`;
  return `${String(minutes)}m`;
}

/** Port of Brim's `QuotaTimeFormatter.refreshAge`. */
export function ageString(sinceMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - sinceMs) / 1000));
  if (!Number.isFinite(seconds)) return "unknown age";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24
    ? `${String(hours)}h ago`
    : `${String(Math.floor(hours / 24))}d ago`;
}

function providerOrderIndex(provider: string): number {
  const index = PROVIDER_ORDER.indexOf(provider);
  return index === -1 ? PROVIDER_ORDER.length : index;
}

function freshnessKey(snapshot: UsageSnapshot): string {
  if (snapshot.freshness === undefined) return "current";
  const keys = Object.keys(snapshot.freshness);
  const first = keys[0];
  return first ?? "current";
}

function staleReason(snapshot: UsageSnapshot): string {
  const freshness = snapshot.freshness;
  if (freshness === undefined) return "unknown reason";
  const parsed = StaleDetailSchema.safeParse(freshness["stale"]);
  return parsed.success ? parsed.data.reason : "unknown reason";
}

type RankContext = {
  readonly minFiveHourRemaining: number;
  readonly nowMs: number;
  readonly nowCocoa: number;
};

type ClassifiedEntry = {
  readonly bucket: "ranked" | "other" | "unavailable";
  readonly entry: RankedEntry;
};

function tightestFiveHourUsed(windows: readonly UsageWindow[]): number | null {
  let tightest: number | null = null;
  for (const window of windows) {
    const used = isFiveHourWindow(window) ? usedValue(window) : null;
    if (used !== null && (tightest === null || used > tightest)) {
      tightest = used;
    }
  }
  return tightest;
}

function isBudgetWindow(window: UsageWindow): boolean {
  return isWeeklyWindow(window) || isMonthlyWindow(window);
}

function budgetKindOf(window: UsageWindow): BudgetKind {
  return isWeeklyWindow(window) ? "weekly" : "monthly";
}

function leastUsed(
  windows: readonly UsageWindow[],
): { window: UsageWindow; used: number } | null {
  let best: UsageWindow | null = null;
  let bestUsed = 0;
  for (const window of windows) {
    const used = usedValue(window) ?? 0;
    if (best === null || used < bestUsed) {
      best = window;
      bestUsed = used;
    }
  }
  return best === null ? null : { window: best, used: bestUsed };
}

/** Most-consumed window: the safe ranking basis for multi-pool providers. */
function tightestUsed(
  windows: readonly UsageWindow[],
): { window: UsageWindow; used: number } | null {
  let tightest: UsageWindow | null = null;
  let tightestUsedValue = 0;
  for (const window of windows) {
    const used = usedValue(window) ?? 0;
    if (tightest === null || used > tightestUsedValue) {
      tightest = window;
      tightestUsedValue = used;
    }
  }
  return tightest === null
    ? null
    : { window: tightest, used: tightestUsedValue };
}

function paceForBudget(
  candidates: readonly UsageWindow[],
  kind: BudgetKind,
  nowCocoa: number,
): PaceStatus | null {
  const exact = candidates.filter((window) => kindKey(window) === kind);
  const target = tightestUsed(exact) ?? tightestUsed(candidates);
  if (target === null) return null;
  return kind === "weekly"
    ? computePace(target.window, nowCocoa)
    : computeMonthlyPace(target.window, nowCocoa);
}

function classifySnapshot(
  snapshot: UsageSnapshot,
  context: RankContext,
): ClassifiedEntry {
  const snapshotMs = cocoaToMs(snapshot.sourceTimestamp);
  const snapshotAge = Number.isFinite(snapshotMs)
    ? ageString(snapshotMs, context.nowMs)
    : null;
  const base = {
    provider: snapshot.provider,
    displayName: displayName(snapshot.provider),
    accountLabel: snapshot.accountLabel ?? null,
    snapshotAge,
  };
  const unavailable = (
    reason: string,
    fiveHourUsed: number | null = null,
  ): ClassifiedEntry => ({
    bucket: "unavailable",
    entry: {
      ...base,
      available: false,
      reason,
      fiveHourUsed,
      budgetUsed: null,
      budgetKind: null,
      pace: null,
      budgetResetsIn: null,
      fallbackWindow: null,
    },
  });

  if (freshnessKey(snapshot) !== "current") {
    return unavailable(`stale: ${staleReason(snapshot)}`);
  }

  const usable = snapshot.windows.filter(
    (window) => usedValue(window) !== null,
  );
  const fiveHourUsed = tightestFiveHourUsed(usable);
  if (fiveHourUsed !== null) {
    const fiveHourRemaining = 100 - fiveHourUsed;
    if (fiveHourRemaining < context.minFiveHourRemaining) {
      return unavailable(
        `5-hour exhausted (${formatPercent(fiveHourUsed)} used)`,
        fiveHourUsed,
      );
    }
  }

  const candidates = usable.filter((window) => isBudgetWindow(window));
  if (candidates.length === 0) {
    const fallback = leastUsed(
      usable.filter((window) => !isFiveHourWindow(window)),
    );
    // No weekly/monthly budget and no other usable window: there is no
    // quota evidence to rank or spawn on, so the provider is unavailable
    // rather than selectable with a null window.
    if (fallback === null) {
      return unavailable("no usable usage window", fiveHourUsed);
    }
    return {
      bucket: "other",
      entry: {
        ...base,
        available: true,
        reason: null,
        fiveHourUsed,
        budgetUsed: null,
        budgetKind: null,
        pace: null,
        budgetResetsIn: null,
        fallbackWindow: [fallback.window.label, fallback.used],
      },
    };
  }
  const best = tightestUsed(candidates);
  if (best === null) {
    return unavailable("no usable budget window", fiveHourUsed);
  }
  const kind = budgetKindOf(best.window);
  const resetAt = best.window.resetAt;
  return {
    bucket: "ranked",
    entry: {
      ...base,
      available: true,
      reason: null,
      fiveHourUsed,
      budgetUsed: best.used,
      budgetKind: kind,
      pace: paceForBudget(candidates, kind, context.nowCocoa),
      budgetResetsIn:
        resetAt === null || resetAt === undefined
          ? null
          : countdown(context.nowCocoa, resetAt),
      fallbackWindow: null,
    },
  };
}

function orderedProviders(
  byProvider: ReadonlyMap<string, UsageSnapshot>,
): string[] {
  const known = PROVIDER_ORDER.filter((provider) => byProvider.has(provider));
  const extra = [...byProvider.keys()].filter(
    (provider) => !PROVIDER_ORDER.includes(provider),
  );
  return [...known, ...extra];
}

function compareRanked(a: RankedEntry, b: RankedEntry): number {
  const usedA = a.budgetUsed ?? 100;
  const usedB = b.budgetUsed ?? 100;
  if (usedA !== usedB) return usedA - usedB;
  if (paceRank(a.pace) !== paceRank(b.pace))
    return paceRank(a.pace) - paceRank(b.pace);
  // A missing 5-hour window means no short-window constraint: treat it
  // as full headroom rather than penalizing providers like Codex.
  const fiveA = a.fiveHourUsed === null ? 100 : 100 - a.fiveHourUsed;
  const fiveB = b.fiveHourUsed === null ? 100 : 100 - b.fiveHourUsed;
  return fiveA === fiveB
    ? providerOrderIndex(a.provider) - providerOrderIndex(b.provider)
    : fiveB - fiveA;
}

function byProviderOrder(a: RankedEntry, b: RankedEntry): number {
  return providerOrderIndex(a.provider) - providerOrderIndex(b.provider);
}

export function rankSnapshots(
  snapshots: readonly UsageSnapshot[],
  options: RankOptions = {},
): RankResult {
  const context: RankContext = {
    minFiveHourRemaining: options.minFiveHourRemaining ?? 10,
    nowMs: options.nowMs ?? Date.now(),
    nowCocoa: (options.nowMs ?? Date.now()) / 1000 - COCOA_EPOCH_OFFSET_SECONDS,
  };

  const byProvider = new Map<string, UsageSnapshot>();
  for (const snapshot of snapshots) {
    if (!byProvider.has(snapshot.provider)) {
      byProvider.set(snapshot.provider, snapshot);
    }
  }

  const ranked: RankedEntry[] = [];
  const other: RankedEntry[] = [];
  const unavailable: RankedEntry[] = [];
  for (const provider of orderedProviders(byProvider)) {
    const snapshot = byProvider.get(provider);
    if (snapshot === undefined) continue;
    const classified = classifySnapshot(snapshot, context);
    if (classified.bucket === "ranked") ranked.push(classified.entry);
    else if (classified.bucket === "other") other.push(classified.entry);
    else unavailable.push(classified.entry);
  }

  ranked.sort(compareRanked);
  other.sort(byProviderOrder);
  unavailable.sort(byProviderOrder);

  return { ranked, other, unavailable };
}
