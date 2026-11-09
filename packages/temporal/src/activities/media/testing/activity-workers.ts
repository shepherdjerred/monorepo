import { Worker } from "@temporalio/worker";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import {
  createAcquisitionFileWorkerActivities,
  createAcquisitionNetworkWorkerActivities,
} from "#activities/media/acquisition.ts";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import { createPlexPublicationActivities } from "#activities/media/plex-publication.ts";
import { createPlexBoundConsumerActivities } from "#activities/media/plex-consumers.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

type ActivityOptions = Required<
  Pick<
    Parameters<typeof Worker.create>[0],
    "namespace" | "taskQueue" | "activities"
  >
>;

/** Only constructor plumbing; callers retain worker start/drain ordering. */
export function createMediaActivityTestWorker(
  environment: TestWorkflowEnvironment,
  options: ActivityOptions,
) {
  return Worker.create({
    connection: environment.nativeConnection,
    ...options,
  });
}

/** Existing publication adapters; callers retain their own activity maps. */
export function plexRoleActivities(
  load: Parameters<typeof createPlexPublicationActivities>[0] &
    Parameters<typeof createPlexBoundConsumerActivities>[0],
) {
  return {
    ...createPlexPublicationActivities(load),
    ...createPlexBoundConsumerActivities(load),
  };
}

export function createAcquisitionFileTestWorker(
  environment: TestWorkflowEnvironment,
  namespace: "dev" | "default",
  load: Parameters<typeof createAcquisitionFileWorkerActivities>[0],
) {
  return createMediaActivityTestWorker(environment, {
    namespace,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: createAcquisitionFileWorkerActivities(load),
  });
}

type NetworkAcquisition = Awaited<
  ReturnType<Parameters<typeof createAcquisitionNetworkWorkerActivities>[0]>
>["acquisition"];
type FileAcquisition = Awaited<
  ReturnType<Parameters<typeof createAcquisitionFileWorkerActivities>[0]>
>["acquisition"];
type PlexRoleRuntime = Awaited<
  ReturnType<Parameters<typeof createPlexPublicationActivities>[0]>
> &
  Awaited<ReturnType<Parameters<typeof createPlexBoundConsumerActivities>[0]>>;

type AcquisitionRoleScenario = PlexRoleRuntime & {
  acquisition: NetworkAcquisition;
  fileAcquisition: FileAcquisition;
  finishMediaOperation: MediaNetworkActivities["finishMediaOperation"];
};

function acquisitionRoleActivities(
  scenario: AcquisitionRoleScenario,
  extraNetworkActivities: object = {},
) {
  return {
    ...createAcquisitionNetworkWorkerActivities(() =>
      Promise.resolve({ acquisition: scenario.acquisition }),
    ),
    ...extraNetworkActivities,
    ...plexRoleActivities(() => Promise.resolve(scenario)),
    finishMediaOperation: scenario.finishMediaOperation,
  };
}

/**
 * The Network and Files role workers an acquisition journey needs: Network
 * runs acquisition, Plex publication/consumers and operation completion.
 * Constructor plumbing only; callers retain worker start/drain ordering.
 */
export async function createAcquisitionRoleTestWorkers(
  environment: TestWorkflowEnvironment,
  scenario: AcquisitionRoleScenario,
  extraNetworkActivities: object = {},
) {
  const network = await createMediaActivityTestWorker(environment, {
    namespace: "dev",
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: acquisitionRoleActivities(scenario, extraNetworkActivities),
  });
  const files = await createAcquisitionFileTestWorker(environment, "dev", () =>
    Promise.resolve({ acquisition: scenario.fileAcquisition }),
  );
  return { network, files };
}

/** Register each owned worker before running it, retaining partial-start cleanup. */
export async function startAcquisitionRoleTestWorkers(
  environment: TestWorkflowEnvironment,
  scenario: AcquisitionRoleScenario,
  workers: Worker[],
  running: Promise<void>[],
) {
  await startMediaAcquisitionTestWorkers(
    environment,
    acquisitionRoleActivities(scenario),
    () => Promise.resolve({ acquisition: scenario.fileAcquisition }),
    { workers, running },
  );
}

/** Keep caller-specific lazy loaders and Activities on their original role queues. */
export async function startMediaAcquisitionTestWorkers(
  environment: TestWorkflowEnvironment,
  activities: ActivityOptions["activities"],
  loadFiles: Parameters<typeof createAcquisitionFileWorkerActivities>[0],
  lifetime: { workers: Worker[]; running: Promise<void>[] },
) {
  const network = await createMediaActivityTestWorker(environment, {
    namespace: "dev",
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities,
  });
  lifetime.workers.push(network);
  lifetime.running.push(network.run());
  const files = await createAcquisitionFileTestWorker(
    environment,
    "dev",
    loadFiles,
  );
  lifetime.workers.push(files);
  lifetime.running.push(files.run());
}
