import { beforeEach, expect, test } from "vitest";
import { createApp } from "./app.ts";
import { createDeliveryClient } from "#shared/client.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { workerFixture, freshWorkerProof } from "#testing/worker-fixture.ts";
import {
  fixturePrincipals,
  testExecutor,
  testOperator,
} from "#testing/seed.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";

const context = useDeliveryFixture();
let workers: Awaited<ReturnType<typeof workerFixture>>;
let app: ReturnType<typeof createApp>;
let writes = true;
const principals = fixturePrincipals;
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
    await context.cluster.database.targetLock.count({
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
      where: { kind: "retire-host" },
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
  const rollout = {
    requestId: "api-worker-rollout",
    environmentId: workers.environmentId,
    versionSetRevisionId: release.version.id,
    expectedGeneration: state.generation,
    kind: "deploy" as const,
  };
  await expect(
    client("deployer").createDeployment(rollout),
  ).rejects.toMatchObject({
    status: 400,
    code: "INVALID",
  });
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
  await context.delivery.claim(selected.id, testExecutor);
  const evidence = [
    {
      kind: "reconciliation" as const,
      summary: "Exact independent native host observations",
    },
    {
      kind: "acceptance" as const,
      summary: "Exact original host image, poller and routing observations",
    },
  ];
  await expect(
    client("deployer").createDeployment({
      ...rollout,
      requestId: "api-unverified-baseline",
    }),
  ).rejects.toMatchObject({
    status: 400,
    code: "INVALID",
  });
  const result = {
    status: "succeeded",
    message: "Independently verified baseline",
    recoveryRequired: false,
    evidence,
  };
  const baselineStage = await post(
    `/deployments/${selected.id}/stages`,
    "executor",
    {
      key: "worker-baseline",
      status: "succeeded",
      operationId: deliveryOperationId(`${selected.id}:worker-baseline`),
      message: "Independent original host readback fixture",
      evidence,
    },
  );
  expect(baselineStage.status).toBe(200);
  // Even qualified images require both native image and captured-source proof.
  for (const key of ["worker-image-provenance", "worker-prior-source"]) {
    const refused = await post(
      `/deployments/${selected.id}/finish`,
      "executor",
      result,
    );
    expect(refused.status).toBe(409);
    expect(await context.cluster.database.workerVersion.count()).toBe(0);
    expect(
      await context.cluster.database.environment.findUniqueOrThrow({
        where: { id: workers.environmentId },
      }),
    ).toMatchObject({ activeDeploymentId: selected.id });
    expect(
      await context.cluster.database.deployment.findUniqueOrThrow({
        where: { id: selected.id },
      }),
    ).toMatchObject({ status: "running" });
    const proof = await post(`/deployments/${selected.id}/stages`, "executor", {
      key,
      operationId: deliveryOperationId(`${selected.id}:${key}`),
      status: "succeeded",
      message: "Independent native proof fixture",
      evidence,
    });
    expect(proof.status).toBe(200);
  }
  const finished = await post(
    `/deployments/${selected.id}/finish`,
    "executor",
    result,
  );
  expect(finished.status).toBe(200);
  const accepted = await client("deployer").workers(workers.environmentId);
  const stageIdentity = {
    deploymentId_key: { deploymentId: selected.id, key: "worker-baseline" },
  };
  await context.cluster.database.stage.update({
    where: stageIdentity,
    data: {
      operationId: deliveryOperationId("different-deployment:worker-baseline"),
    },
  });
  await expect(
    client("deployer").createDeployment({
      ...rollout,
      requestId: "api-foreign-baseline-proof",
      expectedGeneration: accepted.generation,
    }),
  ).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
  await context.cluster.database.stage.update({
    where: stageIdentity,
    data: {
      operationId: deliveryOperationId(`${selected.id}:worker-baseline`),
    },
  });
  const next = await client("deployer").createDeployment({
    ...rollout,
    expectedGeneration: accepted.generation,
  });
  expect(next.workerSnapshot).toMatchObject({
    workerOperation: "rollout",
    versions: accepted.versions,
  });
});

async function scoutWorkerPromotion() {
  const beta = await workerFixture(context.delivery, "scout-beta");
  const prod = await workerFixture(context.delivery, "scout-prod");
  const db = context.cluster.database;

  // Accept two releases in scout-beta so workerA is eligible for retirement.
  const { b, workerA, workerB } = await beta.acceptedPool();
  await db.deployment.update({
    where: { id: workerB.introducedByDeploymentId },
    data: { monitorState: "settled", monitorSettledAt: new Date() },
  });

  // Request an approved worker promotion without claiming it.
  await db.environment.update({
    where: { id: prod.environmentId },
    data: { promotionSourceEnvironmentId: beta.environmentId },
  });
  const prodEnv = await db.environment.findUniqueOrThrow({
    where: { id: prod.environmentId },
  });
  const prodRollout = await context.delivery.createDeployment(
    {
      requestId: "scout-prod/rollout",
      environmentId: prod.environmentId,
      expectedGeneration: prodEnv.generation,
      kind: "promote",
      sourceEnvironmentId: beta.environmentId,
    },
    testOperator,
  );
  await context.delivery.approve(
    prodRollout.id,
    { decision: "approve", reason: "Approved scout-prod promotion" },
    testOperator,
  );
  await prod.freeze({ ...b, deployment: prodRollout });
  await prod.frozenRecipe(prodRollout.id);
  return { beta, prodRollout, workerA, workerB };
}

async function claimScoutBetaRetirement(
  input: Awaited<ReturnType<typeof scoutWorkerPromotion>>,
) {
  const { beta, workerA, workerB } = input;
  const betaPool = await context.delivery.workers(
    beta.environmentId,
    testOperator,
  );
  const retirement = await context.delivery.retireWorker(
    workerA.id,
    {
      requestId: "scout-beta/retire-during-prod",
      expectedEnvironmentGeneration: betaPool.generation,
      expectedWorkerGeneration: workerA.generation,
    },
    testOperator,
  );
  const claimedRetire = await context.delivery.claim(
    retirement.id,
    testExecutor,
    freshWorkerProof(workerA, workerB.buildId),
  );
  expect(claimedRetire.deployment.status).toBe("running");
  return retirement;
}

test("a queued scout-beta worker rollout waits while scout-prod's worker rollout is running, while retire-host stays unblocked (AI-857)", async () => {
  const promotion = await scoutWorkerPromotion();
  const { beta, prodRollout } = promotion;
  await context.delivery.claim(prodRollout.id, testExecutor);

  const retirement = await claimScoutBetaRetirement(promotion);
  await context.delivery.stage(
    retirement.id,
    {
      key: "worker-retire",
      status: "succeeded",
      operationId: deliveryOperationId(`${retirement.id}:worker-retire`),
      message: "Retired drained host",
      evidence: [
        { kind: "reconciliation", summary: "scaled down" },
        { kind: "acceptance", summary: "drained" },
      ],
    },
    testExecutor,
  );
  await context.delivery.finish(
    retirement.id,
    {
      status: "succeeded",
      message: "Retired workerA",
      recoveryRequired: false,
      observedRevisionId: retirement.versionSetRevisionId,
      evidence: [
        { kind: "reconciliation", summary: "scaled down" },
        { kind: "acceptance", summary: "drained" },
      ],
    },
    testExecutor,
  );

  // 2. Queued scout-beta worker rollout answers BUSY while scout-prod rollout is running.
  const nextBeta = await beta.requestedFrozenRelease(3);
  await expect(
    context.delivery.claim(nextBeta.deployment.id, testExecutor),
  ).rejects.toMatchObject({
    code: "BUSY",
    message: expect.stringMatching(/scout-for-lol\/prod/u),
  });

  // 3. Once scout-prod finishes, scout-beta claims immediately.
  await context.delivery.finish(
    prodRollout.id,
    {
      status: "failed",
      message: "Finished prod rollout",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
  const claimedBeta = await context.delivery.claim(
    nextBeta.deployment.id,
    testExecutor,
  );
  expect(claimedBeta.deployment.status).toBe("running");
});

async function expectUnclaimed(id: string, status: string) {
  const detail = await context.delivery.detail(id);
  expect(detail.deployment.status).toBe(status);
  expect(detail.deployment.startedAt).toBeNull();
  expect(detail.environment.activeDeploymentId).toBeNull();
  expect(
    await context.cluster.database.targetLock.count({
      where: { deploymentId: id },
    }),
  ).toBe(0);
}

test.each(["advanced", "refused", "recovery-required"] as const)(
  "a queued Scout promotion waits for beta's claimed worker wave (%s)",
  async (settlement) => {
    const { beta, prodRollout } = await scoutWorkerPromotion();
    const nextBeta = await beta.requestedFrozenRelease(3);
    const betaId = nextBeta.deployment.id;
    await context.delivery.claim(betaId, testExecutor);

    function claimProd() {
      return context.delivery.claim(prodRollout.id, testExecutor);
    }
    const contention = {
      code: "BUSY",
      message: expect.stringContaining(betaId),
    };
    await expect(claimProd()).rejects.toMatchObject(contention);
    await expectUnclaimed(prodRollout.id, "queued");

    if (settlement === "advanced") {
      await context.delivery.finish(
        betaId,
        {
          status: "succeeded",
          message: "Accepted the next beta worker wave",
          observedRevisionId: nextBeta.versionSet.id,
          recoveryRequired: false,
          evidence: [
            { kind: "reconciliation", summary: "Beta selection applied" },
            { kind: "acceptance", summary: "Beta worker accepted" },
          ],
        },
        testExecutor,
      );
      await expect(claimProd()).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringMatching(/stale.*\(M2\)/u),
      });
      await expectUnclaimed(prodRollout.id, "failed");
      return;
    }

    await context.delivery.finish(
      betaId,
      {
        status: "failed",
        message: "The beta worker wave failed",
        recoveryRequired: settlement === "recovery-required",
        evidence: [],
      },
      testExecutor,
    );
    if (settlement === "recovery-required") {
      await expect(claimProd()).rejects.toMatchObject(contention);
      await expectUnclaimed(prodRollout.id, "queued");
    } else {
      const claimed = await claimProd();
      expect(claimed.deployment.status).toBe("running");
    }
  },
);

test("a claimed same-set beta host retirement leaves Scout prod eligible", async () => {
  const promotion = await scoutWorkerPromotion();
  await claimScoutBetaRetirement(promotion);
  const claimed = await context.delivery.claim(
    promotion.prodRollout.id,
    testExecutor,
  );
  expect(claimed.deployment.status).toBe("running");
});

test.each(["queued", "running"] as const)(
  "a catalog change preserves the frozen source safety of a %s worker promotion",
  async (status) => {
    const { beta, prodRollout } = await scoutWorkerPromotion();
    if (status === "running")
      await context.delivery.claim(prodRollout.id, testExecutor);
    await context.cluster.database.environment.update({
      where: { id: prodRollout.environmentId },
      data: { promotionSourceEnvironmentId: null },
    });

    if (status === "queued") {
      await expect(
        context.delivery.claim(prodRollout.id, testExecutor),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringMatching(/no longer promotes from.*\(M2\)/u),
      });
      await expectUnclaimed(prodRollout.id, "failed");
      return;
    }

    const nextBeta = await beta.requestedFrozenRelease(3);
    await expect(
      context.delivery.claim(nextBeta.deployment.id, testExecutor),
    ).rejects.toMatchObject({
      code: "BUSY",
      message: expect.stringContaining(prodRollout.id),
    });
    await expectUnclaimed(nextBeta.deployment.id, "queued");
  },
);

test("workerFixture seeds revisioned pipeline and configuration IDs accepted by the selection route (AI-817)", async () => {
  const scout = await workerFixture(context.delivery, "scout-prod");
  await scout.acceptedPool();
  await workers.requestedBaseline();
  for (const environmentId of [workers.environmentId, scout.environmentId]) {
    const response = await app.request(
      `/api/v1/environments/${encodeURIComponent(environmentId)}/selection`,
      { headers: { Authorization: "Bearer fixture-deployer" } },
    );
    expect(response.status, environmentId).toBe(200);
  }
});
