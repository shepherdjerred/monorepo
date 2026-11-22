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
  retiringStable,
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
  input: {
    request: string;
    source?: unknown;
    sync?: "Synced" | "OutOfSync";
    resources?: unknown[];
  },
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
      ...(input.resources === undefined ? {} : { resources: input.resources }),
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
  observed: {
    application: unknown;
    hosts: string[];
    prod: string;
    beta?: string;
    forbidCandidateReferencesCheck?: boolean;
    onPollers?: (buildIds: string[]) => void;
  },
): WorkerRecoveryEffects {
  const pool = detail.deployment.workerSnapshot;
  if (pool === null) throw new Error("Fixture has no worker pool");
  return {
    workflowClosed: () => Promise.resolve("delivery/deployment/1/closed-run"),
    readApplication: () => Promise.resolve(observed.application),
    terminalJobs: () => Promise.resolve([]),
    resources: (_application, kind) =>
      Promise.resolve(
        kind === "Deployment"
          ? []
          : pool.versions
              .filter((worker) => observed.hosts.includes(worker.buildId))
              .map((worker) =>
                retainedWorkerPod({
                  ...worker,
                  runtimeDigests: [worker.digest],
                }),
              ),
      ),
    pollers: (requested) => {
      expect(requested.target).toBe("central");
      observed.onPollers?.(
        requested.versions
          .filter((worker) => worker.replicas === 1)
          .map((worker) => worker.buildId),
      );
      return Promise.resolve();
    },
    routes: (requested) =>
      Promise.resolve(
        (requested.versions[0]?.host.routes ?? []).map((route) => ({
          ...route,
          currentBuildId:
            route.namespace === "prod"
              ? observed.prod
              : (observed.beta ?? STABLE),
          rampingBuildId: null,
          routingConflictToken: `${route.namespace}-token`,
        })),
      ),
    noCandidateReferences: (requested) => {
      if (observed.forbidCandidateReferencesCheck === true) {
        return Promise.reject(
          new Error(
            "Unapplied candidate has routing or open execution references",
          ),
        );
      }
      expect(requested.candidateBuildId).toBe(CANDIDATE);
      return Promise.resolve();
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

/** Recorded through the sync request, with nothing after it. */
const stoppedInSync: Stages = [
  { key: "worker-prior-source", status: "succeeded" },
  { key: "worker-image-provenance", status: "succeeded" },
  { key: "step-apply-safety", status: "succeeded" },
  { key: "step-sync", status: "running" },
];

function unsyncedFixture(
  introduced: boolean,
  transform: (base: DeploymentDetail) => DeploymentDetail,
) {
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
  const detail = transform(failed(stages, [], { introduced }));
  const recipe = stepRecipeOf(detail.pipeline.definition, "worker-rollout");
  if (recipe === null) throw new Error("Fixture lacks its worker recipe");
  const written = application(detail, {
    request: "earlier-request",
    source: renderApplication(detail, recipe).body.spec.source,
    sync: "OutOfSync",
  });
  return { prior, detail, written };
}

/** The worker Application Argo left: this request's sync Failed, the rendered body in place. */
function failedSync(
  detail: DeploymentDetail,
  overrides: { request?: string; source?: unknown } = {},
) {
  const recipe = stepRecipeOf(detail.pipeline.definition, "worker-rollout");
  if (recipe === null) throw new Error("Fixture lacks its worker recipe");
  const observed = application(detail, {
    request: overrides.request ?? REQUEST,
    source:
      overrides.source ?? renderApplication(detail, recipe).body.spec.source,
    sync: "OutOfSync",
  });
  return {
    ...observed,
    status: {
      ...observed.status,
      health: { status: "Degraded" },
      operationState: {
        ...observed.status.operationState,
        phase: "Failed",
      },
    },
  };
}

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
    const { prior, detail, written } = unsyncedFixture(true, (base) => base);
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

describe("an owned sync that failed before any routing step", () => {
  test("settles when routing never reached the unrouted, unreferenced candidate", async () => {
    const detail = failed(stoppedInSync, [], { introduced: true });
    const proof = await proveSettledWorkerRecovery(
      context(detail),
      boundary(detail, {
        application: failedSync(detail),
        hosts: [STABLE, CANDIDATE],
        prod: STABLE,
      }),
    );
    expect(proof.evidence).toContainEqual(
      expect.objectContaining({
        kind: "reconciliation",
        operationId: OPERATION,
        summary: expect.stringContaining("failed before any routing step"),
      }),
    );
    expect(proof.routes.map((route) => route.currentBuildId)).toEqual([
      STABLE,
      STABLE,
    ]);
  });

  test("a succeeded operation that left a real OutOfSync settles without acceptance when the candidate is unrouted", async () => {
    const detail = failed(stoppedInSync, [], { introduced: true });
    const failedApplication = failedSync(detail);
    const proof = await proveSettledWorkerRecovery(
      context(detail),
      boundary(detail, {
        application: {
          ...failedApplication,
          status: {
            ...failedApplication.status,
            health: { status: "Healthy" },
            resources: [
              {
                kind: "Deployment",
                name: "retained-host",
                status: "OutOfSync",
              },
            ],
            operationState: {
              ...failedApplication.status.operationState,
              phase: "Succeeded",
            },
          },
        },
        hosts: [STABLE, CANDIDATE],
        prod: STABLE,
      }),
    );
    expect(proof.evidence).toContainEqual(
      expect.objectContaining({
        kind: "reconciliation",
        operationId: OPERATION,
        summary: expect.stringContaining("finished without acceptance"),
      }),
    );
    expect(proof.routes.map((route) => route.currentBuildId)).toEqual([
      STABLE,
      STABLE,
    ]);
  });

  test("a routed candidate, another request, or a changed body fails closed", async () => {
    const detail = failed(stoppedInSync, [], { introduced: true });
    await expect(
      proveSettledWorkerRecovery(
        context(detail),
        boundary(detail, {
          application: failedSync(detail),
          hosts: [STABLE, CANDIDATE],
          prod: CANDIDATE,
        }),
      ),
    ).rejects.toThrow(/candidate owns current routing/u);
    await expect(
      proveSettledWorkerRecovery(
        context(detail),
        boundary(detail, {
          application: failedSync(detail, { request: "another-request" }),
          hosts: [STABLE],
          prod: STABLE,
        }),
      ),
    ).rejects.toThrow(/not owned by this frozen deployment/u);
    await expect(
      proveSettledWorkerRecovery(
        context(detail),
        boundary(detail, {
          application: failedSync(detail, {
            source: {
              ...application(detail, { request: REQUEST }).spec.source,
              targetRevision: "0.0.0-another-release",
            },
          }),
          hosts: [STABLE],
          prod: STABLE,
        }),
      ),
    ).rejects.toThrow(/no longer holds the body/u);
  });

  test("a retained host that stopped serving fails closed", async () => {
    const detail = failed(stoppedInSync, [], { introduced: true });
    await expect(
      proveSettledWorkerRecovery(
        context(detail),
        boundary(detail, {
          application: failedSync(detail),
          hosts: [CANDIDATE],
          prod: STABLE,
        }),
      ),
    ).rejects.toThrow(/no live host/u);
  });

  test("a stage after the sync keeps the strict owned-sync proof", async () => {
    const detail = failed(
      [...stoppedInSync, { key: "worker-preflight", status: "running" }],
      [],
      { introduced: true },
    );
    await expect(
      proveSettledWorkerRecovery(
        context(detail),
        boundary(detail, {
          application: failedSync(detail),
          hosts: [STABLE, CANDIDATE],
          prod: STABLE,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("retire-host worker recovery", () => {
  test("an unsynced retire-host settles while candidateBuildId owns active routing and retiringWorkerId remains live", async () => {
    const { prior, detail, written } = unsyncedFixture(false, (base) =>
      retiringStable(base),
    );

    const polledBuilds: string[][] = [];
    const priorProof = await proveSettledWorkerRecovery(
      context(detail),
      boundary(detail, {
        application: prior,
        hosts: [STABLE, CANDIDATE],
        prod: CANDIDATE,
        beta: CANDIDATE,
        forbidCandidateReferencesCheck: true,
        onPollers: (builds) => {
          polledBuilds.push(builds);
        },
      }),
    );
    expect(priorProof.routes.map((route) => route.currentBuildId)).toEqual([
      CANDIDATE,
      CANDIDATE,
    ]);
    expect(polledBuilds).toEqual([[STABLE, CANDIDATE]]);

    const writtenProof = await proveSettledWorkerRecovery(
      context(detail),
      boundary(detail, {
        application: written,
        hosts: [STABLE, CANDIDATE],
        prod: CANDIDATE,
        beta: CANDIDATE,
        forbidCandidateReferencesCheck: true,
      }),
    );
    expect(
      writtenProof.evidence.some((entry) =>
        entry.summary.includes("unsynced candidate body"),
      ),
    ).toBe(true);

    // Before sync, the unretired host must still be running.
    await expect(
      proveSettledWorkerRecovery(
        context(detail),
        boundary(detail, {
          application: prior,
          hosts: [CANDIDATE],
          prod: CANDIDATE,
          beta: CANDIDATE,
          forbidCandidateReferencesCheck: true,
        }),
      ),
    ).rejects.toThrow(/no live host/u);
  });

  test("a failed-sync retire-host settles while candidateBuildId keeps active routing", async () => {
    const detail = retiringStable(failed(stoppedInSync, []));
    const polledBuilds: string[][] = [];
    const proof = await proveSettledWorkerRecovery(
      context(detail),
      boundary(detail, {
        application: failedSync(detail),
        hosts: [CANDIDATE],
        prod: CANDIDATE,
        beta: CANDIDATE,
        forbidCandidateReferencesCheck: true,
        onPollers: (builds) => {
          polledBuilds.push(builds);
        },
      }),
    );
    expect(proof.routes.map((route) => route.currentBuildId)).toEqual([
      CANDIDATE,
      CANDIDATE,
    ]);
    expect(polledBuilds).toEqual([[CANDIDATE]]);
  });

  test("operated rollout and retire-host settle when OutOfSync resources only await pruning, and fail closed otherwise (AI-792)", async () => {
    const pruneOnlyResources = [
      { kind: "Deployment", status: "Synced" },
      {
        group: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: "temporal-worker-ingress-reader",
        status: "OutOfSync",
        requiresPruning: true,
      },
      {
        group: "apps",
        kind: "Deployment",
        namespace: "temporal",
        name: "temporal-delivery-wf-retained-000e10e1eec2",
        status: "OutOfSync",
        requiresPruning: true,
      },
    ];

    const rolloutDetail = failed(midRollout, [plan()]);
    const rolloutProof = await proveSettledWorkerRecovery(
      context(rolloutDetail),
      boundary(rolloutDetail, {
        application: application(rolloutDetail, {
          request: REQUEST,
          sync: "OutOfSync",
          resources: pruneOnlyResources,
        }),
        hosts: [STABLE, CANDIDATE],
        prod: CANDIDATE,
      }),
    );
    expect(rolloutProof.evidence).toContainEqual(
      expect.objectContaining({
        kind: "reconciliation",
        operationId: OPERATION,
        summary: expect.stringContaining("Argo comparison OutOfSync/OutOfSync"),
      }),
    );

    const retireDetail = retiringStable(failed(stoppedInSync, []));
    const retireProof = await proveSettledWorkerRecovery(
      context(retireDetail),
      boundary(retireDetail, {
        application: application(retireDetail, {
          request: REQUEST,
          sync: "OutOfSync",
          resources: pruneOnlyResources,
        }),
        hosts: [CANDIDATE],
        prod: CANDIDATE,
        beta: CANDIDATE,
        forbidCandidateReferencesCheck: true,
      }),
    );
    expect(retireProof.evidence).toContainEqual(
      expect.objectContaining({
        kind: "reconciliation",
        operationId: OPERATION,
        summary: expect.stringContaining("Argo comparison OutOfSync/OutOfSync"),
      }),
    );

    for (const resources of [
      undefined,
      [],
      [{ kind: "Deployment", status: "Synced" }],
      [
        ...pruneOnlyResources,
        { kind: "Deployment", status: "OutOfSync", requiresPruning: false },
      ],
      [...pruneOnlyResources, { kind: "Deployment", status: "OutOfSync" }],
    ]) {
      await expect(
        proveSettledWorkerRecovery(
          context(retireDetail),
          boundary(retireDetail, {
            application: application(retireDetail, {
              request: REQUEST,
              sync: "OutOfSync",
              ...(resources === undefined ? {} : { resources }),
            }),
            hosts: [CANDIDATE],
            prod: CANDIDATE,
            beta: CANDIDATE,
            forbidCandidateReferencesCheck: true,
          }),
        ),
      ).rejects.toThrow(
        "Operated worker recovery requires a Synced Application",
      );
    }
  });
});
