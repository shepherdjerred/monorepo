import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DeploymentDetailSchema,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { argoApplication } from "#lib/delivery/model/step-testing.ts";
import {
  deploymentSteps,
  stepRecipe,
  requireModelRecipe,
} from "#lib/delivery/model/recipe.ts";
import {
  definition,
  retiringStable,
  temporal,
} from "#lib/delivery/workers/model-worker-fixture.ts";
import type * as Activity from "@temporalio/activity";
import type * as ArgoClient from "#lib/delivery/argo-client.ts";
import type * as Argocd from "#activities/delivery/argocd.ts";
import type * as Stages from "./stages.ts";

/**
 * The model step iterator over a worker Application whose recipe also
 * activates a frontend archive, as Scout's does: every effect below the
 * steps is journaled, and each recorded stage lands on the deployment.
 */
const state = vi.hoisted(() => {
  const events: string[] = [];
  const reads: unknown[] = [];
  const current: unknown = undefined;
  return { events, reads, current };
});
vi.mock("@temporalio/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof Activity>()),
  Context: {
    current: () => ({
      cancellationSignal: new AbortController().signal,
      heartbeat: vi.fn(),
      info: { workflowExecution: { workflowId: "wf", runId: "run" } },
      log: { warn: vi.fn() },
    }),
  },
}));
vi.mock("./oci-chart.ts", async () => {
  const { frozenOciChart } =
    await import("#lib/delivery/model/step-testing.ts");
  return frozenOciChart;
});
vi.mock("./lease.ts", async () => {
  const { heldLease } = await import("#lib/delivery/model/step-testing.ts");
  return heldLease;
});
vi.mock("#lib/delivery/argo-client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof ArgoClient>()),
  getArgoApplication: () => Promise.resolve(state.reads.shift() ?? null),
  createArgoApplication: () => {
    state.events.push("write Application");
    return Promise.resolve();
  },
}));
vi.mock("#activities/delivery/argocd.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Argocd>()),
  argoRequest: () => Promise.resolve(null),
  runGuardedArgoCommand: (args: string[]) => {
    state.events.push(args[0] ?? "");
    return Promise.resolve();
  },
}));
function settle(key: string, status: string) {
  const current = DeploymentDetailSchema.parse(state.current);
  const stages = current.stages.filter((stage) => stage.key !== key);
  state.current = DeploymentDetailSchema.parse({
    ...current,
    stages: [
      ...stages,
      {
        id: `stage/${key}`,
        deploymentId: current.deployment.id,
        key,
        status,
        operationId: `op-${key}`,
        message: "",
        startedAt: current.deployment.createdAt,
        updatedAt: current.deployment.createdAt,
      },
    ],
  });
}
vi.mock("./stages.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Stages>()),
  recordStage: (_current: unknown, key: string, status: string) => {
    state.events.push(`${key} ${status}`);
    settle(key, status);
    return Promise.resolve();
  },
  requireOwned: () => Promise.resolve(state.current),
  deploymentDetail: () => Promise.resolve(state.current),
}));
// A retirement never activates its recipe's frontend archive.
vi.mock("./static-site.ts", () => ({
  runStaticSiteStep: (_current: unknown, _policy: unknown, key: string) => {
    state.events.push(`activate ${key}`);
    return Promise.resolve();
  },
}));
vi.mock("#lib/delivery/client.ts", () => ({
  deliveryRequest: (path: string) => {
    state.events.push(`delivery ${path.split("/").at(-1) ?? ""}`);
    return Promise.resolve(state.current);
  },
}));
vi.mock("#activities/delivery/workers/worker-claim.ts", () => ({
  workerRetirementClaim: () => {
    state.events.push("prove drainage");
    return Promise.resolve({ proofs: [] });
  },
}));
vi.mock("#activities/delivery/workers/worker-rollout.ts", () => ({
  inspectDeliveryWorkerImages: () => {
    state.events.push("inspect images");
    settle("worker-image-provenance", "succeeded");
    return Promise.resolve();
  },
  prepareDeliveryWorker: () => {
    state.events.push("worker preflight");
    return Promise.reject(new Error("the fixture records no routing plan"));
  },
  stepDeliveryWorker: () => {
    state.events.push("worker step");
    return Promise.resolve();
  },
}));
vi.mock("#activities/delivery/workers/worker-bootstrap.ts", () => ({
  requireLiveRoutingCoverage: () => {
    state.events.push("routing");
    return Promise.resolve();
  },
}));
vi.mock("#activities/delivery/workers/worker-hosts.ts", () => ({
  verifyWorkerHosts: () => {
    state.events.push("hosts");
    return Promise.resolve();
  },
}));
vi.mock("#lib/delivery/workers/worker-hosts.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  workerApplicationResources: () => Promise.resolve([]),
}));

const { acceptDeliveryModel, planDeliveryModel, runDeliveryModelStep } =
  await import("./steps.ts");

/** temporal/prod's worker recipe with a frontend step, its chart by OCI tag. */
function withSite(current: DeploymentDetail): DeploymentDetail {
  const chart = current.versionSet.components["chart:temporal"];
  if (chart === undefined) throw new Error("The fixture has no chart");
  return DeploymentDetailSchema.parse({
    ...current,
    pipeline: {
      ...current.pipeline,
      definition: {
        ...definition,
        steps: [
          ...definition.steps,
          {
            kind: "static-site",
            instance: "bucket:temporal-site",
            policy: {
              archiveComponent: "archive:temporal-site",
              bucket: "temporal-site",
              verification: {
                url: "https://temporal.sjer.red/",
                expectedStatus: 200,
              },
            },
          },
        ],
      },
    },
    versionSet: {
      ...current.versionSet,
      components: {
        ...current.versionSet.components,
        "chart:temporal": { ...chart, uri: "oci://registry.example/temporal" },
      },
    },
  });
}

const keys = (current: DeploymentDetail) =>
  deploymentSteps(current).map((step) => step.key);

const claimed = [{ key: "worker-prior-source", status: "succeeded" as const }];

/** The worker Application before and after this deployment's owned sync. */
function application(current: DeploymentDetail, synced: boolean) {
  const recipe = stepRecipe(requireModelRecipe(current), "step-sync");
  if (recipe.kind !== "kubernetes-application")
    throw new Error("The worker recipe is a Kubernetes application");
  return argoApplication(current, recipe, synced);
}

beforeEach(() => {
  state.events = [];
  state.reads = [];
});

describe("a model-recipe retire-host deployment (E5)", () => {
  test("runs only the worker Application's steps; a rollout keeps every frozen step", () => {
    expect(keys(retiringStable(withSite(temporal([]))))).toEqual([
      "step-apply-safety",
      "step-sync",
      "step-worker-rollout",
    ]);
    expect(keys(withSite(temporal([])))).toEqual([
      "step-apply-safety",
      "step-sync",
      "step-worker-rollout",
      "step-static-site",
    ]);
  });

  test("re-proves drainage before each effect, scales the host away and is accepted", async () => {
    const retirement = retiringStable(withSite(temporal(claimed)));
    state.current = retirement;
    // Apply-safety creates the body; the sync reads it, then reads back.
    state.reads = [
      null,
      application(retirement, false),
      application(retirement, true),
    ];
    const plan = await planDeliveryModel(retirement.deployment.id);
    expect(plan.resumeAt).toBe(0);
    for (const key of plan.keys.slice(plan.resumeAt))
      expect(await runDeliveryModelStep(retirement.deployment.id, key)).toEqual(
        { waiting: false },
      );
    const evidence = await acceptDeliveryModel(retirement.deployment.id);
    expect(evidence.at(-1)?.kind).toBe("acceptance");
    expect(state.events).toEqual([
      // Apply-safety: images and routes, then a fresh drainage proof the
      // server validates before the body is written.
      "inspect images",
      "routing",
      "prove drainage",
      "delivery claim",
      "step-apply-safety running",
      "write Application",
      "assert-apply-safe",
      "step-apply-safety succeeded",
      // Sync: another fresh proof immediately before the scale-down.
      "prove drainage",
      "delivery claim",
      "step-sync running",
      "sync-managed",
      "step-sync succeeded",
      // The worker step routes nothing; it proves the hosts and routes.
      "step-worker-rollout running",
      "hosts",
      "routing",
      "step-worker-rollout succeeded",
    ]);
    // The sync rendered exactly the retiring host at zero replicas; Helm's
    // strvals separators are escaped in the parameter.
    const synced = application(retirement, true).spec.source;
    const pool = synced.helm?.parameters?.find(
      (parameter) => parameter.name === "delivery.workerPool",
    );
    expect(
      JSON.parse(
        (pool?.value ?? "{}").replaceAll(/\\([\\{},])/gu, "$1"),
      ) as unknown,
    ).toMatchObject({
      workerOperation: "retire",
      versions: [{ replicas: 0 }, { replicas: 1 }],
    });
  });

  test("a frontend step is never part of a retirement", async () => {
    state.current = retiringStable(withSite(temporal(claimed)));
    await expect(
      runDeliveryModelStep("deployment/1", "step-static-site"),
    ).rejects.toThrow(/not part of the frozen recipe/u);
    expect(state.events).toEqual([]);
  });

  test("a rollout pool still takes the rollout path", async () => {
    const rollout = withSite(temporal(claimed));
    state.current = rollout;
    state.reads = [null];
    await runDeliveryModelStep(rollout.deployment.id, "step-apply-safety");
    expect(state.events).not.toContain("prove drainage");
    settle("step-sync", "succeeded");
    await expect(
      runDeliveryModelStep(rollout.deployment.id, "step-worker-rollout"),
    ).rejects.toThrow(/routing plan/u);
    expect(state.events.slice(-3)).toEqual([
      "step-worker-rollout running",
      "hosts",
      "worker preflight",
    ]);
  });
});
