import { AsyncLocalStorage } from "node:async_hooks";
import type { FleetTelemetry } from "./ports.ts";
import type { RunEventCorrelation } from "./run-events.ts";

const commandCorrelation = new AsyncLocalStorage<RunEventCorrelation>();

export function withCommandCorrelation<T>(
  correlation: RunEventCorrelation,
  run: () => Promise<T>,
): Promise<T> {
  return commandCorrelation.run(correlation, run);
}

export function currentCommandCorrelation(): RunEventCorrelation {
  return commandCorrelation.getStore() ?? {};
}

export function commandEventCorrelation(
  telemetry: FleetTelemetry | undefined,
): RunEventCorrelation {
  const parent = currentCommandCorrelation();
  const commandId = telemetry?.newId("command");
  return commandId === undefined ? parent : { ...parent, commandId };
}
