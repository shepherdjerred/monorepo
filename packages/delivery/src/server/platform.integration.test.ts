import { beforeEach, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { platformFixture } from "#testing/platform-fixture.ts";
import {
  checkpointTestPlan,
  requestTestPlan,
  finishTestPlatform,
  testApply,
} from "#testing/platform-execution.ts";
import { testExecutor } from "#testing/seed.ts";
import { createTestApp } from "#testing/http-app.ts";

const context = useDeliveryFixture();
let fixture: Awaited<ReturnType<typeof platformFixture>>;
let app: ReturnType<typeof createTestApp>;
let writes = true;
const token = "disposable-platform-executor-credential";
const human = {
  "Tailscale-User-Login": "operator@example.com",
  Origin: "http://delivery.test",
  "Content-Type": "application/json",
};
beforeEach(async () => {
  writes = true;
  fixture = await platformFixture(context.cluster.database);
  app = createTestApp(fixture.delivery, {
    machineCredentials: [
      { token, principal: testExecutor },
      {
        token: "disposable-platform-publisher-credential",
        principal: {
          id: "publisher",
          kind: "machine",
          scopes: ["read", "publish"],
        },
      },
      {
        token: "disposable-platform-readonly-credential",
        principal: { id: "observer", kind: "machine", scopes: ["read"] },
      },
    ],
    writesEnabled: () => Promise.resolve(writes),
    enabledEnvironments: () => Promise.resolve(fixture.environmentIds),
  });
});

test("fixed platform intents allow trusted human deploy scope while read/publish and machine approval remain denied", async () => {
  const input = {
    kind: "tofu-plan",
    requestId: "human/platform",
    environmentId: "gitops/tofu:github",
    sourceBuildId: fixture.sourceBuildId,
    expectedGeneration: 0,
  };
  for (const credential of [
    "disposable-platform-publisher-credential",
    "disposable-platform-readonly-credential",
  ]) {
    const denied = await app.request("/api/v1/platform/deployments", {
      method: "POST",
      headers: { ...human, Authorization: `Bearer ${credential}` },
      body: JSON.stringify(input),
    });
    expect(denied.status).toBe(403);
  }
  const allowed = await app.request("/api/v1/platform/deployments", {
    method: "POST",
    headers: human,
    body: JSON.stringify(input),
  });
  expect(allowed.status).toBe(201);
  const plan = await requestTestPlan(
    fixture.delivery,
    fixture.sourceBuildId,
    "openai",
  );
  const saved = await checkpointTestPlan(fixture.delivery, plan);
  await finishTestPlatform(fixture.delivery, plan, saved);
  const apply = await testApply(fixture.delivery, plan);
  const approval = await app.request(
    `/api/v1/deployments/${apply.id}/approval`,
    {
      method: "POST",
      headers: { ...human, Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        decision: "approve",
        reason: "Machine impersonating human must fail",
      }),
    },
  );
  expect(approval.status).toBe(403);
  const unchanged = await fixture.delivery.detail(apply.id);
  expect(unchanged.deployment.status).toBe("awaiting_approval");
});

test("paused writes preserve a native UID checkpoint without admitting new operations", async () => {
  const plan = await requestTestPlan(fixture.delivery, fixture.sourceBuildId);
  const saved = await checkpointTestPlan(fixture.delivery, plan);
  writes = false;
  const stage = {
    key: "tofu-plan",
    status: "running",
    operationId: saved.receipt.nativeJob.name,
    message: JSON.stringify(saved.receipt.nativeJob),
    evidence: [],
  };
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const requestStage = (input: unknown) =>
    app.request(`/api/v1/deployments/${plan.id}/stages`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
  const checkpoint = await requestStage(stage);
  const newStage = await requestStage({ ...stage, key: "new-effects" });
  const changedOperation = await requestStage({
    ...stage,
    operationId: "different-native-request",
  });
  const claim = await app.request(`/api/v1/deployments/${plan.id}/claim`, {
    method: "POST",
    headers,
    body: "{}",
  });
  expect(checkpoint.status).toBe(200);
  expect(newStage.status).toBe(503);
  expect(changedOperation.status).toBe(503);
  expect(claim.status).toBe(503);
  expect(await context.cluster.database.targetLock.count()).toBe(1);
});

test("encrypted plan records above1MiB are bounded separately and remain execute-only", async () => {
  const plan = await requestTestPlan(fixture.delivery, fixture.sourceBuildId);
  const saved = await checkpointTestPlan(fixture.delivery, plan, 1_100_000);
  const response = await app.request("/api/v1/platform/plans", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(saved),
  });
  expect(response.status).toBe(201);
  const metadata = await response.text();
  expect(metadata).toContain(saved.receipt.planDigest);
  expect(metadata).not.toContain("ciphertext");
  const denied = await app.request(`/api/v1/platform/plans/${plan.id}`, {
    headers: human,
  });
  expect(denied.status).toBe(403);
  const authorized = await app.request(`/api/v1/platform/plans/${plan.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(authorized.status).toBe(200);
  expect(await authorized.json()).toEqual(saved);
  const publicDetail = await app.request(`/api/v1/deployments/${plan.id}`, {
    headers: human,
  });
  expect(await publicDetail.text()).not.toContain("ciphertext");
});

test("claim accepts exactemptyobject but rejects unrelated caller-shaped evidence", async () => {
  const plan = await requestTestPlan(fixture.delivery, fixture.sourceBuildId);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const bad = await app.request(`/api/v1/deployments/${plan.id}/claim`, {
    method: "POST",
    headers,
    body: '{"verified":true}',
  });
  expect(bad.status).toBe(400);
  const valid = await app.request(`/api/v1/deployments/${plan.id}/claim`, {
    method: "POST",
    headers,
    body: "{}",
  });
  expect(valid.status).toBe(200);
});
