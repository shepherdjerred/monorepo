import { z } from "zod";
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

export async function loadGoalHistory(
  statePath: string,
): Promise<CompletedGoal[]> {
  const file = Bun.file(statePath);
  if (!(await file.exists())) return [];
  let raw: unknown;
  try {
    raw = await file.json();
  } catch (error) {
    logger.warn(`goal-manager: could not parse state file: ${String(error)}`);
    return [];
  }
  const result = StateEnvelopeSchema.safeParse(raw);
  if (!result.success) {
    logger.warn(
      "goal-manager: state file has unexpected shape, starting with empty history",
    );
    return [];
  }
  return (result.data.history ?? [])
    .slice(0, HISTORY_LIMIT)
    .map((entry) => normalizeCompletedGoal(entry));
}

export async function persistGoalState(input: {
  statePath: string;
  state: GoalState;
  history: CompletedGoal[];
}): Promise<void> {
  const envelope = { current: input.state, history: input.history };
  await Bun.write(
    input.statePath,
    `${JSON.stringify(envelope, undefined, 2)}\n`,
    { createPath: true },
  );
}
