import { NativeConnection, Worker } from "@temporalio/worker";
import * as Sentry from "@sentry/bun";
import configuration, { type Environment } from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import { runScheduledCompetitionUpdates } from "./scheduled-update-dispatcher.ts";

const logger = createLogger("competition-temporal-worker");

const SCOUT_COMPETITION_TASK_QUEUES = {
  beta: "scout-beta",
  prod: "scout-prod",
} as const;

export type ScoutCompetitionActivityWorker = {
  shutdown: () => Promise<void>;
};

export function scoutCompetitionTaskQueue(
  environment: Exclude<Environment, "dev">,
): string {
  return SCOUT_COMPETITION_TASK_QUEUES[environment];
}

/**
 * Start the stage-local activity worker used by the declarative Temporal
 * minute schedule. Scout's embedded worker owns stage Workflow execution; this
 * activity-only worker preserves the competition schedule contract while
 * keeping database and Discord access inside Scout.
 */
export async function startScoutCompetitionActivityWorker(): Promise<
  ScoutCompetitionActivityWorker | undefined
> {
  if (
    !configuration.enableBackgroundJobs ||
    configuration.environment === "dev"
  ) {
    logger.info(
      "⏭️  Scout competition Temporal activity worker disabled locally",
    );
    return undefined;
  }

  const address = configuration.temporalAddress;
  if (address === undefined) {
    throw new Error(
      `TEMPORAL_ADDRESS is required in ${configuration.environment}`,
    );
  }

  const taskQueue = scoutCompetitionTaskQueue(configuration.environment);
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue,
    activities: { runScheduledCompetitionUpdates },
    maxConcurrentActivityTaskExecutions: 1,
  });

  const lifecycle = { shutdownStarted: false };
  let runFailure: Error | undefined;
  const completion = (async () => {
    try {
      await worker.run();
      if (!lifecycle.shutdownStarted) {
        throw new Error(
          "Scout competition Temporal activity worker stopped unexpectedly",
        );
      }
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new Error("Scout competition Temporal activity worker failed", {
              cause: error,
            });
      runFailure = failure;
      logger.error(
        "Scout competition Temporal activity worker failed",
        failure,
      );
      Sentry.captureException(failure, {
        tags: { source: "competition-temporal-worker", taskQueue },
      });
      if (!lifecycle.shutdownStarted) {
        await Sentry.flush(2000);
        process.exit(1);
      }
    }
  })();

  logger.info(
    `⏰ Scout competition Temporal activity worker polling ${taskQueue}`,
  );

  return {
    shutdown: async () => {
      if (lifecycle.shutdownStarted) return;
      lifecycle.shutdownStarted = true;
      if (worker.getState() === "RUNNING") {
        worker.shutdown();
      }
      await completion;
      await connection.close();
      if (runFailure !== undefined) {
        throw runFailure;
      }
    },
  };
}
