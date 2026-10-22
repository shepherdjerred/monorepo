import { describe, expect, test } from "vitest";
import {
  DeploymentDetailSchema,
  WorkerRecoveryContextSchema,
  type DeploymentDetail,
  type WorkerRolloutPlan,
} from "@shepherdjerred/delivery/contract";
import { stepRecipeOf } from "@shepherdjerred/delivery/model-contract";
import { deliveryArgoParameters } from "homelab/scripts/argocd/argocd-delivery.ts";
import { renderApplication } from "#lib/delivery/model/application.ts";
import { modelWorkerChartSelection } from "#lib/delivery/model/worker-selection.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { timestamp } from "#lib/delivery/model/testing.ts";
import { retainedWorkerPod } from "./worker-fixtures.ts";
import {
  CANDIDATE,
  PLAN,
  STABLE,
  definition,
  temporal,
} from "#lib/delivery/workers/model-worker-fixture.ts";
import { workerPlanEvidence } from "#lib/delivery/workers/worker-plan.ts";
import { workerSourceFingerprint } from "#lib/delivery/workers/worker-source.ts";
import {
  proveSettledWorkerRecovery,
  type WorkerRecoveryEffects,
} from "#lib/delivery/workers/worker-recovery.ts";

const OPERATION = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
const REQUEST = deliveryOperationId("deployment/1");
type Stages = Parameters<typeof temporal>[0];

/** The recorded plan as the worker preflight stage's evidence. */
function plan(input: WorkerRolloutPlan = PLAN) {
  return {
    ...workerPlanEvidence(input, "op-worker-preflight"),
    id: "deployment/1/stage/worker-preflight/0",
    deploymentId: "deployment/1",
    operationId: "op-worker-preflight",
    createdAt: timestamp,
  };
}

/** A failed, quarantined model worker deployment of `recipe`. */
function failed(
  stages: Stages,
  evidence: unknown[],
  options: { recipe?: unknown; introduced?: boolean } = {},
): DeploymentDetail {
  const base = temporal(stages, evidence);
  const pool = base.deployment.workerSnapshot;
  if (pool === null) throw new Error("Fixture has no worker pool");
  return DeploymentDetailSchema.parse({
    ...base,
    pipeline: { ...base.pipeline, definition: options.recipe ?? definition },
    deployment: {
      ...base.deployment,
      status: "failed",
      recoveryRequired: true,
      workerSnapshot: {
        ...pool,
        versions: pool.versions.map((worker) =>
          worker.buildId === CANDIDATE && options.introduced === true
            ? { ...worker, introducedByDeploymentId: "deployment/1" }
            : worker,
        ),
      },
    },
    environment: {
      ...base.environment,
      activeDeploymentId: base.deployment.id,
    },
  });
}

function context(detail: DeploymentDetail) {
  const pool = detail.deployment.workerSnapshot;
  if (pool === null) throw new Error("Fixture has no worker pool");
  return WorkerRecoveryContextSchema.parse({
    intent: {
      id: "worker/1",
      deploymentId: detail.deployment.id,
      requestedBy: "admin",
      reason: "Inspect the model worker rollout the executor left",
      expectedEnvironmentGeneration: detail.environment.generation,
      snapshotFingerprint: "a".repeat(64),
      poolFingerprint: "b".repeat(64),
      status: "pending",
      workflowId: "delivery-worker-recovery/worker/1",
      submittedAt: null,
      message: null,
      createdAt: timestamp,
      finishedAt: null,
    },
    deployment: detail,
    pool: {
      environmentId: "temporal/prod",
      generation: 0,
      versions: pool.versions,
    },
  });
}

/** The worker Application as Argo left it: synced by `request`, or holding `source`. */
function application(
  detail: DeploymentDetail,
  input: { request: string; source?: unknown; sync?: "Synced" | "OutOfSync" },
) {
  const { selection } = modelWorkerChartSelection(detail);
  const synced = {
    repoURL: selection.repository,
    chart: selection.chart,
    targetRevision: selection.revision,
    helm: { parameters: deliveryArgoParameters(selection.parameters) },
  };
  return {
    metadata: {
      uid: "application-1",
      annotations: {
        "delivery.shepherdjerred.com/environment": "temporal/prod",
      },
    },
    spec: {
      source: input.source ?? synced,
      destination: { namespace: "temporal" },
    },
    status: {
      sync: { status: input.sync ?? "Synced", revision: selection.revision },
      health: { status: "Healthy" },
      operationState: {
        phase: "Succeeded",
        finishedAt: timestamp,
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: input.request },
            { name: "ci.sjer.red/operation-id", value: OPERATION },
          ],
        },
        syncResult: { revision: selection.revision },
      },
      history: [{ id: 1, revision: selection.revision, source: synced }],
    },
  };
}

/** Read-only boundary: the Application, worker Pods, and routing per namespace. */
function boundary(
  detail: DeploymentDetail,
  observed: { application: unknown; hosts: string[]; prod: string },
): WorkerRecoveryEffects {
  const pool = detail.deployment.workerSnapshot;
  if (pool === null) throw new Error("Fixture has no worker pool");
  return {
    workflowClosed: async () => "delivery/deployment/1/closed-run",
    readApplication: async () => observed.application,
    terminalJobs: async () => [],
    resources: async (_application, kind) =>
      kind === "Deployment"
        ? []
        : pool.versions
            .filter((worker) => observed.hosts.includes(worker.buildId))
            .map((worker) =>
              retainedWorkerPod({ ...worker, runtimeDigests: [worker.digest] }),
            ),
    pollers: async (requested) => {
      expect(requested.target).toBe("central");
    },
    routes: async (requested) =>
      (requested.versions[0]?.host.routes ?? []).map((route) => ({
        ...route,
        currentBuildId: route.namespace === "prod" ? observed.prod : STABLE,
        rampingBuildId: null,
        routingConflictToken: `${route.namespace}-token`,
      })),
    noCandidateReferences: async (requested) => {
      expect(requested.candidateBuildId).toBe(CANDIDATE);
    },
  };
}

/** A compound deployment's stages: the companion first, the worker's steps under `sub2-`. */
function prefixed(stages: Stages, companionSync: "running" | "succeeded") {
  return [
    { key: "sub1-step-apply-safety", status: "succeeded" as const },
    { key: "sub1-step-sync", status: companionSync },
    ...stages.map((stage) =>
      stage.key.startsWith("step-")
        ? { ...stage, key: `sub2-${stage.key}` }
        : stage,
    ),
  ];
}

/** Synced and planned, stopped after promote and before verify. */
const midRollout: Stages = [
  { key: "worker-prior-source", status: "succeeded" },
  { key: "worker-image-provenance", status: "succeeded" },
  { key: "step-apply-safety", status: "succeeded" },
  { key: "step-sync", status: "succeeded" },
  { key: "step-worker-rollout", status: "running" },
  { key: "worker-preflight", status: "succeeded" },
  { key: "worker-promote", status: "succeeded" },
];

describe("model worker recovery (T3, E5)", () => {
  test("a deployment stopped mid-step-worker-rollout settles by its frozen selection and recorded plan", async () => {
    const detail = failed(midRollout, [plan()]);
    const proof = await proveSettledWorkerRecovery(
      context(detail),
      boundary(detail, {
        application: application(detail, { request: REQUEST }),
        hosts: [STABLE, CANDIDATE],
        prod: CANDIDATE,
      }),
    );
    expect(proof.evidence).toContainEqual(
      expect.objectContaining({
        kind: "reconciliation",
        operationId: OPERATION,
      }),
    );
    expect(proof.routes.map((route) => route.currentBuildId)).toEqual([
      CANDIDATE,
      STABLE,
    ]);
  });

  test("routing that left the recorded plan, or a sync another request made, fails closed", async () => {
    const detail = failed(midRollout, [
      plan({ ...PLAN, expectedCurrentBuildId: CANDIDATE }),
    ]);
    await expect(
      proveSettledWorkerRecovery(
        context(detail),
        boundary(detail, {
          application: application(detail, { request: REQUEST }),
          hosts: [STABLE, CANDIDATE],
          prod: STABLE,
        }),
      ),
    ).rejects.toThrow(/left the recorded plan/u);
    const foreign = failed(midRollout, [plan()]);
    await expect(
      proveSettledWorkerRecovery(
        context(foreign),
        boundary(foreign, {
          application: application(foreign, { request: "another-request" }),
          hosts: [STABLE, CANDIDATE],
          prod: CANDIDATE,
        }),
      ),
    ).rejects.toThrow(/not owned by this frozen deployment/u);
  });

  test("an unknown stage, or an unsettled step of another sub-recipe, fails closed", async () => {
    const unknown = failed(
      [...midRollout, { key: "step-mystery", status: "running" }],
      [plan()],
    );
    const observed = {
      application: application(unknown, { request: REQUEST }),
      hosts: [STABLE, CANDIDATE],
      prod: CANDIDATE,
    };
    await expect(
      proveSettledWorkerRecovery(context(unknown), boundary(unknown, observed)),
    ).rejects.toThrow(/cannot classify stage step-mystery/u);
    const companion = {
      ...definition,
      application: { ...definition.application, name: "temporal-companion" },
      steps: definition.steps.slice(0, 2).map((step) => ({
        ...step,
        instance: "application:temporal-companion",
      })),
    };
    const compound = {
      kind: "compound",
      subRecipes: [
        { instance: "application:temporal-companion", definition: companion },
        { instance: "application:temporal", definition },
      ],
    };
    const settled = failed(prefixed(midRollout, "succeeded"), [plan()], {
      recipe: compound,
    });
    await expect(
      proveSettledWorkerRecovery(
        context(settled),
        boundary(settled, {
          application: application(settled, { request: REQUEST }),
          hosts: [STABLE, CANDIDATE],
          prod: CANDIDATE,
        }),
      ),
    ).resolves.toMatchObject({ routes: expect.any(Array) });
    const companionRunning = failed(prefixed(midRollout, "running"), [plan()], {
      recipe: compound,
    });
    await expect(
      proveSettledWorkerRecovery(
        context(companionRunning),
        boundary(companionRunning, observed),
      ),
    ).rejects.toThrow(/sub1-step-sync of another sub-recipe is unsettled/u);
  });

  test("an unsynced apply-safety leaves the original hosts; a sync request that reached the Application without a recorded step fails closed", async () => {
    const prior = application(failed([], []), { request: "earlier-request" });
    const stages: Stages = [
      {
        key: "worker-prior-source",
        status: "succeeded",
        operationId: workerSourceFingerprint(prior),
      },
      { key: "worker-image-provenance", status: "succeeded" },
      { key: "step-apply-safety", status: "running" },
    ];
    const detail = failed(stages, [], { introduced: true });
    const recipe = stepRecipeOf(detail.pipeline.definition, "worker-rollout");
    if (recipe === null) throw new Error("Fixture lacks its worker recipe");
    const written = application(detail, {
      request: "earlier-request",
      source: renderApplication(detail, recipe).body.spec.source,
      sync: "OutOfSync",
    });
    const proof = await proveSettledWorkerRecovery(
      context(detail),
      boundary(detail, { application: written, hosts: [STABLE], prod: STABLE }),
    );
    expect(
      proof.evidence.some((entry) =>
        entry.summary.includes("unsynced candidate body"),
      ),
    ).toBe(true);
    // The original source, untouched, settles the same way.
    await expect(
      proveSettledWorkerRecovery(
        context(detail),
        boundary(detail, { application: prior, hosts: [STABLE], prod: STABLE }),
      ),
    ).resolves.toMatchObject({ routes: expect.any(Array) });
    await expect(
      proveSettledWorkerRecovery(
        context(detail),
        boundary(detail, {
          application: {
            ...written,
            status: application(detail, { request: REQUEST, sync: "OutOfSync" })
              .status,
          },
          hosts: [STABLE],
          prod: STABLE,
        }),
      ),
    ).rejects.toThrow(/sync request reached the worker Application/u);
  });
});
