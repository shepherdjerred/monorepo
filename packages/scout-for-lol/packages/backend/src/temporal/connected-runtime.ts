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
const RECONNECT_DELAY_MAX_MS = 60_000;
/**
 * Longer than the workers' own `shutdownForceTime` (25s), so a worker that is
 * being force-stopped still gets to finish before this gives up on it.
 */
const DISCARD_DRAIN_TIMEOUT_MS = 30_000;

/**
 * Back off between reconnects so a persistent failure cannot spin.
 *
 * A flat retry here rebuilt five workers and a webpack workflow bundle every
 * five seconds for hours, leaking a connection per attempt and burying the
 * signal under identical warnings. The first retry stays prompt because most
 * failures are a transient server restart.
 */
export function reconnectDelayMs(consecutiveFailures: number): number {
  const exponent = Math.max(0, consecutiveFailures - 1);
  return Math.min(RECONNECT_DELAY_MS * 2 ** exponent, RECONNECT_DELAY_MAX_MS);
}
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

/**
 * The parts of a Worker and a connection that releasing a runtime touches.
 * Declaring the capability rather than the SDK classes keeps the release path
 * testable against a fake that models the reference-holder invariant, without
 * standing up a real Worker or asserting a fake into one.
 */
type ReleasableWorker = {
  getState: () => string;
  run: () => Promise<void>;
  shutdown: () => void;
};

type ClosableConnection = {
  close: () => Promise<void>;
};

export type ConnectedRuntime = {
  readonly workers: Worker[];
  readonly nativeConnection: NativeConnection;
  readonly clientConnection: Connection;
  readonly client: Client;
};

type ScoutTemporalTracing = ReturnType<typeof createTemporalWorkerTracing>;

function workflowsPath(): string {
  return new URL(import.meta.resolve("@scout-for-lol/temporal/workflows"))
    .pathname;
}

function workflowUiInterceptorPath(): string {
  return new URL(
    import.meta.resolve("@scout-for-lol/temporal/workflow-ui-interceptor"),
  ).pathname;
}

function createScoutTemporalTracing(
  callGraphTracing: boolean,
): ScoutTemporalTracing | undefined {
  const tracingRuntime = getTracingRuntime();
  if (tracingRuntime === undefined && callGraphTracing) {
    throw new Error(
      "temporal-call-graph-tracing requires TELEMETRY_ENABLED=true",
    );
  }
  return tracingRuntime !== undefined && callGraphTracing
    ? createTemporalWorkerTracing({
        exporter: createValidatedWorkflowSpanSink(
          tracingRuntime.processor,
          tracingRuntime.resource,
        ),
      })
    : undefined;
}

export async function createConnectedRuntime(
  options: ScoutTemporalSupervisorOptions,
  discordWorkersEnabled: boolean,
): Promise<ConnectedRuntime> {
  installTemporalRuntime();
  const nativeConnection =
    options.address === undefined
      ? await NativeConnection.connect()
      : await NativeConnection.connect({ address: options.address });
  let clientConnection: Connection | undefined;
  // `Worker.create` registers a reference holder on the native connection the
  // moment it returns, and the holder is only released once that worker's
  // `run()` promise settles. Collect the workers as they are built so a
  // mid-sequence failure can drain them before anything closes the
  // connection: closing it while a holder remains throws IllegalStateError,
  // which would replace the failure we actually need to see.
  const workers: Worker[] = [];
  try {
    clientConnection =
      options.address === undefined
        ? await Connection.connect()
        : await Connection.connect({ address: options.address });
    const queues = scoutTaskQueues(options.stage);
    const tracing = createScoutTemporalTracing(options.callGraphTracing);
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
    workers.push(
      await Worker.create({
        ...commonOptions,
        taskQueue: queues.workflow,
        workflowsPath: workflowsPath(),
        maxConcurrentWorkflowTaskExecutions: 4,
      }),
    );
    workers.push(
      await Worker.create({
        ...commonOptions,
        taskQueue: queues.interactive,
        activities: options.activities.interactive,
        maxConcurrentActivityTaskExecutions: 2,
      }),
    );
    workers.push(
      await Worker.create({
        ...commonOptions,
        taskQueue: queues.lake,
        activities: options.activities.lake,
        maxConcurrentActivityTaskExecutions: 1,
      }),
    );
    if (discordWorkersEnabled) {
      workers.push(
        await Worker.create({
          ...commonOptions,
          taskQueue: queues.realtime,
          activities: options.activities.realtime,
          maxConcurrentActivityTaskExecutions: 4,
        }),
      );
      workers.push(
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
      // The legacy pollers exist only to let pre-cutover histories in the
      // retired namespace finish. They are best-effort: a drain worker that
      // cannot be created must not take the live namespace's workers down
      // with it, which is what turned one failure here into a permanent
      // reconnect loop that left Scout with no pollers at all.
      try {
        workers.push(
          await Worker.create({
            ...legacyOptions,
            taskQueue: queues.workflow,
            workflowsPath: workflowsPath(),
            maxConcurrentWorkflowTaskExecutions: 1,
          }),
        );
        workers.push(
          await Worker.create({
            ...legacyOptions,
            taskQueue: queues.interactive,
            activities: options.activities.interactive,
            maxConcurrentActivityTaskExecutions: 1,
          }),
        );
        workers.push(
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
          );
          workers.push(
            await Worker.create({
              ...legacyOptions,
              taskQueue: queues.background,
              activities: options.activities.background,
              maxConcurrentActivityTaskExecutions: 1,
            }),
          );
        }
      } catch (error: unknown) {
        logger.warn("Legacy Temporal drain workers unavailable; continuing", {
          namespace: options.legacyNamespace,
          error,
        });
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
    await discardPartialRuntime(
      { workers, clientConnection, nativeConnection },
      error,
    );
    throw error;
  }
}

/**
 * Release a runtime that failed part-way through construction, without ever
 * letting the cleanup replace the failure that caused it.
 *
 * Ordering matters: a created-but-never-run worker holds a reference to the
 * native connection forever, so the workers have to be run and drained before
 * either connection is closed. Cleanup failures are logged and swallowed here
 * precisely so the caller's `throw error` survives — the previous version
 * closed the connection first, threw IllegalStateError from inside the
 * handler, and discarded the real error along with it.
 */
export async function discardPartialRuntime(
  parts: {
    readonly workers: readonly ReleasableWorker[];
    readonly clientConnection: ClosableConnection | undefined;
    readonly nativeConnection: ClosableConnection;
  },
  cause: unknown,
  drainTimeoutMs: number = DISCARD_DRAIN_TIMEOUT_MS,
): Promise<void> {
  try {
    const runs = parts.workers.map(async (worker) => {
      await worker.run();
    });
    for (const worker of parts.workers) {
      if (worker.getState() === "RUNNING") worker.shutdown();
    }
    // Bounded on purpose. A worker that will not settle its `run()` promise
    // would otherwise wedge this await forever, and the reconnect loop awaits
    // it — turning a cleanup problem into a supervisor that never retries at
    // all. If the drain does not finish, the references are still held, so
    // closing would throw; leave both connections to the process instead.
    const drained = await Promise.race([
      Promise.allSettled(runs).then(() => true),
      Bun.sleep(drainTimeoutMs).then(() => false),
    ]);
    if (!drained) {
      logger.warn("Timed out draining a partially built Temporal runtime", {
        workerCount: parts.workers.length,
        drainTimeoutMs,
        cause,
      });
      return;
    }
    try {
      if (parts.clientConnection !== undefined) {
        await parts.clientConnection.close();
      }
    } finally {
      await parts.nativeConnection.close();
    }
  } catch (cleanupError: unknown) {
    logger.warn("Failed to release a partially built Temporal runtime", {
      workerCount: parts.workers.length,
      cleanupError,
      cause,
    });
  }
}

export async function closeConnectedRuntime(
  runtime: ConnectedRuntime,
): Promise<void> {
  const runs = runtime.workers.map(async (worker) => {
    await worker.run();
  });
  await stopConnectedRuntime(runtime, runs);
}

export async function stopConnectedRuntime(
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
