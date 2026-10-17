import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import {
  seedDelivery,
  testExecutor,
  testOperator,
  testPublisher,
} from "#testing/seed.ts";
import { createApp } from "#server/app.ts";
import { DeliveryError } from "#domain/error.ts";
import { Delivery } from "./delivery.ts";

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let delivery: Delivery;
let fixture: Awaited<ReturnType<typeof seedDelivery>>;
beforeAll(async () => {
  cluster = await createTestDatabase();
  delivery = new Delivery(cluster.database);
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

describe("exact rollback and promotion retries", () => {
  test("rollback restores the accepted pipeline and configuration despite newer environment settings", async () => {
    const baseline = await select(fixture.versionSet.id);
    await accept(baseline.id, fixture.versionSet.id);
    await delivery.registerPipeline(
      "arcade/2",
      {
        kind: "argocd",
        application: "arcade",
        chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
        chartName: "arcade",
        chartComponent: "chart",
        namespace: "arcade",
        parameters: { mode: "new" },
        artifactParameters: { "image.ref": "server" },
      },
      testOperator,
    );
    const updated = await delivery.registerEnvironment(
      {
        id: fixture.environment.id,
        serviceId: "arcade",
        name: "prod",
        application: "arcade",
        pipelineRevisionId: "arcade/2",
        configurationRevision: "config/2",
        configuration: { setting: "new" },
        automatic: true,
      },
      testOperator,
    );
    const rollback = await delivery.createDeployment(
      {
        requestId: "restore-accepted-snapshot",
        environmentId: updated.id,
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: updated.generation,
        kind: "rollback",
      },
      testOperator,
    );
    expect(rollback).toMatchObject({
      pipelineRevisionId: "arcade/1",
      configurationRevision: "config/1",
      configuration: {},
      expectedGeneration: updated.generation,
    });
    const claimed = await delivery.claim(rollback.id, testExecutor);
    expect(claimed.pipeline.id).toBe("arcade/1");
    expect(claimed.environment).toMatchObject({
      pipelineRevisionId: "arcade/1",
      configurationRevision: "config/1",
      configuration: {},
    });
    await accept(rollback.id, fixture.versionSet.id);
  });
  test("HTTP retry retains a failed promotion's exact source environment", async () => {
    const baseline = await select(fixture.versionSet.id);
    await accept(baseline.id, fixture.versionSet.id);
    await delivery.registerPipeline(
      "arcade/promoted-site",
      {
        kind: "static-site",
        bucket: "arcade-promotion",
        archiveComponent: "site:arcade-promotion",
        immutablePrefixes: [],
        extraExcludes: [],
        entrypoints: ["index.html"],
        verification: { url: "https://arcade.sjer.red", expectedStatus: 200 },
      },
      testOperator,
    );
    const target = await delivery.registerEnvironment(
      {
        id: "arcade/promotion",
        serviceId: "arcade",
        name: "promotion",
        pipelineRevisionId: "arcade/promoted-site",
        configurationRevision: "config/1",
        configuration: {},
        automatic: false,
        promotionSourceEnvironmentId: fixture.environment.id,
      },
      testOperator,
    );
    const promoted = await delivery.createDeployment(
      {
        requestId: "failed-promotion",
        environmentId: target.id,
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: target.generation,
        kind: "promote",
        sourceEnvironmentId: fixture.environment.id,
      },
      testOperator,
    );
    await delivery.claim(promoted.id, testExecutor);
    await delivery.finish(
      promoted.id,
      {
        status: "failed",
        message: "Preflight failed before effects",
        evidence: [],
        recoveryRequired: false,
      },
      testExecutor,
    );
    const app = createApp({
      delivery,
      ciOrigin: "https://woodpecker.sjer.red",
      ciRepositoryId: 1,
      qualifyBuild: async () => "verified",
      peerAddress: () => "127.0.0.1",
      config: {
        publicOrigin: "http://delivery.test",
        machineCredentials: [],
        writesEnabled: async () => true,
        enabledEnvironments: async () => [target.id],
        operatorLogins: async () => [testOperator.id],
        trustedProxyAddresses: async () => ["127.0.0.1"],
      },
    });
    const response = await app.request(
      `/api/v1/deployments/${promoted.id}/retry`,
      {
        method: "POST",
        headers: {
          "Tailscale-User-Login": testOperator.id,
          Origin: "http://delivery.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: "promotion-retry",
          expectedGeneration: 1,
        }),
      },
    );
    expect(response.status).toBe(201);
    const retry = await cluster.database.deployment.findUniqueOrThrow({
      where: { requestId: "promotion-retry" },
    });
    expect(retry).toMatchObject({
      kind: "promote",
      sourceEnvironmentId: fixture.environment.id,
      versionSetRevisionId: fixture.versionSet.id,
      status: "queued",
    });
  });
});
beforeEach(async () => {
  await cluster.database.$executeRawUnsafe(
    'TRUNCATE "ApplicationLock", "Outbox", "Evidence", "Approval", "Stage", "Deployment", "Environment", "Pipeline", "VersionSetEntry", "VersionSet", "Artifact", "Build", "Request", "Audit", "ImportedSnapshot" CASCADE',
  );
  fixture = await seedDelivery(delivery);
});
async function publish(number: number) {
  return delivery.publish(
    {
      requestId: `publish/${String(number)}`,
      serviceId: "arcade",
      sourceRevision: String(number).repeat(40),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: `image/${String(number)}`,
          component: "server",
          kind: "image",
          uri: "docker.io/shepherdjerred/arcade",
          digest: `sha256:${String(number).repeat(64)}`,
          version: `1.0.${String(number)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: number },
  );
}
async function select(
  revision: string,
  kind: "deploy" | "rollback" = "deploy",
) {
  const env = await cluster.database.environment.findUniqueOrThrow({
    where: { id: fixture.environment.id },
  });
  const selected = await delivery.createDeployment(
    {
      requestId: crypto.randomUUID(),
      environmentId: env.id,
      versionSetRevisionId: revision,
      expectedGeneration: env.generation,
      kind,
    },
    testOperator,
  );
  await delivery.claim(selected.id, testExecutor);
  return selected;
}
async function accept(deploymentId: string, revision: string) {
  await delivery.finish(
    deploymentId,
    {
      status: "succeeded",
      message: "Verified exact selection",
      observedRevisionId: revision,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "Selected revision reconciled" },
        { kind: "acceptance", summary: "Runtime checks passed" },
      ],
    },
    testExecutor,
  );
}

describe("selection recovery and qualification fairness", () => {
  test("rollback holds the bad qualified revision until a new build qualifies", async () => {
    const baseline = await select(fixture.versionSet.id);
    await accept(baseline.id, fixture.versionSet.id);
    const bad = await publish(2);
    await delivery.qualify(bad.buildId, "verified", testExecutor);
    const [latest] = await delivery.versions("arcade");
    if (latest === undefined) throw new Error("Missing qualified version");
    const failed = await select(latest.id);
    await delivery.finish(
      failed.id,
      {
        status: "failed",
        message: "Acceptance failed",
        recoveryRequired: false,
        evidence: [],
      },
      testExecutor,
    );
    const rollback = await select(fixture.versionSet.id, "rollback");
    await accept(rollback.id, fixture.versionSet.id);
    expect(
      await delivery.reconcile([fixture.environment.id], testExecutor),
    ).toEqual({ deployments: [] });
    const fresh = await publish(3);
    await delivery.qualify(fresh.buildId, "verified", testExecutor);
    const reconciled = await delivery.reconcile(
      [fixture.environment.id],
      testExecutor,
    );
    expect(reconciled.deployments).toHaveLength(1);
  });
  test("pending builds rotate after checks instead of starving newer finished builds", async () => {
    const first = await publish(2);
    const second = await publish(3);
    const initial = await delivery.pendingQualification();
    expect(initial.builds[0]?.id).toBe(first.buildId);
    await delivery.markQualificationAttempt(first.buildId);
    const next = await delivery.pendingQualification();
    expect(next.builds[0]?.id).toBe(second.buildId);
  });
  test("permanent CI identity rejection is recorded while subsequent valid builds qualify", async () => {
    const invalid = await publish(2);
    const valid = await publish(3);
    const token = "executor-test-credential-32-characters";
    const app = createApp({
      delivery,
      ciOrigin: "https://woodpecker.sjer.red",
      ciRepositoryId: 1,
      peerAddress: () => "127.0.0.1",
      qualifyBuild: async (build) => {
        if (build.sourceRevision === "2".repeat(40))
          throw new DeliveryError(
            "INVALID",
            "CI pipeline was not an exact main push",
          );
        return "verified";
      },
      config: {
        publicOrigin: "http://delivery.test",
        machineCredentials: [{ token, principal: testExecutor }],
        writesEnabled: async () => true,
        enabledEnvironments: async () => [fixture.environment.id],
        operatorLogins: async () => [],
        trustedProxyAddresses: async () => [],
      },
    });
    for (const build of [invalid, valid]) {
      const response = await app.request(
        `/api/v1/builds/${build.buildId}/qualify`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(200);
    }
    expect(await delivery.build(invalid.buildId)).toMatchObject({
      status: "failed",
      qualificationReason: "CI pipeline was not an exact main push",
    });
    expect(await delivery.build(valid.buildId)).toMatchObject({
      status: "verified",
    });
  });
  test("cancel prevents a new mutation stage but preserves a running operation receipt", async () => {
    const selected = await select(fixture.versionSet.id);
    const stage = {
      key: "reconcile",
      operationId: "operation/1",
      status: "running" as const,
      message: "Starting external operation",
      evidence: [],
    };
    await delivery.stage(selected.id, stage, testExecutor);
    await delivery.cancel(selected.id, testOperator);
    await delivery.stage(
      selected.id,
      { ...stage, message: "Recorded existing Job UID" },
      testExecutor,
    );
    await expect(
      delivery.stage(
        selected.id,
        { ...stage, key: "next", operationId: "operation/2" },
        testExecutor,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  test("Scout production approval follows its canonical bucket rather than display name", async () => {
    await delivery.registerPipeline(
      "scout-site/prod",
      {
        kind: "static-site",
        bucket: "scout-frontend",
        archiveComponent: "site:scout-frontend",
        immutablePrefixes: [],
        extraExcludes: [],
        entrypoints: ["index.html"],
        verification: { url: "https://scout-for-lol.com", expectedStatus: 200 },
      },
      testOperator,
    );
    const env = await delivery.registerEnvironment(
      {
        id: "scout/site",
        serviceId: "scout-for-lol",
        name: "beta",
        pipelineRevisionId: "scout-site/prod",
        configurationRevision: "config/1",
        configuration: {},
        automatic: true,
      },
      testOperator,
    );
    expect(env.approvalRequired).toBe(true);
    const overview = await delivery.overview();
    expect(
      overview.environments.find((entry) => entry.id === env.id)
        ?.approvalRequired,
    ).toBe(true);
    await delivery.registerPipeline(
      "scout-site/unknown",
      {
        kind: "static-site",
        bucket: "scout-unknown",
        archiveComponent: "site:scout-unknown",
        immutablePrefixes: [],
        extraExcludes: [],
        entrypoints: ["index.html"],
        verification: { url: "https://scout-for-lol.com", expectedStatus: 200 },
      },
      testOperator,
    );
    await expect(
      delivery.registerEnvironment(
        {
          id: "scout/unknown",
          serviceId: "scout-for-lol",
          name: "beta",
          pipelineRevisionId: "scout-site/unknown",
          configurationRevision: "config/1",
          configuration: {},
          automatic: true,
        },
        testOperator,
      ),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});
