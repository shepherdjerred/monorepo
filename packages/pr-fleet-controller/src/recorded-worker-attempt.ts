import {
  captureTelemetryOperation,
  isTelemetryCaptureError,
} from "./controller-telemetry.ts";
import type { FleetTelemetry } from "./ports.ts";
import type { RunEventCorrelation } from "./run-events.ts";

export type WorkerAttemptOutcome<T> =
  | { status: "completed"; result: T }
  | { status: "failed"; error: Error };

export async function runRecordedWorkerAttempt<T>(options: {
  attempt: number;
  prompt: string;
  telemetry: FleetTelemetry;
  correlation: RunEventCorrelation;
  run: () => Promise<T>;
}): Promise<WorkerAttemptOutcome<T>> {
  const { attempt, prompt, telemetry, correlation, run } = options;
  captureTelemetryOperation("worker.attempt.started", () => {
    telemetry.record(
      "worker.attempt.started",
      { attempt, prompt },
      correlation,
    );
  });
  let result: T;
  try {
    result = await run();
  } catch (error) {
    if (isTelemetryCaptureError(error)) {
      throw error;
    }
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    captureTelemetryOperation("worker.attempt.failed", () => {
      telemetry.record(
        "worker.attempt.failed",
        { attempt, error: normalized.message },
        correlation,
      );
    });
    return { status: "failed", error: normalized };
  }
  // A successful model turn may already have invoked mutating tools. Let a
  // completion-capture failure abort the controller instead of retrying the
  // entire turn and repeating those mutations.
  captureTelemetryOperation("worker.attempt.completed", () => {
    telemetry.record(
      "worker.attempt.completed",
      { attempt, result },
      correlation,
    );
  });
  return { status: "completed", result };
}
