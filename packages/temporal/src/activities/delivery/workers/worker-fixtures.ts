import type {
  ArtifactVersion,
  WorkerVersion,
} from "@shepherdjerred/delivery/contract";

export function retainedWorkerPod(worker: WorkerVersion) {
  return {
    metadata: {
      labels: {
        "worker-family": "central-workflows",
        component: `central-workflows-retained-${worker.buildId.slice(0, 12)}`,
        "delivery.shepherdjerred.com/worker-build": worker.buildId,
      },
    },
    spec: { containers: [{ name: "host", image: worker.image }] },
    status: {
      phase: "Running",
      containerStatuses: [
        {
          name: "host",
          ready: true,
          imageID: worker.runtimeDigests[0],
          state: { running: {} },
        },
      ],
    },
  };
}

/** External-boundary fixture derived from the real frozen original artifact, never a new producer identity. */
export function controlPlanePod(artifact: ArtifactVersion) {
  return {
    metadata: { labels: { component: "delivery-worker" } },
    spec: {
      containers: [
        {
          name: "executor",
          image: `${artifact.uri}:${artifact.version}@${artifact.digest}`,
        },
      ],
    },
    status: {
      phase: "Running",
      containerStatuses: [
        {
          name: "executor",
          ready: true,
          imageID: artifact.runtimeDigests[0] ?? artifact.digest,
          state: { running: {} },
        },
      ],
    },
  };
}
