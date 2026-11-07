import { Worker } from "@temporalio/worker";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import type { HandoffScenario } from "./rollback-handoff.test-support.ts";
import {
  createRequestedMovieRollbackFileWorkerActivitiesV1,
  createRequestedMovieRollbackNetworkWorkerActivitiesV1,
} from "./manual-rollback.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

type Stop = {
  operationId: string;
  acked: ReturnType<typeof Promise.withResolvers<undefined>>;
  proceed: ReturnType<typeof Promise.withResolvers<undefined>>;
  settled: ReturnType<typeof Promise.withResolvers<undefined>>;
  seen: boolean;
};

/** Every stop follows a genuine new durable caption ACK. The same actual WAL
 * is retained across all owners, and each old Activity drains before retry. */
export function repeatedOwnerInterruption(scenario: HandoffScenario) {
  const stops: Stop[] = [];
  const acknowledgements: string[] = [];
  let runningOperation: string | undefined;
  scenario.setCheckpoint(async (phase) => {
    if (!phase.startsWith("movie-rollback-caption-effect-ack:")) return;
    acknowledgements.push(phase);
    const stop = stops.find(
      (candidate) =>
        candidate.operationId === runningOperation && !candidate.seen,
    );
    if (stop === undefined) return;
    stop.seen = true;
    stop.acked.resolve(undefined);
    await stop.proceed.promise;
    throw new Error("Actual owner terminated after its native caption ACK");
  });
  return {
    acknowledgements,
    pause: (operationId: string) => {
      const stop: Stop = {
        operationId,
        acked: Promise.withResolvers<undefined>(),
        proceed: Promise.withResolvers<undefined>(),
        settled: Promise.withResolvers<undefined>(),
        seen: false,
      };
      stops.push(stop);
      return stop;
    },
    release: () => {
      for (const stop of stops) stop.proceed.resolve(undefined);
    },
    physical: async <T>(operationId: string, producer: () => Promise<T>) => {
      runningOperation = operationId;
      try {
        return await producer();
      } finally {
        stops
          .find((stop) => stop.operationId === operationId)
          ?.settled.resolve(undefined);
        runningOperation = undefined;
      }
    },
  };
}

export async function repeatedHandoffRoles(
  environment: TestWorkflowEnvironment,
  scenario: HandoffScenario,
  interruption: ReturnType<typeof repeatedOwnerInterruption>,
) {
  const actual = createRequestedMovieRollbackFileWorkerActivitiesV1(() =>
    Promise.resolve({ movie: scenario.fileMovie }),
  );
  const files = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: {
      ...actual,
      rollbackRequestedMoviePublicationV1: (
        input: Parameters<typeof actual.rollbackRequestedMoviePublicationV1>[0],
      ) =>
        interruption.physical(input.operationId, () =>
          actual.rollbackRequestedMoviePublicationV1(input),
        ),
    },
  });
  const network = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      ...createRequestedMovieRollbackNetworkWorkerActivitiesV1(() =>
        Promise.resolve({ movie: scenario.movie }),
      ),
      finishMediaOperation: scenario.finishMediaOperation,
    },
  });
  const workers = [files, network];
  return { workers, running: workers.map((worker) => worker.run()) };
}
