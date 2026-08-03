// Structured goal.tool lines for Loki / kubectl logs. One line per control
// server request so blackbox review can reconstruct what the agent saw and did
// without digging through OTel archives.

import { logger } from "#src/logger.ts";
import { goalToolCallsTotal } from "#src/observability/metrics.ts";

const STATE_LOG_MAX = 4000;
const GENERIC_BODY_MAX = 2000;

// The fixed route set served by routeRequest/routeSemanticRequest/
// routeInformationalRequest. Unknown paths (404 probes, typos) collapse to
// "other" so they can't explode the metric's label cardinality.
const KNOWN_TOOL_PATHS = new Set([
  "/status",
  "/state",
  "/observe",
  "/map",
  "/map/exits",
  "/screenshot",
  "/press",
  "/chord",
  "/progress",
  "/list",
  "/read",
  "/grep",
  "/write",
  "/tap",
  "/move",
  "/navigate",
  "/interact",
  "/advance",
  "/wait",
  "/battle/move",
  "/battle/item",
  "/battle/run",
  "/battle/switch",
  "/battle/target",
  "/knowledge/search",
  "/knowledge/get",
  "/history",
]);

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
  goalToolCallsTotal.inc({
    path: KNOWN_TOOL_PATHS.has(entry.path) ? entry.path : "other",
    status: String(entry.status),
  });
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
