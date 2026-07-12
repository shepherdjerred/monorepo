// Rolling log of recently finished goals, persisted alongside the current goal
// so a future Codex run can read its predecessors via `pokemonctl history`.
// Kept narrow on purpose — anything not in this shape is reconstructable from
// the OTel archive (T7) rather than ballooning the state file.

import type { GoalState, GoalStatus } from "./goal-types.ts";

export type CompletedGoal = {
  id: string;
  goal: string;
  requestedBy: string;
  startedAt: string;
  finishedAt: string;
  status: GoalStatus;
  finalReport?: string;
  exitCode?: number;
};

export const HISTORY_LIMIT = 10;

/**
 * Normalize a loosely-typed persisted history entry (optional fields inferred
 * as `T | undefined` by Zod) into a `CompletedGoal`, omitting absent optional
 * fields entirely so the result satisfies `exactOptionalPropertyTypes`.
 */
export function normalizeCompletedGoal(entry: {
  id: string;
  goal: string;
  requestedBy: string;
  startedAt: string;
  finishedAt: string;
  status: GoalStatus;
  finalReport?: string | undefined;
  exitCode?: number | undefined;
}): CompletedGoal {
  return {
    id: entry.id,
    goal: entry.goal,
    requestedBy: entry.requestedBy,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    status: entry.status,
    ...(entry.finalReport !== undefined && { finalReport: entry.finalReport }),
    ...(entry.exitCode !== undefined && { exitCode: entry.exitCode }),
  };
}

/**
 * Appends a finished goal to a newest-first history list, trimming to
 * `HISTORY_LIMIT`. Idempotent on the goal id — if `recordedIds` already has
 * the id, the existing history is returned unchanged. Returns the new
 * history; the caller is responsible for storing it back.
 */
export function appendToHistory(
  history: readonly CompletedGoal[],
  recordedIds: Set<string>,
  state: GoalState,
): readonly CompletedGoal[] {
  if (state.finishedAt === undefined) return history;
  if (recordedIds.has(state.id)) return history;

  const entry: CompletedGoal = {
    id: state.id,
    goal: state.goal,
    requestedBy: state.requestedBy,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    status: state.status,
    ...(state.finalReport !== undefined && { finalReport: state.finalReport }),
    ...(state.exitCode !== undefined && { exitCode: state.exitCode }),
  };
  const next = [entry, ...history].slice(0, HISTORY_LIMIT);
  recordedIds.add(state.id);
  // Compact: only ids of in-history entries matter for de-dup; older ids can
  // only re-appear if a goal id collides, which it won't (crypto.randomUUID).
  if (recordedIds.size > HISTORY_LIMIT * 2) {
    const liveIds = new Set(next.map((e) => e.id));
    for (const id of recordedIds) {
      if (!liveIds.has(id)) recordedIds.delete(id);
    }
  }
  return next;
}
