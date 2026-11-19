import { Worker } from "@temporalio/worker";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import { createMediaFileActivities } from "@shepherdjerred/media/automation/files";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "#activities/media/movie-editions.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { compensationCall } from "#activities/media/compensation-execution.ts";

type NetworkMovie = Awaited<
  ReturnType<Parameters<typeof createMovieNetworkWorkerActivitiesV4>[0]>
>["movie"];
type FileMovie = Awaited<
  ReturnType<Parameters<typeof createMovieFileWorkerActivitiesV4>[0]>
>["movie"];

/** Real V4 role adapters and separate queues, without scenario assertions. */
export async function startMovieRoleActivitiesV4(
  environment: TestWorkflowEnvironment,
  scenario: {
    movie: NetworkMovie;
    fileMovie: FileMovie;
    fileContext: Parameters<typeof createMediaFileActivities>[0];
    finishMediaOperation: MediaNetworkActivities["finishMediaOperation"];
  },
  roles: { workers: Worker[]; running: Promise<void>[] },
  additionalNetwork: NonNullable<
    Parameters<typeof Worker.create>[0]["activities"]
  > = {},
) {
  const network = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "dev",
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      ...createMovieNetworkWorkerActivitiesV4(() =>
        Promise.resolve({ movie: scenario.movie }),
      ),
      ...additionalNetwork,
      finishMediaOperation: scenario.finishMediaOperation,
    },
  });
  roles.workers.push(network);
  roles.running.push(network.run());
  const files = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "dev",
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: {
      ...createMovieFileWorkerActivitiesV4(() =>
        Promise.resolve({ movie: scenario.fileMovie }),
      ),
      prepareSubtitleSpeechV1: (
        input: Parameters<
          ReturnType<
            typeof createMediaFileActivities
          >["prepareSubtitleSpeechV1"]
        >[0],
      ) => {
        const observed = { wall: Date.now(), monotonic: performance.now() };
        return compensationCall((execution) =>
          createMediaFileActivities({
            ...scenario.fileContext,
            publicationExecution: () => ({
              ...execution,
              observed,
              checkpoint: () => execution.checkpoint("subtitle-speech"),
            }),
          }).prepareSubtitleSpeechV1(input),
        );
      },
    },
  });
  roles.workers.push(files);
  roles.running.push(files.run());
}
