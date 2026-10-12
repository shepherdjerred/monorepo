import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "@shepherdjerred/discord-stream-lifecycle/persistence/atomic-write";
import { logger } from "#src/logger.ts";
import {
  HISTORY_LIMIT,
  normalizeCompletedGoal,
  type CompletedGoal,
} from "./goal-history.ts";
import type { GoalState } from "./goal-types.ts";

const CompletedGoalSchema = z.object({
  id: z.string(),
  goal: z.string(),
  requestedBy: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  status: z.enum([
    "running",
    "completed",
    "failed",
    "timeout",
    "replaced",
    "shutdown",
  ]),
  finalReport: z.string().optional(),
  exitCode: z.number().optional(),
});

const StateEnvelopeSchema = z.object({
  history: z.array(CompletedGoalSchema).optional(),
});

/**
 * Load the guild's completed-goal history. A state file that is unreadable or has
 * the wrong shape is moved aside to `<statePath>.corrupt-<timestamp>` and loading
 * fails, rather than silently starting from an empty history that the next
 * write would make permanent.
 */
export async function loadGoalHistory(
  statePath: string,
): Promise<CompletedGoal[]> {
  const file = Bun.file(statePath);
  if (!(await file.exists())) return [];
  let raw: unknown;
  try {
    raw = await file.json();
  } catch (error) {
    throw await quarantine(statePath, `could not parse: ${String(error)}`);
  }
  const result = StateEnvelopeSchema.safeParse(raw);
  if (!result.success) {
    throw await quarantine(statePath, result.error.message);
  }
  return (result.data.history ?? [])
    .slice(0, HISTORY_LIMIT)
    .map((entry) => normalizeCompletedGoal(entry));
}

async function quarantine(statePath: string, reason: string): Promise<Error> {
  const stamp = new Date().toISOString().replaceAll(/[-:.]/g, "");
  const aside = `${statePath}.corrupt-${stamp}`;
  await rename(statePath, aside);
  logger.error("goal-manager: goal state file is invalid; moved it aside", {
    statePath,
    aside,
    reason,
  });
  return new Error(
    `goal state file ${statePath} is invalid (${reason}); moved it to ${aside}`,
  );
}

export async function persistGoalState(input: {
  statePath: string;
  state: GoalState;
  history: CompletedGoal[];
}): Promise<void> {
  const envelope = { current: input.state, history: input.history };
  await mkdir(path.dirname(input.statePath), { recursive: true });
  await writeFileAtomic(
    input.statePath,
    `${JSON.stringify(envelope, undefined, 2)}\n`,
  );
}
