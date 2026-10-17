import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createTestDatabase,
  createApp,
  Delivery,
  testExecutor,
  testOperator,
  testPublisher,
} from "@shepherdjerred/delivery/testing";
import { staticAcceptanceEvidence } from "./static-site-effects.ts";

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  cluster = await createTestDatabase();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

test("the static adapter's evidence can finish its exact deployment through the real PG-backed API", async () => {
  const delivery = new Delivery(cluster.database);
  const digest = `sha256:${"a".repeat(64)}`;
  const publication = await delivery.publish(
    {
      requestId: "static-build",
      serviceId: "static-sites",
      sourceRevision: "a".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/1",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "site:wiki:1",
          component: "site:wiki-sjer-red",
          kind: "archive",
          uri: `s3://delivery-artifacts/sites/wiki-sjer-red/${"a".repeat(64)}.tar`,
          digest,
          version: "1",
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 1 },
  );
  await delivery.qualify(publication.buildId, "verified", testExecutor);
  const versions = await delivery.versions("static-sites");
  const selected = versions[0];
  if (selected === undefined)
    throw new Error(
      "Static fixture qualification did not create a version set",
    );
  await delivery.registerPipeline(
    "wiki/1",
    {
      kind: "static-site",
      archiveComponent: "site:wiki-sjer-red",
      bucket: "wiki-sjer-red",
      immutablePrefixes: ["_astro/"],
      extraExcludes: [],
      entrypoints: ["index.html"],
      verification: { url: "https://wiki.sjer.red", expectedStatus: 200 },
    },
    testOperator,
  );
  await delivery.registerEnvironment(
    {
      id: "wiki/prod",
      serviceId: "static-sites",
      name: "prod",
      pipelineRevisionId: "wiki/1",
      configurationRevision: "config/1",
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
  const deployment = await delivery.createDeployment(
    {
      requestId: "wiki-deploy",
      environmentId: "wiki/prod",
      versionSetRevisionId: selected.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );
  await delivery.claim(deployment.id, testExecutor);
  const app = createApp({
    delivery,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: async () => "verified",
    peerAddress: () => null,
    config: {
      publicOrigin: "http://delivery.test",
      machineCredentials: [
        {
          token: "static-executor-test-credential-32-characters",
          principal: testExecutor,
        },
      ],
      writesEnabled: async () => true,
      enabledEnvironments: async () => ["wiki/prod"],
      operatorLogins: async () => [],
      trustedProxyAddresses: async () => [],
    },
  });
  const response = await app.request(
    `/api/v1/deployments/${deployment.id}/finish`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer static-executor-test-credential-32-characters",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "succeeded",
        message: "Static release accepted",
        observedRevisionId: selected.id,
        recoveryRequired: false,
        evidence: staticAcceptanceEvidence(
          {
            deploymentId: deployment.id,
            versionSetRevisionId: selected.id,
            archiveDigest: digest,
            bucket: "wiki-sjer-red",
          },
          "https://wiki.sjer.red",
        ),
      }),
    },
  );
  expect(response.status).toBe(200);
  const accepted = await delivery.detail(deployment.id);
  expect(accepted.deployment.status).toBe("succeeded");
  expect(accepted.environment.acceptedVersionSetRevisionId).toBe(selected.id);
  expect(accepted.environment.activeDeploymentId).toBeNull();
});
