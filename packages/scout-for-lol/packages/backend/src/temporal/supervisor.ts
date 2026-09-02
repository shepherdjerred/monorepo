import * as Sentry from "@sentry/bun";
import type { Client } from "@temporalio/client";
import { createLogger } from "#src/logger.ts";
import {
  scoutTemporalConnected,
  scoutTemporalReconnects,
  scoutTemporalStartsRejected,
  scoutTemporalWorkers,
} from "#src/metrics/temporal.ts";
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

export class ScoutTemporalSupervisor {
  readonly #options: ScoutTemporalSupervisorOptions;
  #closed = false;
  #acceptingStarts = true;
  #discordWorkersEnabled = false;
  #active: ConnectedRuntime | undefined;
  readonly #runPromise: Promise<void>;
  #attempt = 0;
  #consecutiveFailures = 0;

  constructor(options: ScoutTemporalSupervisorOptions) {
    this.#options = options;
    this.#runPromise = this.#run();
  }

  enableDiscordWorkers(): void {
    if (this.#discordWorkersEnabled) return;
    this.#discordWorkersEnabled = true;
    const active = this.#active;
    if (active !== undefined) {
      for (const worker of active.workers) {
        if (worker.getState() === "RUNNING") worker.shutdown();
      }
    }
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
    setScoutTemporalHealth({
      state: "stopping",
      workerCount: this.#active?.workers.length ?? 0,
      discordWorkersEnabled: this.#discordWorkersEnabled,
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
    const discordWorkersEnabled = this.#discordWorkersEnabled;
    const runtime = await createConnectedRuntime(
      this.#options,
      discordWorkersEnabled,
    );
    if (
      this.#shouldStop() ||
      discordWorkersEnabled !== this.#discordWorkersEnabled
    ) {
      await closeConnectedRuntime(runtime);
      return;
    }
    this.#active = runtime;
    this.#recordConnectedState(runtime);
    const runs = runtime.workers.map(async (worker) => {
      await worker.run();
    });
    try {
      await Promise.race(runs);
    } finally {
      this.#active = undefined;
      await stopConnectedRuntime(runtime, runs);
    }
  }

  #recordConnectedState(runtime: ConnectedRuntime): void {
    scoutTemporalConnected.set(1);
    scoutTemporalWorkers.set({ queue_class: "workflow" }, 1);
    scoutTemporalWorkers.set({ queue_class: "interactive" }, 1);
    scoutTemporalWorkers.set({ queue_class: "lake" }, 1);
    scoutTemporalWorkers.set(
      { queue_class: "realtime" },
      this.#discordWorkersEnabled ? 1 : 0,
    );
    scoutTemporalWorkers.set(
      { queue_class: "background" },
      this.#discordWorkersEnabled ? 1 : 0,
    );
    setScoutTemporalHealth({
      state: "connected",
      workerCount: runtime.workers.length,
      discordWorkersEnabled: this.#discordWorkersEnabled,
      lastError: null,
    });
    logger.info("Temporal workers connected", {
      address: this.#options.address,
      namespace: this.#options.namespace,
      stage: this.#options.stage,
      workerCount: runtime.workers.length,
      discordWorkersEnabled: this.#discordWorkersEnabled,
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
      discordWorkersEnabled: this.#discordWorkersEnabled,
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
