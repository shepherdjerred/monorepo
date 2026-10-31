import {
  DeploymentDetailSchema,
  type DeploymentDetail,
  type WorkerRolloutPlan,
} from "@shepherdjerred/delivery/contract";
import { workerPlanEvidence } from "./worker-plan.ts";
import { centralRolloutPool } from "./worker-pool-fixture.ts";
import {
  artifact,
  detail as arcadeDetail,
} from "#lib/delivery/model/testing.ts";

/**
 * Test fixture: temporal/prod as a model recipe rolling a candidate onto the
 * central pool beside the stable host (E5), with the routing plan its
 * worker preflight records.
 */
export const CANDIDATE = "b".repeat(40);
export const STABLE = "a".repeat(40);
export const chart = artifact({
  id: "chart/temporal",
  component: "chart:temporal",
  kind: "chart",
  uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/temporal-1.0.0.tgz",
  version: "1.0.0",
  character: "c",
});
export const definition = {
  kind: "kubernetes-application",
  application: {
    name: "temporal",
    project: "default",
    destination: {
      server: "https://kubernetes.default.svc",
      namespace: "temporal",
    },
    source: {
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      chart: "temporal",
    },
    lifecycle: "retain",
  },
  chartComponent: "chart:temporal",
  artifactParameters: {
    "delivery.images.temporal-worker": {
      component: "image:temporal-worker",
      format: "reference",
    },
  },
  runner: { service: "ci", component: "image:ci-base" },
  steps: [
    { kind: "apply-safety", instance: "application:temporal" },
    { kind: "sync", instance: "application:temporal" },
    {
      kind: "worker-rollout",
      instance: "worker-pool:central",
      target: "central",
      imageComponent: "image:temporal-worker",
    },
  ],
  oracle: { probes: [], tests: [] },
};

/** temporal/prod rolling the candidate onto the central pool beside the stable host. */
export function temporal(
  stages: {
    key: string;
    status: "running" | "succeeded";
    operationId?: string;
  }[],
  evidence: unknown[] = [],
): DeploymentDetail {
  const base = arcadeDetail(definition, chart, []);
  return DeploymentDetailSchema.parse({
    ...base,
    deployment: {
      ...base.deployment,
      environmentId: "temporal/prod",
      serviceId: "temporal",
      workerSnapshot: {
        ...centralRolloutPool({
          stable: STABLE,
          candidate: CANDIDATE,
          candidateArtifactId: "image/temporal",
        }),
        workerOperation: "rollout",
      },
    },
    environment: {
      ...base.environment,
      id: "temporal/prod",
      serviceId: "temporal",
      application: "temporal",
    },
    versionSet: {
      ...base.versionSet,
      serviceId: "temporal",
      components: {
        "chart:temporal": chart,
        "image:temporal-worker": {
          ...artifact({
            id: "image/temporal",
            component: "image:temporal-worker",
            kind: "image",
            uri: "docker.io/shepherdjerred/temporal-worker",
            version: "build-1",
            character: "b",
          }),
          sourceRevision: CANDIDATE,
        },
      },
    },
    configuration: { id: "config/1", content: {} },
    stages: stages.map((stage) => ({
      ...stage,
      id: `stage/${stage.key}`,
      deploymentId: "deployment/1",
      operationId: stage.operationId ?? `op-${stage.key}`,
      message: "",
      startedAt: base.deployment.createdAt,
      updatedAt: base.deployment.createdAt,
    })),
    evidence,
  });
}

/**
 * The same deployment as a `retire-host` of the drained stable host: the
 * accepted candidate stays live and exactly the stable host is frozen at
 * zero replicas, as Delivery freezes a retirement (E5).
 */
export function retiringStable(current: DeploymentDetail): DeploymentDetail {
  const pool = current.deployment.workerSnapshot;
  if (pool === null) throw new Error("The fixture has no worker pool");
  return DeploymentDetailSchema.parse({
    ...current,
    deployment: {
      ...current.deployment,
      kind: "retire-host",
      workerSnapshot: {
        ...pool,
        workerOperation: "retire",
        retiringWorkerId: `worker/${STABLE}`,
        versions: pool.versions.map((worker) =>
          worker.buildId === STABLE
            ? {
                ...worker,
                replicas: 0,
                generation: worker.generation + 1,
                retiredAt: "2026-10-31T00:00:00.000Z",
              }
            : worker,
        ),
      },
    },
  });
}

export const PLAN: WorkerRolloutPlan = {
  target: "central",
  namespace: "prod",
  deploymentName: "central-workflows",
  taskQueue: "monorepo-workflows",
  candidateBuildId: CANDIDATE,
  candidateImage: `docker.io/shepherdjerred/temporal-worker@sha256:${"b".repeat(64)}`,
  expectedCurrentBuildId: STABLE,
  routes: [],
  deploymentId: "deployment/1",
};

export function planEvidence() {
  return {
    ...workerPlanEvidence(PLAN, "op-worker-preflight"),
    id: "deployment/1/stage/worker-preflight/0",
    deploymentId: "deployment/1",
    operationId: "op-worker-preflight",
    createdAt: "2026-10-21T00:00:00.000Z",
  };
}
