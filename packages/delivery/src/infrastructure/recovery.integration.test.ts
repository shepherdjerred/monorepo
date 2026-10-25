import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { seedDelivery, testExecutor, testOperator } from "#testing/seed.ts";
import { Delivery } from "./delivery.ts";
import { createRecoveryInspector } from "./recovery.ts";
import { createApplicationReader } from "./kubernetes/application-reader.ts";
import type { DeploymentDetail } from "#shared/contract.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { arcadePipeline } from "#testing/model-fixture.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const externalOperationId = "22222222-2222-4222-8222-222222222222";
const recovery = {
  operationId: externalOperationId,
  reason:
    "Inspected the recorded operation directly while Temporal was unavailable",
};
function observation(phase = "Failed") {
  return {
    metadata: {
      name: "arcade",
      resourceVersion: "12345",
      annotations: { "delivery.shepherdjerred.com/environment": "arcade/prod" },
    },
    status: {
      operationState: {
        phase,
        finishedAt: "2026-10-16T00:00:00.000Z",
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: requestId },
            { name: "ci.sjer.red/operation-id", value: externalOperationId },
          ],
        },
      },
      resources: [{ kind: "Deployment", health: { status: "Progressing" } }],
    },
  };
}
async function checkMinecraftRecovery(detail: DeploymentDetail) {
  const selected = structuredClone(detail);
  if (selected.pipeline.definition.kind !== "argocd")
    throw new Error("Expected an Argo pipeline");
  selected.pipeline.definition.application = "minecraft-tsmc";
  selected.environment.id = "minecraft/tsmc";
  const current = observation();
  current.metadata.name = "minecraft-tsmc";
  current.metadata.annotations["delivery.shepherdjerred.com/environment"] =
    "minecraft/tsmc";
  const inspect = createRecoveryInspector({
    readApplication: async () => current,
  });
  selected.pipeline.definition.minecraftUpgrade = {
    imageComponent: "image:the-storm-server",
    runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
    releaseMode: "retained-volume-restart",
  };
  expect(await inspect(selected, recovery)).toHaveLength(1);
  await expect(
    inspect(selected, { ...recovery, operationId: requestId }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  current.status.operationState.phase = "Running";
  await expect(inspect(selected, recovery)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  current.status.operationState.phase = "Failed";
  selected.pipeline.definition.minecraftUpgrade.releaseMode =
    "verified-restore";
  expect(await inspect(selected, recovery)).toHaveLength(1);
  delete selected.pipeline.definition.minecraftUpgrade.releaseMode;
  expect(await inspect(selected, recovery)).toHaveLength(1);
}

/** A model recipe's request is its sync step: `step-sync`, or `subN-step-sync` inside a compound recipe. */
async function checkModelSyncStage(detail: DeploymentDetail) {
  const application = recipeFromPipeline(arcadePipeline);
  const compound = RecipeDefinitionSchema.parse({
    kind: "compound",
    subRecipes: [
      {
        instance: "channel:npm/@shepherdjerred/webring",
        definition: {
          kind: "channel",
          store: "npm",
          name: "@shepherdjerred/webring",
          pointer: "latest",
          forwardOnly: false,
          artifactComponent: "archive:webring-package",
        },
      },
      { instance: "application:arcade", definition: application },
    ],
  });
  const reconcile = detail.stages.find((stage) => stage.key === "reconcile");
  if (reconcile === undefined) throw new Error("Expected the v1 stage");
  const inspect = createRecoveryInspector({
    readApplication: async () => observation(),
  });
  for (const [definition, key] of [
    [application, "step-sync"],
    [compound, "sub2-step-sync"],
  ] as const) {
    const selected: DeploymentDetail = {
      ...detail,
      pipeline: { ...detail.pipeline, definition },
      stages: [{ ...reconcile, key }],
    };
    expect(await inspect(selected, recovery)).toHaveLength(1);
    // A model recipe never records the v1 stage name.
    await expect(
      inspect({ ...selected, stages: [reconcile] }, recovery),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }
}

describe("independent Argo recovery", () => {
  let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
  let delivery: Delivery;
  let detail: DeploymentDetail;
  beforeAll(async () => {
    cluster = await createTestDatabase();
    delivery = new Delivery(cluster.database);
    const fixture = await seedDelivery(delivery);
    const deployment = await delivery.createDeployment(
      {
        requestId: "recovery/1",
        environmentId: fixture.environment.id,
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: 0,
        kind: "deploy",
      },
      testOperator,
    );
    await delivery.claim(deployment.id, testExecutor);
    await delivery.stage(
      deployment.id,
      {
        key: "reconcile",
        status: "running",
        operationId: requestId,
        message: "Submitted exact owned release",
        evidence: [],
      },
      testExecutor,
    );
    await delivery.finish(
      deployment.id,
      {
        status: "failed",
        message: "Lost operation response",
        recoveryRequired: true,
        evidence: [],
      },
      testExecutor,
    );
    detail = await delivery.detail(deployment.id);
  }, 60_000);
  afterAll(async () => {
    await cluster.close();
  });
  test("reads the Application through the projected reader and never uses Temporal", async () => {
    const read = createApplicationReader(() =>
      Promise.reject(new Error("token file missing")),
    );
    await expect(
      createRecoveryInspector({ readApplication: read })(detail, recovery),
    ).rejects.toMatchObject({ code: "PAUSED" });
    await expect(
      createRecoveryInspector({ readApplication: async () => null })(
        detail,
        recovery,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const paths: string[] = [];
    const reader = createApplicationReader(async (path) => {
      paths.push(path);
      return observation();
    });
    expect(
      await createRecoveryInspector({ readApplication: reader })(
        detail,
        recovery,
      ),
    ).toHaveLength(1);
    expect(paths).toEqual([
      "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/arcade",
    ]);
  });
  test("only explicit retained-volume Minecraft restarts use ordinary owned Argo recovery", async () => {
    await checkMinecraftRecovery(detail);
  });
  test("dependency-configured Argo targets cannot unlock without independent exact plugin readback", async () => {
    const selected: DeploymentDetail = {
      ...detail,
      pipeline: {
        ...detail.pipeline,
        definition: {
          kind: "argocd",
          application: "arcade",
          chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
          chartName: "arcade",
          chartComponent: "chart",
          namespace: "arcade",
          parameters: {},
          artifactParameters: {},
          trmnlPlugins: { archiveComponent: "archive:trmnl-plugins" },
        },
      },
    };
    const options = {
      readApplication: () => Promise.resolve(observation()),
    };
    await expect(
      createRecoveryInspector(options)(selected, recovery),
    ).rejects.toMatchObject({ code: "PAUSED" });
    await expect(
      createRecoveryInspector({
        ...options,
        inspectTrmnl: () => Promise.reject(new Error("Plugin bytes differ")),
      })(selected, recovery),
    ).rejects.toThrow("Plugin bytes differ");
    const pluginEvidence = {
      kind: "runtime" as const,
      summary: "Exact fixed three-plugin archive independently observed",
    };
    expect(
      await createRecoveryInspector({
        ...options,
        inspectTrmnl: () => Promise.resolve([pluginEvidence]),
      })(selected, recovery),
    ).toContainEqual(pluginEvidence);
  });
  test.each(["Running", "Terminating"])(
    "keeps ownership for %s operations",
    async (phase) => {
      const inspect = createRecoveryInspector({
        readApplication: async () => observation(phase),
      });
      await expect(inspect(detail, recovery)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    },
  );
  test("rejects a different external operation or environment delegation", async () => {
    const inspect = createRecoveryInspector({
      readApplication: async () => observation(),
    });
    await expect(
      inspect(detail, {
        ...recovery,
        operationId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const other = observation();
    other.metadata.annotations["delivery.shepherdjerred.com/environment"] =
      "other/environment";
    await expect(
      createRecoveryInspector({
        readApplication: async () => other,
      })(detail, recovery),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  test("rejects an unfinished Job even after Argo stops waiting", async () => {
    const current = observation();
    current.status.resources = [
      { kind: "Job", health: { status: "Progressing" } },
    ];
    const inspect = createRecoveryInspector({
      readApplication: async () => current,
    });
    await expect(inspect(detail, recovery)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  test("a model recipe's sync step, prefixed inside a compound recipe, names the recorded request (T3)", async () => {
    await checkModelSyncStage(detail);
  });
  test("stores exact independent readback before releasing only the owned lock", async () => {
    const inspect = createRecoveryInspector({
      readApplication: async (name) => {
        expect(name).toBe("arcade");
        return observation();
      },
    });
    const evidence = await inspect(detail, recovery);
    const intent = await delivery.requestRecoveryIntent(
      detail.deployment.id,
      {
        requestId: "readback-recovery",
        reason: recovery.reason,
        expectedGeneration: detail.environment.generation,
      },
      testOperator,
    );
    await delivery.settleArgoIntent(
      intent.id,
      recovery.reason,
      testOperator,
      evidence,
    );
    const recovered = await delivery.detail(detail.deployment.id);
    expect(recovered.deployment.recoveryRequired).toBe(false);
    expect(recovered.environment.activeDeploymentId).toBeNull();
    expect(
      recovered.evidence.some(
        (entry) =>
          entry.operationId === externalOperationId &&
          entry.summary.includes("resourceVersion 12345"),
      ),
    ).toBe(true);
  });
});
