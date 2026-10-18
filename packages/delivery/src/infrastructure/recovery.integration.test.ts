import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { seedDelivery, testExecutor, testOperator } from "#testing/seed.ts";
import { Delivery } from "./delivery.ts";
import { createRecoveryInspector } from "./recovery.ts";
import type { DeploymentDetail } from "#shared/contract.ts";

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
  test("requires a configured read credential and never uses Temporal", async () => {
    const inspect = createRecoveryInspector({
      origin: "https://argocd.sjer.red",
      token: undefined,
    });
    await expect(inspect(detail, recovery)).rejects.toMatchObject({
      code: "PAUSED",
    });
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
      origin: "https://argocd.sjer.red",
      token: "test-read-only-token",
      fetch: () => Promise.resolve(Response.json(observation())),
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
        origin: "https://argocd.sjer.red",
        token: "test-read-only-token",
        fetch: async () => Response.json(observation(phase)),
      });
      await expect(inspect(detail, recovery)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    },
  );
  test("rejects a different external operation or environment delegation", async () => {
    const inspect = createRecoveryInspector({
      origin: "https://argocd.sjer.red",
      token: "test-read-only-token",
      fetch: async () => Response.json(observation()),
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
        origin: "https://argocd.sjer.red",
        token: "test-read-only-token",
        fetch: async () => Response.json(other),
      })(detail, recovery),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  test("rejects an unfinished Job even after Argo stops waiting", async () => {
    const current = observation();
    current.status.resources = [
      { kind: "Job", health: { status: "Progressing" } },
    ];
    const inspect = createRecoveryInspector({
      origin: "https://argocd.sjer.red",
      token: "test-read-only-token",
      fetch: async () => Response.json(current),
    });
    await expect(inspect(detail, recovery)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  test("stores exact independent readback before releasing only the owned lock", async () => {
    const inspect = createRecoveryInspector({
      origin: "https://argocd.sjer.red",
      token: "test-read-only-token",
      fetch: async (url, init) => {
        expect(url instanceof Request ? url.url : String(url)).toBe(
          "https://argocd.sjer.red/api/v1/applications/arcade",
        );
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer test-read-only-token",
        );
        return Response.json(observation());
      },
    });
    const evidence = await inspect(detail, recovery);
    await delivery.releaseLock(
      detail.deployment.id,
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
