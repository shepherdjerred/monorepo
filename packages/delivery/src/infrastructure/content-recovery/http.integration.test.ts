import { expect, test, vi } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import {
  contentRecoveryFixture,
  contentRecoveryCatalog,
} from "#testing/content-recovery-fixture.ts";
import { testExecutor } from "#testing/seed.ts";
import { createApp } from "#server/app.ts";
import { ContentRecoveryIntentSchema } from "#shared/contract.ts";

const scope = useDeliveryFixture({ catalog: contentRecoveryCatalog });
const admin = "content-admin-test-token-with-more-than-32-characters";
const publisher = "content-publisher-test-token-with-more-than-32-characters";
const executor = "content-executor-test-token-with-more-than-32-characters";

test("actual HTTP accepts non-UUID admin recovery identity while paused and refuses generic static lock release without inspecting or changing generation", async () => {
  const fixture = await contentRecoveryFixture(scope.delivery);
  await scope.delivery.failContentRecovery(
    fixture.intent.id,
    "Before any producer effect, gather a fresh independent observation",
    testExecutor,
  );
  const inspect = vi.fn(() =>
    Promise.resolve([
      {
        kind: "reconciliation" as const,
        operationId: crypto.randomUUID(),
        summary: "Generic Argo-only readback cannot settle a bucket",
      },
    ]),
  );
  const app = createApp({
    delivery: scope.delivery,
    peerAddress: () => null,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: () => Promise.resolve("verified"),
    inspectRecovery: inspect,
    config: {
      publicOrigin: "http://delivery.test",
      writesEnabled: () => Promise.resolve(false),
      enabledEnvironments: () => Promise.resolve(["static-sites/sjer-red"]),
      operatorLogins: () => Promise.resolve([]),
      trustedProxyAddresses: () =>
        Promise.reject(new Error("Bearer requests must not query Kubernetes")),
      machineCredentials: [
        {
          token: admin,
          principal: {
            id: "content-admin",
            kind: "machine",
            scopes: ["read", "admin"],
          },
        },
        {
          token: publisher,
          principal: {
            id: "content-publisher",
            kind: "machine",
            scopes: ["read", "publish"],
          },
        },
        {
          token: executor,
          principal: {
            id: "content-executor",
            kind: "machine",
            scopes: ["read", "execute"],
          },
        },
      ],
    },
  });
  const post = (path: string, token: string, body: unknown) =>
    app.request(`http://delivery.test/api/v1/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const request = {
    ...fixture.request,
    requestId: "operator/site-recovery/with-slashes",
  };
  const publisherResponse = await post(
    `deployments/${fixture.failed.id}/content-recovery`,
    publisher,
    request,
  );
  expect(publisherResponse.status).toBe(403);
  const accepted = await post(
    `deployments/${fixture.failed.id}/content-recovery`,
    admin,
    request,
  );
  expect(accepted.status).toBe(201);
  const intent = ContentRecoveryIntentSchema.parse(await accepted.json());
  expect(intent.id).toBe(request.requestId);
  const before = await scope.delivery.detail(fixture.failed.id);
  const refused = await post(
    `deployments/${fixture.failed.id}/release-lock`,
    admin,
    {
      operationId: crypto.randomUUID(),
      reason:
        "Inspecting a failed static publication must never use generic Argo-only settlement",
    },
  );
  expect(refused.status).toBe(400);
  expect(inspect).not.toHaveBeenCalled();
  const after = await scope.delivery.detail(fixture.failed.id);
  expect(after.environment.generation).toBe(before.environment.generation);
  expect(after.deployment).toMatchObject({
    status: "failed",
    recoveryRequired: true,
  });
  expect(
    await scope.cluster.database.targetLock.count({
      where: { deploymentId: fixture.failed.id },
    }),
  ).toBe(1);
  const repairResponse = await post(
    `content-recovery/${encodeURIComponent(intent.id)}/admit-repair`,
    executor,
    {},
  );
  expect(repairResponse.status).toBe(503);
});
