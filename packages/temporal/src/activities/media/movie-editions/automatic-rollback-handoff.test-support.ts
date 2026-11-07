import { Worker } from "@temporalio/worker";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import type { createAutomaticMovieRollbackHandoffFixture } from "@shepherdjerred/media/testing/movie-automatic-rollback-handoff";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "#activities/media/movie-editions.ts";
import {
  createRequestedMovieRollbackNetworkWorkerActivitiesV1,
  createRequestedMovieRollbackFileWorkerActivitiesV1,
} from "#activities/media/movie-editions/manual-rollback.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export type AutomaticHandoffScenario = Awaited<
  ReturnType<typeof createAutomaticMovieRollbackHandoffFixture>
>;

function latch() {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    release: () => {
      if (release === undefined)
        throw new Error("Actual interruption latch missing");
      release();
    },
  };
}

/** The native journal ACK already exists before the original SDK runs stop. */
export function automaticHandoffInterruption(
  scenario: AutomaticHandoffScenario,
) {
  const admitted = latch(),
    continueAdmission = latch(),
    acked = latch(),
    continueAck = latch(),
    settled = latch();
  const acknowledgements: string[] = [];
  let interrupted = false;
  scenario.setCheckpoint(async (phase) => {
    if (!phase.startsWith("publication-effect-ack:")) return;
    acknowledgements.push(phase);
    if (interrupted) return;
    interrupted = true;
    acked.release();
    await continueAck.promise;
    throw new Error(
      "Actual automatic executor stopped after its first durable inverse ACK",
    );
  });
  return {
    admitted: admitted.promise,
    acked: acked.promise,
    settled: settled.promise,
    continueAdmission: continueAdmission.release,
    continueAck: continueAck.release,
    acknowledgements,
    prepare: async <T>(producer: () => Promise<T>) => {
      const actual = await producer();
      admitted.release();
      await continueAdmission.promise;
      return actual;
    },
    physical: async <T>(producer: () => Promise<T>) => {
      try {
        return await producer();
      } finally {
        settled.release();
      }
    },
  };
}

export async function automaticHandoffRoles(
  environment: TestWorkflowEnvironment,
  scenario: AutomaticHandoffScenario,
  interruption: ReturnType<typeof automaticHandoffInterruption>,
) {
  const load = () => Promise.resolve({ movie: scenario.fileMovie });
  const original = createMovieFileWorkerActivitiesV4(load);
  const files = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: {
      ...original,
      ...createRequestedMovieRollbackFileWorkerActivitiesV1(load),
      prepareMovieRollbackV4: (
        input: Parameters<typeof original.prepareMovieRollbackV4>[0],
      ) => interruption.prepare(() => original.prepareMovieRollbackV4(input)),
      rollbackMoviePublicationV4: (
        input: Parameters<typeof original.rollbackMoviePublicationV4>[0],
      ) =>
        interruption.physical(() => original.rollbackMoviePublicationV4(input)),
    },
  });
  const networkLoad = () => Promise.resolve({ movie: scenario.movie });
  const network = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      ...createMovieNetworkWorkerActivitiesV4(networkLoad),
      ...createRequestedMovieRollbackNetworkWorkerActivitiesV1(networkLoad),
      finishMediaOperation: scenario.finishMediaOperation,
    },
  });
  const workers = [network, files];
  return { workers, running: workers.map((worker) => worker.run()) };
}
