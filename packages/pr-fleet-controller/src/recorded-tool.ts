import { withCommandCorrelation } from "./command-correlation.ts";
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
  telemetry.record("tool.started", { tool, input }, correlation);
  let result: T;
  try {
    result = await withCommandCorrelation(correlation, run);
  } catch (error) {
    telemetry.record(
      "tool.failed",
      { tool, error: error instanceof Error ? error.message : String(error) },
      correlation,
    );
    throw error;
  }
  // A terminal telemetry failure is not an operation failure. In particular,
  // a successful publication must never be reported as failed and retried just
  // because its completion event could not be persisted.
  telemetry.record("tool.completed", { tool, result }, correlation);
  return result;
}
