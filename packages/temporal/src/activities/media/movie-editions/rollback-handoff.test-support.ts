import { createMediaActivityTestWorker } from "#activities/media/testing/activity-workers.ts";

import type { TestWorkflowEnvironment } from "@temporalio/testing";
import type { createMovieRollbackHandoffRoleFixture } from "@shepherdjerred/media/testing/movie-rollback-handoff";
import {
  createRequestedMovieRollbackFileWorkerActivitiesV1,
  createRequestedMovieRollbackNetworkWorkerActivitiesV1,
} from "#activities/media/movie-editions/manual-rollback.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export type HandoffScenario = Awaited<
  ReturnType<typeof createMovieRollbackHandoffRoleFixture>
>;

function latch() {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    release: () => {
      if (release === undefined) throw new Error("Latch was not initialized");
      release();
    },
  };
}

/** Pauses only after actual producer results/ACKs. No response or persisted
 * Workflow/Operation status is manufactured by this interruption harness. */
export function handoffInterruption(scenario: HandoffScenario) {
  const admitted = latch(),
    continueAdmission = latch(),
    acked = latch(),
    continueAck = latch(),
    settled = latch();
  const acknowledgements: string[] = [];
  let interrupted = false;
  scenario.setCheckpoint(async (phase) => {
    if (!phase.startsWith("movie-rollback-caption-effect-ack:")) return;
    acknowledgements.push(phase);
    if (interrupted) return;
    interrupted = true;
    acked.release();
    await continueAck.promise;
    throw new Error(
      "Test transport stopped after the actual owner run terminated",
    );
  });
  return {
    admitted: admitted.promise,
    acked: acked.promise,
    settled: settled.promise,
    continueAdmission: continueAdmission.release,
    continueAck: continueAck.release,
    acknowledgements,
    prepare: async <T>(
      input: { operationId: string },
      producer: () => Promise<T>,
    ) => {
      const actual = await producer();
      if (input.operationId === scenario.input.operationId) {
        admitted.release();
        await continueAdmission.promise;
      }
      return actual;
    },
    physical: async <T>(
      input: { operationId: string },
      producer: () => Promise<T>,
    ) => {
      try {
        return await producer();
      } finally {
        if (input.operationId === scenario.input.operationId) settled.release();
      }
    },
  };
}

export async function handoffRoles(
  environment: TestWorkflowEnvironment,
  scenario: HandoffScenario,
  interruption: ReturnType<typeof handoffInterruption>,
) {
  const actualFiles = createRequestedMovieRollbackFileWorkerActivitiesV1(() =>
    Promise.resolve({ movie: scenario.fileMovie }),
  );
  const files = await createMediaActivityTestWorker(environment, {
    namespace: "default",
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: {
      ...actualFiles,
      prepareRequestedMovieRollbackV1: (
        input: Parameters<
          typeof actualFiles.prepareRequestedMovieRollbackV1
        >[0],
      ) =>
        interruption.prepare(input, () =>
          actualFiles.prepareRequestedMovieRollbackV1(input),
        ),
      rollbackRequestedMoviePublicationV1: (
        input: Parameters<
          typeof actualFiles.rollbackRequestedMoviePublicationV1
        >[0],
      ) =>
        interruption.physical(input, () =>
          actualFiles.rollbackRequestedMoviePublicationV1(input),
        ),
    },
  });
  const network = await createMediaActivityTestWorker(environment, {
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
