import type { FleetTelemetry } from "./ports.ts";
import type {
  FleetSnapshot,
  FleetTickReport,
  PrState,
  TickTrigger,
  WorkerResult,
} from "./schemas.ts";

export class ControllerTelemetry {
  readonly #telemetry: FleetTelemetry | undefined;

  constructor(telemetry?: FleetTelemetry) {
    this.#telemetry = telemetry;
  }

  tickQueued(
    trigger: TickTrigger,
    snapshot: FleetSnapshot,
    causationId?: string,
  ): void {
    this.#telemetry?.record(
      "tick.queued",
      { trigger, snapshot },
      causationId === undefined ? {} : { causationId },
    );
  }

  tickStarted(trigger: TickTrigger): string | undefined {
    const tickId = this.#telemetry?.newId("tick");
    this.#telemetry?.record(
      "tick.started",
      { trigger },
      tickId === undefined ? {} : { tickId },
    );
    return tickId;
  }

  tickCompleted(tickId: string | undefined, report: FleetTickReport): void {
    this.#telemetry?.record(
      "tick.completed",
      { report },
      tickId === undefined ? {} : { tickId },
    );
  }

  tickFailed(tickId: string | undefined, error: unknown): void {
    this.#telemetry?.record(
      "tick.failed",
      { error: error instanceof Error ? error.message : String(error) },
      tickId === undefined ? {} : { tickId },
    );
  }

  snapshot(tickId: string | undefined, snapshot: FleetSnapshot): void {
    this.#telemetry?.record(
      "fleet.snapshot",
      { snapshot },
      tickId === undefined ? {} : { tickId },
    );
  }

  change(tickId: string | undefined, change: string): void {
    this.#telemetry?.record(
      "fleet.change",
      { change },
      tickId === undefined ? {} : { tickId },
    );
  }

  workerStarted(tickId: string | undefined, state: PrState): void {
    this.#telemetry?.record(
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
  ): void {
    this.#telemetry?.record(
      "worker.completed",
      { result },
      state === undefined
        ? { prNumber }
        : {
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
  ): void {
    this.#telemetry?.record(
      "worker.failed",
      { error: error instanceof Error ? error.message : String(error) },
      state === undefined
        ? { prNumber }
        : {
            prNumber,
            headSha: state.identity.headSha,
            generation: state.agentGeneration,
          },
    );
  }

  shutdownStarted(activeWorkers: number): void {
    this.#telemetry?.record("shutdown.started", { activeWorkers });
  }

  shutdownCompleted(snapshot: FleetSnapshot): void {
    this.#telemetry?.record("shutdown.completed", { snapshot });
  }
}
