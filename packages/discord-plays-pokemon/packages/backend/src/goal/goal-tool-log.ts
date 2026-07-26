// Structured goal.tool lines for Loki / kubectl logs. One line per control
// server request so blackbox review can reconstruct what the agent saw and did
// without digging through OTel archives.

import { logger } from "#src/logger.ts";

const STATE_LOG_MAX = 4000;
const GENERIC_BODY_MAX = 2000;

export type GoalToolLogEntry = {
  goalId: string | undefined;
  method: string;
  path: string;
  durationMs: number;
  request?: unknown;
  response?: unknown;
  status: number;
};

export function logGoalTool(entry: GoalToolLogEntry): void {
  logger.info(
    `goal.tool ${JSON.stringify({
      goalId: entry.goalId ?? null,
      method: entry.method,
      path: entry.path,
      durationMs: entry.durationMs,
      status: entry.status,
      request: entry.request ?? null,
      response: entry.response ?? null,
    })}`,
  );
}

export function truncateForToolLog(
  value: string,
  max = GENERIC_BODY_MAX,
): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

export function truncateStateForToolLog(value: string): string {
  return truncateForToolLog(value, STATE_LOG_MAX);
}
