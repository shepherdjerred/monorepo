import { describe, expect, test } from "bun:test";
import { currentCommandCorrelation } from "@shepherdjerred/pr-fleet-controller/src/command-correlation.ts";
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
    let commandCorrelation: RunEventCorrelation = {};
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
      () => {
        commandCorrelation = currentCommandCorrelation();
        return Promise.resolve({ open: 0 });
      },
    );

    expect(result).toEqual({ open: 0 });
    expect(commandCorrelation).toEqual({
      traceId: "1".repeat(32),
      modelTurnId: "master-turn-1",
      toolCallId: "tool-1",
    });
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

  test("propagates completion capture failures without relabeling the operation", async () => {
    const events: CapturedEvent[] = [];
    const captureFailure = new Error("state volume is full");
    let operationRuns = 0;
    const telemetry = createTelemetry(events);
    const originalRecord = telemetry.record;
    telemetry.record = (kind, payload, correlation = {}) => {
      if (kind === "tool.completed") {
        throw captureFailure;
      }
      originalRecord(kind, payload, correlation);
    };

    await expect(
      runRecordedMasterTool(
        "publish_fix",
        { paths: ["file.ts"] },
        {
          telemetry,
          correlation: () => ({ modelTurnId: "master-turn-3" }),
        },
        () => {
          operationRuns += 1;
          return Promise.resolve({ headSha: "a".repeat(40) });
        },
      ),
    ).rejects.toMatchObject({
      name: "TelemetryCaptureError",
      cause: captureFailure,
    });

    expect(operationRuns).toBe(1);
    expect(events.map((event) => event.kind)).toEqual(["tool.started"]);
  });
});
