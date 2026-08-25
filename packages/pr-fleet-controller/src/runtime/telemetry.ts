import { context, trace, TraceFlags, type Context } from "@opentelemetry/api";
import type { FleetTelemetry } from "#domain/ports.ts";
import type {
  FleetSnapshot,
  FleetTickReport,
  OperatorInputAnswer,
  OperatorInputRequest,
  PrState,
  TickTrigger,
  WorkerResult,
} from "#domain/schemas.ts";
import type { RunEventCorrelation, RunEventKind } from "#domain/run-events.ts";

export class TelemetryCaptureError extends Error {
  constructor(operation: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to capture ${operation}: ${detail}`, { cause });
    this.name = "TelemetryCaptureError";
  }
}

export function captureTelemetryOperation<T>(
  operation: string,
  capture: () => T,
): T {
  try {
    return capture();
  } catch (error) {
    throw new TelemetryCaptureError(operation, error);
  }
}

/**
 * Runs `operation` inside an OpenTelemetry context carrying the recorder's
 * correlation trace ID.
 *
 * `FleetTelemetry.traceId()` is a sha256 truncated to 32 hex characters — a
 * valid W3C trace ID by construction. Supplying it only through
 * `callOptions.traceContext` puts it in the OpenRouter request metadata but
 * leaves the local trace untouched, and the AI SDK integration starts its spans
 * from `context.active()`. Without this graft each model and tool call becomes
 * its own root trace with a random ID, so the dashboard's `tracePrNumbers`
 * lookup — which joins a span to its PR by trace ID — misses, and a worker's
 * spans land in the fleet timeline instead of that PR's transcript.
 *
 * Grafting onto a remote span context rather than starting a real span keeps
 * the deterministic recorder ID authoritative, so a captured run stays
 * byte-for-byte replayable.
 */
export function correlatedTraceContext(ids: {
  traceId: string;
  spanId: string;
}): Context {
  return trace.setSpanContext(context.active(), {
    traceId: ids.traceId,
    spanId: ids.spanId,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

export function withCorrelatedTrace<T>(
  ids: { traceId: string; spanId: string },
  operation: () => Promise<T>,
): Promise<T> {
  return context.with(correlatedTraceContext(ids), operation);
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
    return captureTelemetryOperation(`${prefix} correlation`, () =>
      this.#telemetry?.newId(prefix),
    );
  }

  #record(
    kind: RunEventKind,
    payload: Record<string, unknown>,
    correlation: RunEventCorrelation = {},
  ): void {
    captureTelemetryOperation(kind, () => {
      this.#telemetry?.record(kind, payload, correlation);
    });
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

  operatorQuestionAsked(request: OperatorInputRequest): void {
    this.#record(
      "operator.question.asked",
      { request },
      {
        prNumber: request.pr,
        headSha: request.headSha,
        generation: request.generation,
      },
    );
  }

  operatorQuestionAnswered(
    request: OperatorInputRequest,
    answer: OperatorInputAnswer,
  ): void {
    this.#record(
      "operator.question.answered",
      { requestId: request.id, answer },
      {
        prNumber: request.pr,
        headSha: request.headSha,
        generation: request.generation,
      },
    );
  }

  operatorQuestionSuperseded(
    request: OperatorInputRequest,
    reason: string,
  ): void {
    this.#record(
      "operator.question.superseded",
      { requestId: request.id, reason },
      {
        prNumber: request.pr,
        headSha: request.headSha,
        generation: request.generation,
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
