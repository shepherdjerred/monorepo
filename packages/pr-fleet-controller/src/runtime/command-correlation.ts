import { AsyncLocalStorage } from "node:async_hooks";
import { captureTelemetryOperation } from "./telemetry.ts";
import type { FleetTelemetry } from "#domain/ports.ts";
import type { RunEventCorrelation } from "#domain/run-events.ts";

const commandCorrelation = new AsyncLocalStorage<RunEventCorrelation>();

export function withCommandCorrelation<T>(
  correlation: RunEventCorrelation,
  run: () => Promise<T>,
): Promise<T> {
  return commandCorrelation.run(correlation, run);
}

export function withoutCommandCorrelation<T>(
  run: () => Promise<T>,
): Promise<T> {
  return commandCorrelation.run({}, run);
}

export function currentCommandCorrelation(): RunEventCorrelation {
  return commandCorrelation.getStore() ?? {};
}

export function commandEventCorrelation(
  telemetry: FleetTelemetry | undefined,
): RunEventCorrelation {
  const parent = currentCommandCorrelation();
  const commandId = captureTelemetryOperation("command correlation", () =>
    telemetry?.newId("command"),
  );
  return commandId === undefined ? parent : { ...parent, commandId };
}
