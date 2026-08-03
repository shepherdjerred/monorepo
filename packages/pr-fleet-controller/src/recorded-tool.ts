import { withCommandCorrelation } from "./command-correlation.ts";
import {
  captureTelemetryOperation,
  isTelemetryCaptureError,
} from "./controller-telemetry.ts";
import type { FleetTelemetry } from "./ports.ts";
import type { RunEventCorrelation } from "./run-events.ts";

export async function runRecordedToolOperation<T>(options: {
  tool: string;
  input: unknown;
  telemetry: FleetTelemetry;
  correlation: RunEventCorrelation;
  run: () => Promise<T>;
}): Promise<T> {
  const { tool, input, telemetry, correlation, run } = options;
  captureTelemetryOperation("tool.started", () => {
    telemetry.record("tool.started", { tool, input }, correlation);
  });
  let result: T;
  try {
    result = await withCommandCorrelation(correlation, run);
  } catch (error) {
    if (isTelemetryCaptureError(error)) {
      throw error;
    }
    captureTelemetryOperation("tool.failed", () => {
      telemetry.record(
        "tool.failed",
        { tool, error: error instanceof Error ? error.message : String(error) },
        correlation,
      );
    });
    throw error;
  }
  // A terminal telemetry failure is not an operation failure. In particular,
  // a successful publication must never be reported as failed and retried just
  // because its completion event could not be persisted.
  captureTelemetryOperation("tool.completed", () => {
    telemetry.record("tool.completed", { tool, result }, correlation);
  });
  return result;
}
