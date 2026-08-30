import type { Client } from "@temporalio/client";
import * as Sentry from "@sentry/bun";
import { startEventBridge, type EventBridgeHandle } from "./index.ts";
import {
  haEventBridgeConnected,
  haEventBridgeStartFailuresTotal,
} from "#observability/metrics.ts";
import { createStructuredLogger } from "#observability/logging.ts";
import { sleepUnlessClosed } from "#shared/startup-retry.ts";
import { formatError } from "#shared/format-error.ts";

const jsonLog = createStructuredLogger();

function classifyEventBridgeStartFailure(error: unknown): string {
  const message = formatError(error).toLowerCase();
  if (message.includes("websocket") || message.includes("web socket")) {
    return "websocket";
  }
  if (message.includes("ha_url") || message.includes("ha_token")) {
    return "config";
  }
  if (message.includes("401") || message.includes("unauthorized")) {
    return "auth";
  }
  return "unknown";
}

type EventBridgeSupervisorState = {
  closed: boolean;
  currentHandle: EventBridgeHandle | undefined;
};

function isEventBridgeSupervisorClosed(
  state: EventBridgeSupervisorState,
): boolean {
  return state.closed;
}

/** Consecutive start failures before escalating the outage to Sentry. */
const EVENT_BRIDGE_ESCALATION_ATTEMPTS = 10;

async function runEventBridgeSupervisor(
  client: Client,
  state: EventBridgeSupervisorState,
): Promise<void> {
  try {
    let attempt = 0;
    while (!isEventBridgeSupervisorClosed(state)) {
      try {
        const handle = await startEventBridge(client);
        if (isEventBridgeSupervisorClosed(state)) {
          await handle.close();
          return;
        }
        state.currentHandle = handle;
        haEventBridgeConnected.set(1);
        jsonLog("info", "Event bridge started");
        return;
      } catch (error: unknown) {
        attempt += 1;
        const retryDelayMs = Math.min(300_000, 10_000 * attempt);
        const reason = classifyEventBridgeStartFailure(error);
        haEventBridgeConnected.set(0);
        haEventBridgeStartFailuresTotal.inc({ reason });
        // Escalate once per outage: the retry loop is intentionally eternal,
        // which previously meant a permanently-down bridge (no HA presence
        // signals, no webhooks) only ever showed up as stderr lines and a
        // gauge nobody was alerting on. Ten consecutive failures ≈ 9 minutes
        // of outage — loud enough for Sentry, once (attempt only grows
        // within a single outage; success exits the loop).
        if (attempt === EVENT_BRIDGE_ESCALATION_ATTEMPTS) {
          Sentry.captureMessage(
            `Event bridge has failed to start ${String(attempt)} consecutive times (latest reason: ${reason}); still retrying`,
            "warning",
          );
        }
        jsonLog("error", "Event bridge failed to start; retrying", {
          attempt,
          reason,
          retryDelayMs,
          error: formatError(error),
        });
        await sleepUnlessClosed(retryDelayMs, () =>
          isEventBridgeSupervisorClosed(state),
        );
      }
    }
  } catch (error: unknown) {
    Sentry.captureException(error);
    jsonLog("error", "Event bridge supervisor stopped unexpectedly", {
      error: formatError(error),
    });
  }
}

export function startEventBridgeSupervisor(client: Client): EventBridgeHandle {
  const state: EventBridgeSupervisorState = {
    closed: false,
    currentHandle: undefined,
  };

  void runEventBridgeSupervisor(client, state);

  return {
    async close() {
      state.closed = true;
      if (state.currentHandle !== undefined) {
        await state.currentHandle.close();
      }
    },
  };
}
