import { Client, Connection } from "@temporalio/client";
import {
  DefaultLogger,
  NativeConnection,
  Runtime,
  Worker,
} from "@temporalio/worker";
import type {
  ScoutStage,
  TemporalLegacyNamespace,
} from "@scout-for-lol/temporal";
import { scoutTaskQueues } from "@scout-for-lol/temporal";
import type { ScoutTemporalActivities } from "@scout-for-lol/temporal/activities";
import { createLogger } from "#src/logger.ts";
import {
  scoutTemporalConnected,
  scoutTemporalReconnects,
  scoutTemporalStartsRejected,
  scoutTemporalWorkers,
} from "#src/metrics/temporal.ts";
import { setScoutTemporalHealth } from "./health.ts";
import type { WeeklyParlayControlResult } from "#src/betting/weekly-parlay-control.ts";
import type { WeeklyParlayControlAction } from "@scout-for-lol/data/model/weekly-parlay.ts";
import {
  createTemporalClientTracingInterceptor,
  createTemporalWorkerTracing,
} from "@shepherdjerred/temporal-observability/interceptors";
import { createValidatedWorkflowSpanSink } from "@shepherdjerred/temporal-observability/workflow-span-sink";
import { sanitizeTemporalLogFields } from "@shepherdjerred/temporal-observability/log-fields";
import { getTracingRuntime } from "#src/observability/tracing.ts";

const logger = createLogger("temporal-supervisor");
const RECONNECT_DELAY_MS = 5000;
let runtimeInstalled = false;

function installTemporalRuntime(): void {
  if (runtimeInstalled) return;
  Runtime.install({
    logger: new DefaultLogger("INFO", (entry) => {
      const fields = {
        sdk: "temporal",
        sdkLevel: entry.level,
        ...sanitizeTemporalLogFields(entry.meta),
      };
      if (entry.level === "ERROR") logger.error(entry.message, fields);
      else if (entry.level === "WARN") logger.warn(entry.message, fields);
      else logger.info(entry.message, fields);
    }),
    telemetryOptions: {
      logging: {
        forward: {},
        filter: { core: "INFO", other: "WARN" },
      },
    },
  });
  runtimeInstalled = true;
}

type RealtimeActivities = Pick<
  ScoutTemporalActivities,
  | "pollRealtime"
  | "discoverPostMatchIds"
  | "runPostMatchMaintenance"
  | "ingestMatch"
  | "probeQueue"
>;
type InteractiveActivities = Pick<
  ScoutTemporalActivities,
  "runInteractive" | "persistInteractiveOutcome" | "probeQueue"
>;
type BackgroundActivities = Pick<
  ScoutTemporalActivities,
  | "fetchInitialHistoryPage"
  | "reconcileIngestion"
  | "runBackgroundJob"
  | "runDetachedBackgroundWork"
  | "drainReportScheduleOutbox"
  | "runReport"
  | "probeQueue"
> & {
  invokeScoutWeeklyParlayAction: (
    action: WeeklyParlayControlAction,
  ) => Promise<WeeklyParlayControlResult>;
  syncScoutBryanBucksAnalytics: () => Promise<{
    status: "reconciled" | "skipped";
    detail: string;
  }>;
};
type LakeActivities = Pick<
  ScoutTemporalActivities,
  "runReportLakeJob" | "runDetachedLakeWork" | "probeQueue"
>;

export type ScoutTemporalActivityGroups = {
  readonly realtime: RealtimeActivities;
  readonly interactive: InteractiveActivities;
  readonly background: BackgroundActivities;
  readonly lake: LakeActivities;
};

export type ScoutTemporalSupervisorOptions = {
  readonly address: string | undefined;
  readonly namespace: ScoutStage;
  readonly legacyNamespace: TemporalLegacyNamespace | undefined;
  readonly stage: ScoutStage;
  readonly activities: ScoutTemporalActivityGroups;
  readonly callGraphTracing: boolean;
};

type ConnectedRuntime = {
  readonly workers: Worker[];
  readonly nativeConnection: NativeConnection;
  readonly clientConnection: Connection;
  readonly client: Client;
};

function workflowsPath(): string {
  return new URL(import.meta.resolve("@scout-for-lol/temporal/workflows"))
    .pathname;
}

function workflowUiInterceptorPath(): string {
  return new URL(
    import.meta.resolve("@scout-for-lol/temporal/workflow-ui-interceptor"),
  ).pathname;
}

async function createConnectedRuntime(
  options: ScoutTemporalSupervisorOptions,
  discordWorkersEnabled: boolean,
): Promise<ConnectedRuntime> {
  installTemporalRuntime();
  const nativeConnection =
    options.address === undefined
      ? await NativeConnection.connect()
      : await NativeConnection.connect({ address: options.address });
  let clientConnection: Connection | undefined;
  try {
    clientConnection =
      options.address === undefined
        ? await Connection.connect()
        : await Connection.connect({ address: options.address });
    const queues = scoutTaskQueues(options.stage);
    const tracingRuntime = getTracingRuntime();
    if (tracingRuntime === undefined && options.callGraphTracing) {
      throw new Error(
        "temporal-call-graph-tracing requires TELEMETRY_ENABLED=true",
      );
    }
    const tracing =
      tracingRuntime !== undefined && options.callGraphTracing
        ? createTemporalWorkerTracing({
            exporter: createValidatedWorkflowSpanSink(
              tracingRuntime.processor,
              tracingRuntime.resource,
            ),
          })
        : undefined;
    const commonOptions = {
      connection: nativeConnection,
      namespace: options.namespace,
      shutdownGraceTime: 20_000,
      shutdownForceTime: 25_000,
      interceptors: {
        workflowModules: [
          workflowUiInterceptorPath(),
          ...(tracing?.workflowModules ?? []),
        ],
        ...(tracing === undefined ? {} : { activity: tracing.activity }),
      },
      ...(tracing === undefined ? {} : { sinks: tracing.sinks }),
    };
    const workers = [
      await Worker.create({
        ...commonOptions,
        taskQueue: queues.workflow,
        workflowsPath: workflowsPath(),
        maxConcurrentWorkflowTaskExecutions: 4,
      }),
      await Worker.create({
        ...commonOptions,
        taskQueue: queues.interactive,
        activities: options.activities.interactive,
        maxConcurrentActivityTaskExecutions: 2,
      }),
      await Worker.create({
        ...commonOptions,
        taskQueue: queues.lake,
        activities: options.activities.lake,
        maxConcurrentActivityTaskExecutions: 1,
      }),
    ];
    if (discordWorkersEnabled) {
      workers.push(
        await Worker.create({
          ...commonOptions,
          taskQueue: queues.realtime,
          activities: options.activities.realtime,
          maxConcurrentActivityTaskExecutions: 4,
        }),
        await Worker.create({
          ...commonOptions,
          taskQueue: queues.background,
          activities: options.activities.background,
          maxConcurrentActivityTaskExecutions: 1,
        }),
      );
    }
    if (options.legacyNamespace !== undefined) {
      const legacyOptions = {
        ...commonOptions,
        namespace: options.legacyNamespace,
      };
      workers.push(
        await Worker.create({
          ...legacyOptions,
          taskQueue: queues.workflow,
          workflowsPath: workflowsPath(),
          maxConcurrentWorkflowTaskExecutions: 1,
        }),
        await Worker.create({
          ...legacyOptions,
          taskQueue: queues.interactive,
          activities: options.activities.interactive,
          maxConcurrentActivityTaskExecutions: 1,
        }),
        await Worker.create({
          ...legacyOptions,
          taskQueue: queues.lake,
          activities: options.activities.lake,
          maxConcurrentActivityTaskExecutions: 1,
        }),
      );
      if (discordWorkersEnabled) {
        workers.push(
          await Worker.create({
            ...legacyOptions,
            taskQueue: queues.realtime,
            activities: options.activities.realtime,
            maxConcurrentActivityTaskExecutions: 1,
          }),
          await Worker.create({
            ...legacyOptions,
            taskQueue: queues.background,
            activities: options.activities.background,
            maxConcurrentActivityTaskExecutions: 1,
          }),
        );
      }
    }
    return {
      workers,
      nativeConnection,
      clientConnection,
      client: new Client({
        connection: clientConnection,
        namespace: options.namespace,
        ...(options.callGraphTracing
          ? {
              interceptors: {
                workflow: [createTemporalClientTracingInterceptor()],
              },
            }
          : {}),
      }),
    };
  } catch (error: unknown) {
    if (clientConnection !== undefined) await clientConnection.close();
    await nativeConnection.close();
    throw error;
  }
}

async function closeConnectedRuntime(runtime: ConnectedRuntime): Promise<void> {
  const runs = runtime.workers.map(async (worker) => {
    await worker.run();
  });
  await stopConnectedRuntime(runtime, runs);
}

async function stopConnectedRuntime(
  runtime: ConnectedRuntime,
  runs: Promise<void>[],
): Promise<void> {
  for (const worker of runtime.workers) {
    if (worker.getState() === "RUNNING") worker.shutdown();
  }
  await Promise.allSettled(runs);
  try {
    await runtime.clientConnection.close();
  } finally {
    await runtime.nativeConnection.close();
  }
}

export class ScoutTemporalSupervisor {
  readonly #options: ScoutTemporalSupervisorOptions;
  #closed = false;
  #acceptingStarts = true;
  #discordWorkersEnabled = false;
  #active: ConnectedRuntime | undefined;
  readonly #runPromise: Promise<void>;
  #attempt = 0;

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
      } catch (error: unknown) {
        this.#recordDegradedState(error);
      } finally {
        scoutTemporalConnected.set(0);
        if (this.#active === undefined) scoutTemporalWorkers.reset();
      }
      if (this.#shouldStop()) return;
      await Bun.sleep(RECONNECT_DELAY_MS);
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
      legacyNamespace: this.#options.legacyNamespace,
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
      message,
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
