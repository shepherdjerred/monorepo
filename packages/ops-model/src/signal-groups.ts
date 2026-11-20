import { allSignals } from "./assemble.ts";
import { isAttention, worstSeverity, type Severity } from "./severity.ts";
import type { SectionId, Signal, Snapshot } from "./snapshot.ts";

/**
 * Signal kinds that may collapse into one row, mapped to their plural label.
 *
 * This is an allowlist on purpose. Every Alertmanager alert has kind `alert`
 * and must never sit behind a disclosure, and a kind nobody has reviewed yet
 * stays visible row by row until it is added here.
 */
export const SIGNAL_GROUP_KINDS: ReadonlyMap<string, string> = new Map([
  ["restore-failure", "failed Velero restores"],
  ["renovate-approval", "Renovate updates awaiting approval"],
  ["renovate-pr", "Renovate pull requests"],
  ["schedule-paused", "paused schedules"],
]);

/** Fewer same-key signals than this stay as individual rows. */
const SIGNAL_GROUP_MIN_SIZE = 3;

export type SignalGroup = {
  type: "group";
  /** Derived from the grouping key, so it is stable across snapshots. */
  id: string;
  kind: string;
  section: SectionId;
  /** Count plus plural, e.g. `10 failed Velero restores`. */
  label: string;
  severity: Severity;
  needsMe: boolean;
  count: number;
  /** The oldest member's `since`, when any member has one. */
  since?: string;
  signals: readonly Signal[];
};

export type SignalEntry = { type: "signal"; signal: Signal } | SignalGroup;

function groupKey(signal: Signal): string {
  return [
    "group",
    signal.section,
    signal.kind,
    signal.severity,
    signal.needsMe ? "needs-me" : "no-owner",
  ].join(":");
}

function oldestSince(signals: readonly Signal[]): string | undefined {
  let oldest: string | undefined;
  for (const { since } of signals) {
    if (since === undefined) continue;
    if (oldest === undefined || Date.parse(since) < Date.parse(oldest)) {
      oldest = since;
    }
  }
  return oldest;
}

function buildGroup(
  id: string,
  label: string,
  first: Signal,
  members: readonly Signal[],
): SignalGroup {
  const since = oldestSince(members);
  return {
    type: "group",
    id,
    kind: first.kind,
    section: first.section,
    label: `${String(members.length)} ${label}`,
    severity: worstSeverity(members.map((member) => member.severity)),
    needsMe: first.needsMe,
    count: members.length,
    ...(since === undefined ? {} : { since }),
    signals: members,
  };
}

/**
 * Collapse runs of same-kind signals into one entry each, for every list a
 * human reads. Signals group only when their kind is allowlisted and they
 * share section, severity and `needsMe`; a key with fewer than `minSize`
 * members stays as individual entries.
 *
 * Each entry takes the position of its first member, so ranked input stays
 * worst-first, and members keep their input order. No signal is dropped.
 */
export function groupSignals(
  signals: readonly Signal[],
  options: { minSize?: number } = {},
): SignalEntry[] {
  const minSize = options.minSize ?? SIGNAL_GROUP_MIN_SIZE;
  const members = new Map<string, Signal[]>();
  for (const signal of signals) {
    if (!SIGNAL_GROUP_KINDS.has(signal.kind)) continue;
    const key = groupKey(signal);
    const bucket = members.get(key);
    if (bucket === undefined) members.set(key, [signal]);
    else bucket.push(signal);
  }

  const entries: SignalEntry[] = [];
  const emitted = new Set<string>();
  for (const signal of signals) {
    const key = groupKey(signal);
    const label = SIGNAL_GROUP_KINDS.get(signal.kind);
    const bucket = members.get(key);
    if (
      label === undefined ||
      bucket === undefined ||
      bucket.length < minSize
    ) {
      entries.push({ type: "signal", signal });
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    entries.push(buildGroup(key, label, signal, bucket));
  }
  return entries;
}

/**
 * Everything a human should act on, worst-first: signals at attention
 * severity or whose next action is Jerred's. An informational signal that
 * waits on him (a Renovate approval) is actionable; a plain one is not.
 */
export function actionableSignals(snapshot: Snapshot): Signal[] {
  return allSignals(snapshot).filter(
    (signal) => isAttention(signal.severity) || signal.needsMe,
  );
}
