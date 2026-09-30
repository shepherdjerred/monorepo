import type { AgentTurnEvent, AgentTurnOutcome } from "./contract.ts";

export type AgentTurnProgress = {
  observe: (type: string) => void;
  summary: () => Pick<
    AgentTurnOutcome,
    "durationMs" | "eventCount" | "firstEventLatencyMs" | "maxIdleMs"
  >;
};

export function createAgentTurnProgress(
  startedAtMs: number,
  onEvent: (event: AgentTurnEvent) => void,
): AgentTurnProgress {
  let eventCount = 0;
  let firstEventAtMs: number | undefined;
  let previousEventAtMs = startedAtMs;
  let maxIdleMs = 0;
  return {
    observe(type): void {
      const now = Date.now();
      firstEventAtMs ??= now;
      const idleMs = now - previousEventAtMs;
      maxIdleMs = Math.max(maxIdleMs, idleMs);
      previousEventAtMs = now;
      eventCount += 1;
      onEvent({ type, elapsedMs: now - startedAtMs, idleMs });
    },
    summary() {
      const finishedAtMs = Date.now();
      maxIdleMs = Math.max(maxIdleMs, finishedAtMs - previousEventAtMs);
      return {
        durationMs: finishedAtMs - startedAtMs,
        eventCount,
        firstEventLatencyMs:
          firstEventAtMs === undefined
            ? undefined
            : firstEventAtMs - startedAtMs,
        maxIdleMs,
      };
    },
  };
}
