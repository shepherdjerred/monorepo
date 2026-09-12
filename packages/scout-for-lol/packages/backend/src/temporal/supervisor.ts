import * as Sentry from "@sentry/bun";
import type { Client } from "@temporalio/client";
import { createLogger } from "#src/logger.ts";
import {
  SCOUT_TEMPORAL_QUEUE_CLASSES,
  type ScoutTemporalQueueClass,
} from "#src/configuration/runtime-role.ts";
import {
  scoutTemporalConnected,
  scoutTemporalReconnects,
  scoutTemporalStartsRejected,
  scoutTemporalWorkers,
} from "#src/metrics/platform/temporal.ts";
import { setScoutTemporalHealth } from "./health.ts";
import {
  closeConnectedRuntime,
  createConnectedRuntime,
  reconnectDelayMs,
  stopConnectedRuntime,
  type ConnectedRuntime,
  type ScoutTemporalSupervisorOptions,
} from "./connected-runtime.ts";

const logger = createLogger("temporal-supervisor");

export function sameQueueClasses(
  left: ReadonlySet<ScoutTemporalQueueClass>,
  right: ReadonlySet<ScoutTemporalQueueClass>,
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

/**
 * Hold the connection until a worker stops or the supervisor is shut down.
 *
 * The shutdown signal is in the race for the `gateway` role, which runs a
 * Temporal client and no workers at all. `Promise.race([])` never settles, so
 * without the signal that role's connect loop would hang forever — and
 * `shutdown()` awaits that loop, so the pod would never exit either. Exported
 * so the empty case is provable without a Temporal server.
 */
export async function awaitWorkerExitOrShutdown(
  runs: readonly Promise<void>[],
  closedSignal: Promise<undefined>,
): Promise<void> {
  await Promise.race([...runs, closedSignal]);
}

export class ScoutTemporalSupervisor {
  readonly #options: ScoutTemporalSupervisorOptions;
  #closed = false;
  #acceptingStarts = true;
  #deferredWorkersEnabled = false;
  #active: ConnectedRuntime | undefined;
  readonly #runPromise: Promise<void>;
  /**
   * Resolved by {@link shutdown}. A role with no workers (`gateway`) has no
   * `run()` promise to wait on, and racing an empty array would leave
   * `#connectAndRun` pending forever — with `shutdown()` awaiting it.
   */
  readonly #closedSignal: Promise<undefined>;
  readonly #signalClosed: () => void;
  #attempt = 0;
  #consecutiveFailures = 0;

  constructor(options: ScoutTemporalSupervisorOptions) {
    this.#options = options;
    const closed = Promise.withResolvers<undefined>();
    this.#closedSignal = closed.promise;
    this.#signalClosed = () => {
      closed.resolve(undefined);
    };
    this.#runPromise = this.#run();
  }

  /**
   * Add the role's deferred workers to the running set.
   *
   * Rebuilding is how the set changes: the workers are created against a live
   * connection, so the current runtime is drained and the reconnect loop
   * constructs the wider set on its next pass.
   */
  enableDeferredWorkers(): void {
    if (this.#deferredWorkersEnabled) return;
    if (this.#options.deferredWorkers.length === 0) return;
    this.#deferredWorkersEnabled = true;
    const active = this.#active;
    if (active !== undefined) {
      for (const worker of active.workers) {
        if (worker.getState() === "RUNNING") worker.shutdown();
      }
    }
  }

  #queueClasses(): ReadonlySet<ScoutTemporalQueueClass> {
    return new Set([
      ...this.#options.workers,
      ...(this.#deferredWorkersEnabled ? this.#options.deferredWorkers : []),
    ]);
  }

  client(): Client {
    if (!this.#acceptingStarts) {
      scoutTemporalStartsRejected.inc({ reason: "shutdown" });
      throw new Error("Scout is shutting down and rejects new durable starts");
    }
    if (this.#active === undefined) {
      scoutTemporalStartsRejected.inc({ reason: "degraded" });
      throw new Error(
        "Temporal is unavailable; durable start was not accepted",
      );
    }
    return this.#active.client;
  }

  async shutdown(): Promise<void> {
    if (this.#closed) return;
    this.#acceptingStarts = false;
    this.#closed = true;
    this.#signalClosed();
    setScoutTemporalHealth({
      state: "stopping",
      workerCount: this.#active?.workers.length ?? 0,
      queueClasses: [...this.#queueClasses()],
      lastError: null,
    });
    const active = this.#active;
    if (active !== undefined) {
      for (const worker of active.workers) {
        if (worker.getState() === "RUNNING") worker.shutdown();
      }
    }
    await this.#runPromise;
  }

  async #run(): Promise<void> {
    while (!this.#closed) {
      this.#attempt += 1;
      if (this.#attempt > 1) scoutTemporalReconnects.inc();
      try {
        await this.#connectAndRun();
        this.#consecutiveFailures = 0;
      } catch (error: unknown) {
        this.#consecutiveFailures += 1;
        this.#recordDegradedState(error);
      } finally {
        scoutTemporalConnected.set(0);
        if (this.#active === undefined) scoutTemporalWorkers.reset();
      }
      if (this.#shouldStop()) return;
      await Bun.sleep(reconnectDelayMs(this.#consecutiveFailures));
    }
  }

  async #connectAndRun(): Promise<void> {
    const queueClasses = this.#queueClasses();
    const runtime = await createConnectedRuntime(this.#options, queueClasses);
    if (
      this.#shouldStop() ||
      !sameQueueClasses(queueClasses, this.#queueClasses())
    ) {
      await closeConnectedRuntime(runtime);
      return;
    }
    this.#active = runtime;
    this.#recordConnectedState(runtime, queueClasses);
    const runs = runtime.workers.map(async (worker) => {
      await worker.run();
    });
    try {
      await awaitWorkerExitOrShutdown(runs, this.#closedSignal);
    } finally {
      this.#active = undefined;
      await stopConnectedRuntime(runtime, runs);
    }
  }

  #recordConnectedState(
    runtime: ConnectedRuntime,
    queueClasses: ReadonlySet<ScoutTemporalQueueClass>,
  ): void {
    scoutTemporalConnected.set(1);
    // Reported for every queue class, present or not: a role that runs no
    // `realtime` worker must read 0 rather than go absent, so the gauge keeps
    // separating "this pod does not run it" from "this pod stopped scraping".
    for (const queueClass of SCOUT_TEMPORAL_QUEUE_CLASSES) {
      scoutTemporalWorkers.set(
        { queue_class: queueClass },
        queueClasses.has(queueClass) ? 1 : 0,
      );
    }
    setScoutTemporalHealth({
      state: "connected",
      workerCount: runtime.workers.length,
      queueClasses: [...queueClasses],
      lastError: null,
    });
    logger.info("Temporal workers connected", {
      address: this.#options.address,
      namespace: this.#options.namespace,
      stage: this.#options.stage,
      workerCount: runtime.workers.length,
      queueClasses: [...queueClasses],
    });
  }

  #recordDegradedState(error: unknown): void {
    this.#active = undefined;
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Temporal component is degraded; reconnecting", {
      address: this.#options.address,
      attempt: this.#attempt,
      consecutiveFailures: this.#consecutiveFailures,
      nextRetryMs: reconnectDelayMs(this.#consecutiveFailures),
      message,
      // The message alone is not enough to diagnose a repeating failure:
      // it was the only field logged while this loop ran for hours.
      stack: error instanceof Error ? error.stack : undefined,
      cause: error instanceof Error ? error.cause : undefined,
    });
    Sentry.captureException(error, {
      tags: { source: "temporal-supervisor" },
      extra: {
        attempt: this.#attempt,
        consecutiveFailures: this.#consecutiveFailures,
        namespace: this.#options.namespace,
      },
    });
    setScoutTemporalHealth({
      state: "degraded",
      workerCount: 0,
      queueClasses: [...this.#queueClasses()],
      lastError: message,
    });
  }

  #shouldStop(): boolean {
    return this.#closed;
  }
}

export function startScoutTemporalSupervisor(
  options: ScoutTemporalSupervisorOptions,
): ScoutTemporalSupervisor {
  return new ScoutTemporalSupervisor(options);
}
