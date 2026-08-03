import { describe, expect, test } from "bun:test";
import { runRecordedMasterTool } from "@shepherdjerred/pr-fleet-controller/src/master-tools.ts";
import type { FleetTelemetry } from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import type {
  RunEventCorrelation,
  RunEventKind,
} from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";

type CapturedEvent = {
  kind: RunEventKind;
  payload: Record<string, unknown>;
  correlation: RunEventCorrelation;
};

function createTelemetry(events: CapturedEvent[]): FleetTelemetry {
  return {
    runId: "test-run",
    newId: (prefix) => `${prefix}-1`,
    traceId: () => "0".repeat(32),
    record: (kind, payload, correlation = {}) => {
      events.push({ kind, payload, correlation });
    },
  };
}

describe("master tool telemetry", () => {
  test("records successful calls with turn and tool correlation", async () => {
    const events: CapturedEvent[] = [];
    const result = await runRecordedMasterTool(
      "fleet_status",
      {},
      {
        telemetry: createTelemetry(events),
        correlation: () => ({
          traceId: "1".repeat(32),
          modelTurnId: "master-turn-1",
        }),
      },
      () => Promise.resolve({ open: 0 }),
    );

    expect(result).toEqual({ open: 0 });
    expect(events).toEqual([
      {
        kind: "tool.started",
        payload: { tool: "fleet_status", input: {} },
        correlation: {
          traceId: "1".repeat(32),
          modelTurnId: "master-turn-1",
          toolCallId: "tool-1",
        },
      },
      {
        kind: "tool.completed",
        payload: { tool: "fleet_status", result: { open: 0 } },
        correlation: {
          traceId: "1".repeat(32),
          modelTurnId: "master-turn-1",
          toolCallId: "tool-1",
        },
      },
    ]);
  });

  test("records failed calls before rethrowing", async () => {
    const events: CapturedEvent[] = [];
    const failure = new Error("tick failed");

    await expect(
      runRecordedMasterTool(
        "run_fleet_tick",
        {},
        {
          telemetry: createTelemetry(events),
          correlation: () => ({ modelTurnId: "master-turn-2" }),
        },
        () => Promise.reject(failure),
      ),
    ).rejects.toBe(failure);
    expect(events.map((event) => event.kind)).toEqual([
      "tool.started",
      "tool.failed",
    ]);
    expect(events[1]?.payload).toEqual({
      tool: "run_fleet_tick",
      error: "tick failed",
    });
  });
});
