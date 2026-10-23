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
import {
  modelWorkerRecovery,
  requirePlannedRecoveryRoutes,
  requireUnsyncedModelSource,
  type ModelWorkerRecovery,
} from "./worker-recovery-model.ts";

export type WorkerRecoveryEffects = {
  workflowClosed: (deploymentId: string) => Promise<string>;
  /** The Application object as the API's own reader observed it (D5, I2). */
  readApplication: (path: string) => Promise<unknown>;
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
    sync: z.object({ status: z.enum(["Synced", "OutOfSync"]) }),
    health: z.object({ status: z.literal("Healthy") }),
    operationState: z.object({ phase: z.literal("Succeeded") }),
  }),
});

function recoverySync(raw: unknown, operated: boolean) {
  const sync = StableArgo.parse(raw).status.sync.status;
  if (operated && sync !== "Synced")
    throw new Error("Operated worker recovery requires a Synced Application");
  return sync;
}

function ownedRecoveryArgo(
  before: unknown,
  detail: WorkerRecoveryContext["deployment"],
  model: ModelWorkerRecovery | null,
) {
  // A model deployment's sync carries its request id over the frozen recipe's selection.
  const { selection, operationId } =
    model === null
      ? deliverySelection(detail)
      : { selection: model.selection(), operationId: model.requestId };
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
  const bootstrapId =
    model === null
      ? deliveryOperationId(`${detail.deployment.id}:worker-bootstrap`)
      : undefined;
  if (
    request === undefined ||
    (request !== operationId && request !== bootstrapId)
  )
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
  const allowBootstrapIntent = unappliedBootstrapIntent(detail, before);
  // Only read-only image inspection can precede source effect intent. Unknown stages fail closed.
  if (
    detail.stages.some(
      (stage) =>
        ![
          "worker-image-provenance",
          "preflight",
          "worker-baseline",
          "worker-prior-source",
        ].includes(stage.key) &&
        !(allowBootstrapIntent && stage.key === "worker-host-bootstrap"),
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
  await requireOriginalHosts(context, pool, effects, application);
}

/** No source sync reached the hosts: the original pool still serves, and the candidate nowhere. */
async function requireOriginalHosts(
  context: WorkerRecoveryContext,
  pool: WorkerPoolSnapshot,
  effects: WorkerRecoveryEffects,
  application: string,
) {
  const detail = context.deployment;
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

/** A recorded bootstrap intent is not proof that its source PATCH was accepted. */
function unappliedBootstrapIntent(
  detail: WorkerRecoveryContext["deployment"],
  before: unknown,
) {
  const bootstrap = detail.stages.filter(
    (stage) => stage.key === "worker-host-bootstrap",
  );
  const prior = detail.stages.find(
    (stage) => stage.key === "worker-prior-source",
  );
  return (
    detail.deployment.workerSnapshot?.workerOperation === "rollout" &&
    bootstrap.length === 1 &&
    bootstrap[0]?.status === "running" &&
    bootstrap[0].operationId ===
      deliveryOperationId(`${detail.deployment.id}:worker-bootstrap`) &&
    ["worker-prior-source", "worker-image-provenance", "preflight"].every(
      (key) =>
        detail.stages.filter(
          (stage) => stage.key === key && stage.status === "succeeded",
        ).length === 1,
    ) &&
    detail.stages.every((stage) =>
      [
        "worker-prior-source",
        "worker-image-provenance",
        "preflight",
        "worker-host-bootstrap",
      ].includes(stage.key),
    ) &&
    prior?.operationId === workerSourceFingerprint(before)
  );
}

async function recheckUnappliedBootstrap(
  context: WorkerRecoveryContext,
  pool: WorkerPoolSnapshot,
  effects: WorkerRecoveryEffects,
  observed: {
    application: unknown;
    pool: WorkerPoolSnapshot;
    workflowId: string;
    jobs: EvidenceInput[];
    routes: CompleteWorkerRecovery["routes"];
  },
) {
  await requireUnappliedWorkerHosts(
    context,
    pool,
    effects,
    observed.application,
  );
  await effects.pollers(observed.pool);
  if (
    (await effects.workflowClosed(context.deployment.deployment.id)) !==
      observed.workflowId ||
    JSON.stringify(await effects.terminalJobs(context)) !==
      JSON.stringify(observed.jobs) ||
    JSON.stringify(await effects.routes(pool)) !==
      JSON.stringify(observed.routes)
  )
    throw new Error("Unapplied bootstrap observations changed during proof");
  const final = await effects.readApplication(
    encodeURIComponent(
      deliverySelection(context.deployment).selection.application,
    ),
  );
  recoverySync(final, false);
  if (
    workerSourceFingerprint(final) !==
    workerSourceFingerprint(observed.application)
  )
    throw new Error("Application changed after unapplied bootstrap recheck");
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

/**
 * Which ownership the recorded stages prove, after checking the hosts that
 * classification implies: an owned sync, an unapplied or unsynced source,
 * or a v1 bootstrap intent.
 */
async function classifyRecovery(
  context: WorkerRecoveryContext,
  pool: WorkerPoolSnapshot,
  effects: WorkerRecoveryEffects,
  target: { model: ModelWorkerRecovery | null; name: string; before: unknown },
) {
  const { model, name, before } = target;
  const detail = context.deployment;
  const unappliedBootstrap =
    model === null && unappliedBootstrapIntent(detail, before);
  const operated =
    model?.synced ??
    (!unappliedBootstrap &&
      detail.stages.some((stage) =>
        ["reconcile", "worker-host-bootstrap"].includes(stage.key),
      ));
  recoverySync(before, operated);
  const owned = operated ? ownedRecoveryArgo(before, detail, model) : undefined;
  let source: "prior" | "written" = "prior";
  if (owned !== undefined) {
    requireLegacyWorkerCoverage(
      await effects.resources(name, "Deployment"),
      pool,
    );
    verifyWorkerPoolPods(await effects.resources(name, "Pod"), pool);
  } else if (model === null)
    await requireUnappliedWorkerHosts(context, pool, effects, before);
  else {
    source = requireUnsyncedModelSource(before, detail, model);
    await requireOriginalHosts(context, pool, effects, name);
  }
  return { unappliedBootstrap, operated, owned, source };
}

/** Stable routing to retained hosts, and to a model rollout's recorded plan. */
function requireRecoveryRoutes(
  pool: WorkerPoolSnapshot,
  routes: CompleteWorkerRecovery["routes"],
  plan: Parameters<typeof requirePlannedRecoveryRoutes>[0] | undefined,
) {
  requireStableRecoveryRoutes(pool, routes);
  if (plan !== undefined) requirePlannedRecoveryRoutes(plan, routes);
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
  // A model deployment is classified by its frozen recipe, a v1 one by its pipeline.
  const model = modelWorkerRecovery(detail);
  const name =
    model?.application ?? deliverySelection(detail).selection.application;
  const application = encodeURIComponent(name);
  const before = await effects.readApplication(application);
  const { unappliedBootstrap, operated, owned, source } =
    await classifyRecovery(context, pool, effects, { model, name, before });
  const beforeSync = recoverySync(before, operated);
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
  requireRecoveryRoutes(pool, routes, model?.plan);
  const after = await effects.readApplication(application);
  const afterSync = recoverySync(after, operated);
  if (workerSourceFingerprint(before) !== workerSourceFingerprint(after))
    throw new Error("Application changed during recovery proof");
  if (unappliedBootstrap) {
    await recheckUnappliedBootstrap(context, pool, effects, {
      application: after,
      pool: observed,
      workflowId,
      jobs,
      routes,
    });
  }
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
      ...(unappliedBootstrap
        ? [
            {
              kind: "reconciliation" as const,
              operationId: deliveryOperationId(
                `${detail.deployment.id}:worker-bootstrap`,
              ),
              summary:
                "Recorded bootstrap intent retained; unchanged original source, hosts, terminal jobs and stable routing independently verified without inferring a native operation",
            },
          ]
        : []),
      {
        kind: "reconciliation",
        operationId: receipt,
        summary: `Independently settled failed release; source Workflow ${workflowId} closed, Argo comparison ${beforeSync}/${afterSync}, no acceptance inferred${source === "written" ? "; the unsynced candidate body stays for the next deployment to replace" : ""}`,
      },
      {
        kind: "runtime",
        operationId: receipt,
        summary:
          "Exact live host digests, all served pollers, stable routing and unchanged Argo source verified",
      },
    ],
  });
}
