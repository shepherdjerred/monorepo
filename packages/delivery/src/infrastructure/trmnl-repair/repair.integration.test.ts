import { expect, test } from "vitest";
import {
  ServiceIndex,
  SERVICE_CATALOG,
} from "@shepherdjerred/ops-model/catalog.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { deliveryWorkflowId, type TrmnlRepairClaim } from "#shared/contract.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { createTestApp } from "#testing/http-app.ts";
import { DeploymentDetailSchema, DeploymentSchema } from "#shared/contract.ts";

const context = useDeliveryFixture();
async function quarantined() {
  const delivery = new Delivery(
    context.cluster.database,
    1,
    new ServiceIndex({
      ...SERVICE_CATALOG,
      deliveryDelegations: {
        ...SERVICE_CATALOG.deliveryDelegations,
        "trmnl-dashboard": "trmnl-dashboard/prod",
      },
    }),
  );
  const build = await delivery.publish(
    {
      requestId: "trmnl/build",
      serviceId: "trmnl-dashboard",
      sourceRevision: "e".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/90",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "trmnl/image",
          component: "image:trmnl-dashboard",
          kind: "image",
          uri: "docker.io/shepherdjerred/trmnl-dashboard",
          digest: `sha256:${"a".repeat(64)}`,
          version: "2.0.0-90",
        },
        {
          id: "trmnl/chart",
          component: "chart:trmnl-dashboard",
          kind: "chart",
          uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/trmnl-dashboard-2.0.0-90.tgz",
          digest: `sha256:${"b".repeat(64)}`,
          version: "2.0.0-90",
        },
        {
          id: "trmnl/plugins",
          component: "archive:trmnl-plugins",
          kind: "archive",
          uri: `s3://delivery-artifacts/trmnl-plugins/${"c".repeat(64)}.json`,
          digest: `sha256:${"c".repeat(64)}`,
          version: "2.0.0-90",
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 90 },
  );
  await delivery.qualify(build.buildId, "verified", testExecutor);
  const [selected] = await delivery.versions("trmnl-dashboard");
  if (selected === undefined)
    throw new Error("Expected qualified TRMNL version");
  await delivery.registerPipeline(
    "trmnl/pipeline",
    {
      kind: "argocd",
      application: "trmnl-dashboard",
      namespace: "trmnl-dashboard",
      chartName: "trmnl-dashboard",
      chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
      chartComponent: "chart:trmnl-dashboard",
      parameters: {},
      artifactParameters: { "delivery.image": "image:trmnl-dashboard" },
      trmnlPlugins: { archiveComponent: "archive:trmnl-plugins" },
    },
    testOperator,
  );
  await delivery.registerEnvironment(
    {
      id: "trmnl-dashboard/prod",
      serviceId: "trmnl-dashboard",
      name: "prod",
      application: "trmnl-dashboard",
      pipelineRevisionId: "trmnl/pipeline",
      configurationRevision: "trmnl/config",
      configuration: {},
      automatic: true,
    },
    testOperator,
  );
  const source = await delivery.createDeployment(
    {
      requestId: "trmnl/release",
      environmentId: "trmnl-dashboard/prod",
      versionSetRevisionId: selected.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );
  await delivery.claim(source.id, testExecutor);
  await delivery.finish(
    source.id,
    {
      status: "failed",
      message: "Plugin 2 write lost its response",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  return { delivery, source, selected };
}
function proof(sourceId: string, generation: number): TrmnlRepairClaim {
  return {
    expectedEnvironmentGeneration: generation,
    observedAt: new Date().toISOString(),
    sourceWorkflow: {
      workflowId: deliveryWorkflowId(sourceId),
      status: "FAILED",
    },
  };
}
const reason =
  "Repair the same immutable plugin bundle after independently closing the original executor";
test("repair intent is immutable, admin-only, and does not transfer quarantine before fresh proof", async () => {
  const { delivery, source } = await quarantined();
  const input = {
    requestId: "repair/1",
    expectedEnvironmentGeneration: 1,
    reason,
  };
  await expect(
    delivery.requestTrmnlRepair(source.id, input, testPublisher),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const repair = await delivery.requestTrmnlRepair(
    source.id,
    input,
    testOperator,
  );
  expect(
    await delivery.requestTrmnlRepair(source.id, input, testOperator),
  ).toEqual(repair);
  await expect(
    delivery.requestTrmnlRepair(
      source.id,
      { ...input, reason: `${reason} changed` },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const original = await delivery.detail(source.id);
  expect(original.environment.activeDeploymentId).toBe(source.id);
  await expect(delivery.claim(repair.id, testExecutor)).rejects.toMatchObject({
    code: "INVALID",
  });
  await expect(
    delivery.claim(repair.id, testExecutor, {
      ...proof(source.id, 1),
      observedAt: new Date(Date.now() - 61_000).toISOString(),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    delivery.claim(repair.id, testExecutor, proof("foreign", 1)),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    delivery.requestTrmnlRepair(
      source.id,
      { ...input, requestId: "repair/duplicate" },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
test("proof-bound transfer and exact remote acceptance repair dependencies without accepting the application", async () => {
  const { delivery, source, selected } = await quarantined();
  const repair = await delivery.requestTrmnlRepair(
    source.id,
    { requestId: "repair/success", expectedEnvironmentGeneration: 1, reason },
    testOperator,
  );
  const frozen = await delivery.claim(
    repair.id,
    testExecutor,
    proof(source.id, 1),
  );
  expect(frozen.environment).toMatchObject({
    activeDeploymentId: repair.id,
    generation: 2,
    acceptedVersionSetRevisionId: null,
  });
  expect(frozen.deployment).toMatchObject({
    repairOfDeploymentId: source.id,
    versionSetRevisionId: selected.id,
    pipelineRevisionId: source.pipelineRevisionId,
  });
  const original = await delivery.detail(source.id);
  expect(original.deployment).toMatchObject({
    status: "failed",
    message: "Plugin 2 write lost its response",
    recoveryRequired: false,
  });
  await expect(
    delivery.claim(repair.id, testExecutor, proof(source.id, 1)),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await delivery.claim(repair.id, testExecutor, proof(source.id, 2));
  await expect(
    delivery.finish(
      repair.id,
      {
        status: "failed",
        message: "Still ambiguous",
        recoveryRequired: false,
        evidence: [],
      },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
  const evidence = [
    {
      kind: "reconciliation" as const,
      summary: "Existing backend source independently verified",
    },
    { kind: "acceptance" as const, summary: "Dependency readback verified" },
  ];
  await expect(
    delivery.finish(
      repair.id,
      {
        status: "succeeded",
        message: "Unproven",
        recoveryRequired: false,
        evidence,
      },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
  const operationId = deliveryOperationId(`${repair.id}:trmnl-plugins`);
  await delivery.stage(
    repair.id,
    {
      key: "trmnl-plugins",
      operationId,
      status: "succeeded",
      message: "All three fixed plugins read back",
      evidence: [
        {
          kind: "acceptance",
          operationId,
          summary: JSON.stringify({
            adapter: "trmnl-plugins",
            archiveArtifactId: "trmnl/plugins",
            archiveDigest: `sha256:${"c".repeat(64)}`,
            versionSetRevisionId: selected.id,
            pluginCount: 3,
          }),
        },
      ],
    },
    testExecutor,
  );
  await delivery.finish(
    repair.id,
    {
      status: "succeeded",
      message: "Repaired exact frozen dependency bundle",
      recoveryRequired: false,
      evidence,
    },
    testExecutor,
  );
  const finished = await delivery.detail(repair.id);
  expect(finished.environment).toMatchObject({
    activeDeploymentId: null,
    acceptedVersionSetRevisionId: null,
    observedVersionSetRevisionId: null,
  });
  expect(
    await context.cluster.database.applicationLock.count({
      where: { application: "trmnl-dashboard" },
    }),
  ).toBe(0);
  expect(
    await delivery.reconcile(["trmnl-dashboard/prod"], testExecutor),
  ).toEqual({ deployments: [] });
});
test("failed repair retains the transferred lock and supports a new identity-bound repair", async () => {
  const { delivery, source } = await quarantined();
  const repair = await delivery.requestTrmnlRepair(
    source.id,
    { requestId: "repair/fail", expectedEnvironmentGeneration: 1, reason },
    testOperator,
  );
  await delivery.claim(repair.id, testExecutor, proof(source.id, 1));
  await delivery.finish(
    repair.id,
    {
      status: "failed",
      message: "Remote target remains uncertain",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const failed = await delivery.detail(repair.id);
  expect(failed.environment.activeDeploymentId).toBe(repair.id);
  const successor = await delivery.requestTrmnlRepair(
    repair.id,
    { requestId: "repair/successor", expectedEnvironmentGeneration: 2, reason },
    testOperator,
  );
  await delivery.claim(successor.id, testExecutor, proof(repair.id, 2));
  const retried = await delivery.detail(successor.id);
  expect(retried.environment.activeDeploymentId).toBe(successor.id);
});
test("real HTTP repair admission separates admin and executor authority and parses strict repeat claim proofs", async () => {
  const { delivery, source } = await quarantined();
  const admin = {
    ...testOperator,
    kind: "machine" as const,
    scopes: ["admin" as const],
  };
  const app = createTestApp(delivery, {
    machineCredentials: [
      { token: "a".repeat(32), principal: admin },
      { token: "e".repeat(32), principal: testExecutor },
      { token: "p".repeat(32), principal: testPublisher },
    ],
    writesEnabled: () => Promise.resolve(true),
    enabledEnvironments: () => Promise.resolve(["trmnl-dashboard/prod"]),
  });
  const submit = (path: string, body: unknown, credential: string) =>
    app.request(`http://delivery.test/api/v1${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.repeat(32)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const input = {
    requestId: "repair/http",
    expectedEnvironmentGeneration: 1,
    reason,
  };
  const denied = await submit(
    `/deployments/${source.id}/trmnl-repair`,
    input,
    "p",
  );
  expect(denied.status).toBe(403);
  const response = await submit(
    `/deployments/${source.id}/trmnl-repair`,
    input,
    "a",
  );
  expect(response.status).toBe(201);
  const repair = DeploymentSchema.parse(await response.json());
  const noProof = await submit(`/deployments/${repair.id}/claim`, {}, "e");
  expect(noProof.status).toBe(400);
  const claimed = await submit(
    `/deployments/${repair.id}/claim`,
    proof(source.id, 1),
    "e",
  );
  expect(claimed.status).toBe(200);
  expect(
    DeploymentDetailSchema.parse(await claimed.json()).environment.generation,
  ).toBe(2);
  const repeated = await submit(
    `/deployments/${repair.id}/claim`,
    proof(source.id, 2),
    "e",
  );
  expect(repeated.status).toBe(200);
});
