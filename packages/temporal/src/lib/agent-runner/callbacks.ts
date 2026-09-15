import type { AgentTurnEvent } from "./contract.ts";

export function createAgentSecretRefreshHandler(
  refresh: () => Promise<void>,
): () => Promise<boolean> {
  return async () => {
    try {
      await refresh();
      return true;
    } catch {
      return false;
    }
  };
}

export function createTemporalAgentEventHandler(options: {
  nextEventCount: () => number;
  heartbeat: (payload: Record<string, unknown>) => void;
  logEvent?: (event: AgentTurnEvent) => void;
}): (event: AgentTurnEvent) => void {
  return (event) => {
    const eventCount = options.nextEventCount();
    options.heartbeat({
      phase: "codex-agent-sdk",
      elapsedMs: event.elapsedMs,
      idleMs: event.idleMs,
      eventCount,
      eventType: event.type,
    });
    options.logEvent?.(event);
  };
}
