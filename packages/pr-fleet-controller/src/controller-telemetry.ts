import type { FleetTelemetry } from "./ports.ts";
import type {
  FleetSnapshot,
  FleetTickReport,
  PrState,
  TickTrigger,
  WorkerResult,
} from "./schemas.ts";
import type { RunEventCorrelation, RunEventKind } from "./run-events.ts";

export class TelemetryCaptureError extends Error {
  constructor(operation: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to capture ${operation}: ${detail}`, { cause });
    this.name = "TelemetryCaptureError";
  }
}

export function isTelemetryCaptureError(error: unknown): boolean {
  return (
    error instanceof TelemetryCaptureError ||
    (error instanceof Error && error.name === "TelemetryCaptureError")
  );
}

export class ControllerTelemetry {
  readonly #telemetry: FleetTelemetry | undefined;

  constructor(telemetry?: FleetTelemetry) {
    this.#telemetry = telemetry;
  }

  #newId(prefix: string): string | undefined {
    try {
      return this.#telemetry?.newId(prefix);
    } catch (error) {
      throw new TelemetryCaptureError(`${prefix} correlation`, error);
    }
  }

  #record(
    kind: RunEventKind,
    payload: Record<string, unknown>,
    correlation: RunEventCorrelation = {},
  ): void {
    try {
      this.#telemetry?.record(kind, payload, correlation);
    } catch (error) {
      throw new TelemetryCaptureError(kind, error);
    }
  }

  tickQueued(
    trigger: TickTrigger,
    snapshot: FleetSnapshot,
    causationId?: string,
  ): void {
    this.#record(
      "tick.queued",
      { trigger, snapshot },
      causationId === undefined ? {} : { causationId },
    );
  }

  tickStarted(trigger: TickTrigger): string | undefined {
    const tickId = this.#newId("tick");
    this.#record(
      "tick.started",
      { trigger },
      tickId === undefined ? {} : { tickId },
    );
    return tickId;
  }

  tickCompleted(tickId: string | undefined, report: FleetTickReport): void {
    this.#record(
      "tick.completed",
      { report },
      tickId === undefined ? {} : { tickId },
    );
  }

  tickFailed(tickId: string | undefined, error: unknown): void {
    this.#record(
      "tick.failed",
      { error: error instanceof Error ? error.message : String(error) },
      tickId === undefined ? {} : { tickId },
    );
  }

  snapshot(tickId: string | undefined, snapshot: FleetSnapshot): void {
    this.#record(
      "fleet.snapshot",
      { snapshot },
      tickId === undefined ? {} : { tickId },
    );
  }

  change(tickId: string | undefined, change: string): void {
    this.#record(
      "fleet.change",
      { change },
      tickId === undefined ? {} : { tickId },
    );
  }

  workerStarted(tickId: string | undefined, state: PrState): void {
    this.#record(
      "worker.started",
      {
        runtimeAgent: state.runtimeAgent,
        stackId: state.stackId,
        worktree: state.worktree,
      },
      {
        ...(tickId === undefined ? {} : { tickId }),
        prNumber: state.identity.number,
        headSha: state.identity.headSha,
        generation: state.agentGeneration,
      },
    );
  }

  workerCompleted(
    prNumber: number,
    state: PrState | undefined,
    result: WorkerResult,
    tickId: string | undefined,
  ): void {
    this.#record(
      "worker.completed",
      { result },
      state === undefined
        ? { prNumber, ...(tickId === undefined ? {} : { tickId }) }
        : {
            ...(tickId === undefined ? {} : { tickId }),
            prNumber,
            headSha: state.identity.headSha,
            generation: state.agentGeneration,
          },
    );
  }

  workerCancelled(
    prNumber: number,
    state: PrState | undefined,
    error: unknown,
    tickId: string | undefined,
  ): void {
    this.#record(
      "worker.cancelled",
      { reason: error instanceof Error ? error.message : String(error) },
      state === undefined
        ? { prNumber, ...(tickId === undefined ? {} : { tickId }) }
        : {
            ...(tickId === undefined ? {} : { tickId }),
            prNumber,
            headSha: state.identity.headSha,
            generation: state.agentGeneration,
          },
    );
  }

  workerFailed(
    prNumber: number,
    state: PrState | undefined,
    error: unknown,
    tickId: string | undefined,
  ): void {
    this.#record(
      "worker.failed",
      { error: error instanceof Error ? error.message : String(error) },
      state === undefined
        ? { prNumber, ...(tickId === undefined ? {} : { tickId }) }
        : {
            ...(tickId === undefined ? {} : { tickId }),
            prNumber,
            headSha: state.identity.headSha,
            generation: state.agentGeneration,
          },
    );
  }

  shutdownStarted(activeWorkers: number): void {
    this.#record("shutdown.started", { activeWorkers });
  }

  shutdownCompleted(snapshot: FleetSnapshot): void {
    this.#record("shutdown.completed", { snapshot });
  }

  shutdownFailed(snapshot: FleetSnapshot, error: unknown): void {
    this.#record("shutdown.failed", {
      snapshot,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
