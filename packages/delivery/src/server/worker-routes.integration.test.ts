import { beforeEach, expect, test } from "vitest";
import { createApp } from "./app.ts";
import { createDeliveryClient } from "#shared/client.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { workerFixture, freshWorkerProof } from "#testing/worker-fixture.ts";
import type { Principal } from "#shared/contract.ts";
import { testOperator } from "#testing/seed.ts";

const context = useDeliveryFixture();
let workers: Awaited<ReturnType<typeof workerFixture>>;
let app: ReturnType<typeof createApp>;
let writes = true;
const principals: Record<string, Principal> = {
  admin: { id: "fixture-admin", kind: "machine", scopes: ["read", "admin"] },
  deployer: {
    id: "fixture-deployer",
    kind: "machine",
    scopes: ["read", "deploy"],
  },
  executor: {
    id: "fixture-executor",
    kind: "machine",
    scopes: ["read", "execute"],
  },
  publisher: {
    id: "fixture-publisher",
    kind: "machine",
    scopes: ["read", "publish"],
  },
};
beforeEach(async () => {
  writes = true;
  workers = await workerFixture(context.delivery);
  app = createApp({
    delivery: context.delivery,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    peerAddress: () => "127.0.0.1",
    qualifyBuild: async () => "verified",
    config: {
      publicOrigin: "http://delivery.test",
      writesEnabled: async () => writes,
      enabledEnvironments: async () => [workers.environmentId],
      operatorLogins: async () => [],
      trustedProxyAddresses: async () => [],
      machineCredentials: Object.entries(principals).map(
        ([token, principal]) => ({ token: `fixture-${token}`, principal }),
      ),
    },
  });
});
function client(role: string) {
  return createDeliveryClient({
    baseUrl: "http://delivery.test",
    headers: { Authorization: `Bearer fixture-${role}` },
    fetch: async (input, init) => app.request(input, init),
  });
}
function post(path: string, role: string, body: unknown) {
  return app.request(`/api/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer fixture-${role}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("worker reads are authenticated, adoption is admin-only, and arbitrary host specs are rejected", async () => {
  const a = await workers.acceptedRelease(1);
  const state = await client("publisher").workers(workers.environmentId);
  const input = {
    requestId: "api-adopt",
    environmentId: state.environmentId,
    expectedGeneration: state.generation,
    artifactId: a.artifactId,
    introducedByDeploymentId: a.deployment.id,
    target: workers.target,
  };
  await expect(client("deployer").registerWorker(input)).rejects.toMatchObject({
    status: 403,
  });
  const invalid = await post("/workers", "admin", {
    ...input,
    host: { command: ["arbitrary-command"] },
  });
  expect(invalid.status).toBe(400);
  const adopted = await client("admin").registerWorker(input);
  expect(adopted.artifactId).toBe(a.artifactId);
  const anonymous = await app.request(
    `/api/v1/environments/${encodeURIComponent(workers.environmentId)}/workers`,
    {
      headers: { "tailscale-user-login": "operator@example.com" },
    },
  );
  expect(anonymous.status).toBe(401);
});

test("retirement intent freezes selection, accepts no caller proof, and never grants execution scope", async () => {
  const { workerA, workerB } = await workers.acceptedPool();
  const state = await client("deployer").workers(workers.environmentId);
  const input = {
    requestId: "api-retire",
    expectedEnvironmentGeneration: state.generation,
    expectedWorkerGeneration: workerA.generation,
  };
  const fabricated = await post(
    `/workers/${encodeURIComponent(workerA.id)}/retire`,
    "deployer",
    { ...input, ...freshWorkerProof(workerA, workerB.buildId) },
  );
  expect(fabricated.status).toBe(400);
  await expect(
    client("publisher").retireWorker(workerA.id, input),
  ).rejects.toMatchObject({ status: 403 });
  const selected = await client("deployer").retireWorker(workerA.id, input);
  const repeat = await client("deployer").retireWorker(workerA.id, input);
  expect(repeat).toEqual(selected);
  const path = `/deployments/${encodeURIComponent(selected.id)}/claim`;
  const forbiddenClaim = await post(
    path,
    "deployer",
    freshWorkerProof(workerA, workerB.buildId),
  );
  expect(forbiddenClaim.status).toBe(403);
  const missingProof = await post(path, "executor", {});
  expect(missingProof.status).toBe(400);
  const claimed = await post(
    path,
    "executor",
    freshWorkerProof(workerA, workerB.buildId),
  );
  expect(claimed.status).toBe(200);
  const repeatedMissingProof = await post(path, "executor", {});
  expect(repeatedMissingProof.status).toBe(400);
  const beforeAcceptance = await client("deployer").workers(
    workers.environmentId,
  );
  expect(
    beforeAcceptance.versions.find((row) => row.id === workerA.id)?.replicas,
  ).toBe(1);
  expect(
    await context.cluster.database.applicationLock.count({
      where: { deploymentId: selected.id },
    }),
  ).toBe(1);
});

test("paused writes stop retirement intent while preserving read-only pool inspection", async () => {
  const { workerA, env } = await workers.acceptedPool();
  writes = false;
  const state = await client("deployer").workers(workers.environmentId);
  expect(state.generation).toBe(env.generation);
  await expect(
    client("deployer").retireWorker(workerA.id, {
      requestId: "paused-retirement",
      expectedEnvironmentGeneration: state.generation,
      expectedWorkerGeneration: workerA.generation,
    }),
  ).rejects.toMatchObject({ status: 503, code: "PAUSED" });
  expect(
    await context.cluster.database.deployment.count({
      where: { kind: "retire-worker" },
    }),
  ).toBe(0);
});

test("host-only baseline intent requires admin authority and preserves source artifact identity through HTTP", async () => {
  const release = await workers.requestedRelease(1);
  await context.delivery.cancel(release.deployment.id, testOperator);
  await client("admin").registerPipeline(
    workers.workerPipeline.id,
    workers.workerPipeline.definition,
  );
  await client("admin").registerEnvironment({
    id: workers.environmentId,
    serviceId: "temporal",
    name: "prod",
    application: "temporal",
    pipelineRevisionId: workers.workerPipeline.id,
    configurationRevision: "worker-baseline/1",
    configuration: {},
    automatic: false,
  });
  const state = await client("admin").workers(workers.environmentId);
  const input = {
    requestId: "api-baseline",
    environmentId: workers.environmentId,
    versionSetRevisionId: release.version.id,
    expectedGeneration: state.generation,
    kind: "adopt-worker" as const,
    workerBaseline: {
      artifactIds: [release.artifactId],
      candidateArtifactId: release.artifactId,
    },
  };
  await expect(
    client("deployer").createDeployment(input),
  ).rejects.toMatchObject({ status: 403 });
  const selected = await client("admin").createDeployment(input);
  expect(selected.workerSnapshot).toMatchObject({
    workerOperation: "baseline",
    versions: [
      expect.objectContaining({
        artifactId: release.artifactId,
        introducedByDeploymentId: selected.id,
      }),
    ],
  });
  expect(await context.cluster.database.workerVersion.count()).toBe(0);
  const detail = await context.delivery.detail(selected.id);
  expect(detail.environment.acceptedVersionSetRevisionId).toBeNull();
});
