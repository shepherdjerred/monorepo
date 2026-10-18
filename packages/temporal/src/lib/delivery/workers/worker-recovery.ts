import { z } from "zod";
import {
  CompleteWorkerRecoverySchema,
  type CompleteWorkerRecovery,
  type WorkerRecoveryContext,
  type WorkerPoolSnapshot,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { deliveryWorkerPool } from "./worker-pool.ts";
import {
  deliveryOperationId,
  deliverySelection,
} from "#lib/delivery/selection.ts";
import { verifyArgoRelease } from "#lib/delivery/argocd-proof.ts";
import {
  requireLegacyWorkerCoverage,
  verifyWorkerBaselinePods,
  verifyWorkerPoolPods,
} from "./worker-hosts.ts";
import { workerSourceFingerprint } from "./worker-source.ts";

export type WorkerRecoveryEffects = {
  workflowClosed: (deploymentId: string) => Promise<string>;
  readArgo: (path: string) => Promise<unknown>;
  resources: (
    application: string,
    kind: "Deployment" | "Pod",
  ) => Promise<unknown[]>;
  terminalJobs: (context: WorkerRecoveryContext) => Promise<EvidenceInput[]>;
  pollers: (pool: WorkerPoolSnapshot) => Promise<void>;
  routes: (
    pool: WorkerPoolSnapshot,
  ) => Promise<CompleteWorkerRecovery["routes"]>;
  noCandidateReferences: (pool: WorkerPoolSnapshot) => Promise<void>;
};

const StableArgo = z.object({
  operation: z.null().optional(),
  status: z.object({
    sync: z.object({ status: z.literal("Synced") }),
    health: z.object({ status: z.literal("Healthy") }),
    operationState: z.object({ phase: z.literal("Succeeded") }),
  }),
});

function ownedRecoveryArgo(
  before: unknown,
  detail: WorkerRecoveryContext["deployment"],
) {
  const { selection, operationId } = deliverySelection(detail);
  const request = z
    .object({
      status: z.object({
        operationState: z.object({
          operation: z.object({
            info: z.array(z.object({ name: z.string(), value: z.string() })),
          }),
        }),
      }),
    })
    .parse(before)
    .status.operationState.operation.info.find(
      (entry) => entry.name === "ci.sjer.red/request-id",
    )?.value;
  const bootstrapId = deliveryOperationId(
    `${detail.deployment.id}:worker-bootstrap`,
  );
  if (request !== operationId && request !== bootstrapId)
    throw new Error(
      "Recovery Argo operation is not owned by this frozen deployment",
    );
  const expected = selection;
  return {
    receipt: verifyArgoRelease(before, expected, request).operationId,
    expected,
    request,
  };
}

async function requireUnappliedWorkerHosts(
  context: WorkerRecoveryContext,
  pool: WorkerPoolSnapshot,
  effects: WorkerRecoveryEffects,
  before: unknown,
) {
  const detail = context.deployment;
  const application = deliverySelection(detail).selection.application;
  // Only read-only image inspection can precede source effect intent. Unknown stages fail closed.
  if (
    detail.stages.some(
      (stage) =>
        ![
          "worker-image-provenance",
          "preflight",
          "worker-baseline",
          "worker-prior-source",
        ].includes(stage.key),
    )
  )
    throw new Error("Recovery cannot classify an unowned pre-effect stage");
  const prior = detail.stages.find(
    (stage) =>
      stage.key === "worker-prior-source" && stage.status === "succeeded",
  );
  if (prior?.operationId !== workerSourceFingerprint(before))
    throw new Error(
      "Recovery prior source or ownership changed, or was never captured",
    );
  requireLegacyWorkerCoverage(
    await effects.resources(application, "Deployment"),
    pool,
  );
  const pods = await effects.resources(application, "Pod");
  const observed =
    pool.workerOperation === "baseline"
      ? pool
      : {
          ...pool,
          versions: pool.versions.filter(
            (worker) =>
              worker.introducedByDeploymentId !== detail.deployment.id,
          ),
        };
  if (pool.workerOperation !== "baseline") {
    await effects.noCandidateReferences(pool);
    const candidate = pool.versions.find(
      (worker) => worker.buildId === pool.candidateBuildId,
    );
    const family =
      pool.target === "central"
        ? "central-workflows"
        : `${pool.target}-workflows`;
    for (const pod of pods) {
      const actual = z
        .object({
          metadata: z.object({
            labels: z.record(z.string(), z.string()).default({}),
          }),
          spec: z.object({
            containers: z.array(z.object({ image: z.string() })),
          }),
        })
        .parse(pod);
      if (
        actual.metadata.labels["worker-family"] === family &&
        actual.spec.containers.some((container) =>
          container.image.endsWith(`@${candidate?.digest ?? "missing"}`),
        )
      )
        throw new Error(
          "Unapplied candidate unexpectedly has a live worker Pod",
        );
    }
  }
  verifyWorkerBaselinePods(pods, observed);
}

function requireStableRecoveryRoutes(
  pool: WorkerPoolSnapshot,
  routes: CompleteWorkerRecovery["routes"],
) {
  const live = new Set(
    pool.versions
      .filter((worker) => worker.replicas === 1)
      .map((worker) => worker.buildId),
  );
  const expectedRoutes = pool.versions[0]?.host.routes;
  if (
    routes.length !== expectedRoutes?.length ||
    routes.some(
      (route, index) =>
        !live.has(route.currentBuildId) ||
        route.routingConflictToken.length === 0 ||
        JSON.stringify({
          namespace: route.namespace,
          deploymentName: route.deploymentName,
          taskQueue: route.taskQueue,
        }) !== JSON.stringify(expectedRoutes[index]),
    )
  )
    throw new Error(
      "Recovery lacks stable routing and retained hosts in every served namespace",
    );
}

/** Read-only proof, independent of Activity Context; operator and Workflow use exactly this verifier. */
export async function proveSettledWorkerRecovery(
  context: WorkerRecoveryContext,
  effects: WorkerRecoveryEffects,
  now: () => Date = () => new Date(),
): Promise<CompleteWorkerRecovery> {
  const detail = context.deployment;
  const pool = deliveryWorkerPool(detail);
  if (
    pool === undefined ||
    !["failed", "canceled"].includes(detail.deployment.status) ||
    !detail.deployment.recoveryRequired ||
    detail.environment.activeDeploymentId !== detail.deployment.id
  )
    throw new Error(
      "Worker recovery does not hold the exact failed deployment identity",
    );
  const workflowId = await effects.workflowClosed(detail.deployment.id);
  const jobs = await effects.terminalJobs(context);
  const { selection } = deliverySelection(detail);
  const application = encodeURIComponent(selection.application);
  const before = await effects.readArgo(application);
  StableArgo.parse(before);
  const operated = detail.stages.some((stage) =>
    ["reconcile", "worker-host-bootstrap"].includes(stage.key),
  );
  const owned = operated ? ownedRecoveryArgo(before, detail) : undefined;
  if (owned === undefined)
    await requireUnappliedWorkerHosts(context, pool, effects, before);
  else {
    requireLegacyWorkerCoverage(
      await effects.resources(selection.application, "Deployment"),
      pool,
    );
    verifyWorkerPoolPods(
      await effects.resources(selection.application, "Pod"),
      pool,
    );
  }
  const observed =
    operated || pool.workerOperation === "baseline"
      ? pool
      : {
          ...pool,
          versions: pool.versions.filter(
            (worker) =>
              worker.introducedByDeploymentId !== detail.deployment.id,
          ),
        };
  await effects.pollers(observed);
  const routes = await effects.routes(pool);
  if (JSON.stringify(routes) !== JSON.stringify(await effects.routes(pool)))
    throw new Error("Recovery routing changed during proof");
  requireStableRecoveryRoutes(pool, routes);
  const after = await effects.readArgo(application);
  StableArgo.parse(after);
  if (workerSourceFingerprint(before) !== workerSourceFingerprint(after))
    throw new Error("Application changed during recovery proof");
  if (
    owned !== undefined &&
    verifyArgoRelease(after, owned.expected, owned.request).operationId !==
      owned.receipt
  )
    throw new Error("Owned operation changed during recovery proof");
  const receipt = owned?.receipt ?? workflowId;
  return CompleteWorkerRecoverySchema.parse({
    expectedEnvironmentGeneration: context.intent.expectedEnvironmentGeneration,
    snapshotFingerprint: context.intent.snapshotFingerprint,
    poolFingerprint: context.intent.poolFingerprint,
    observedAt: now().toISOString(),
    routes,
    evidence: [
      ...jobs,
      {
        kind: "reconciliation",
        operationId: receipt,
        summary: `Independently settled failed release; source Workflow ${workflowId} closed, no acceptance inferred`,
      },
      {
        kind: "runtime",
        operationId: receipt,
        summary:
          "Exact live host digests, all served pollers, stable routing and unchanged Argo source verified twice",
      },
    ],
  });
}
