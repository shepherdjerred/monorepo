import { beforeEach, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { platformFixture } from "#testing/platform-fixture.ts";
import {
  checkpointTestPlan,
  finishTestPlatform,
  requestTestPlan,
  testApply,
} from "#testing/platform-execution.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";

const context = useDeliveryFixture();
let fixture: Awaited<ReturnType<typeof platformFixture>>;
beforeEach(async () => {
  fixture = await platformFixture(context.cluster.database);
});

test("private saved plans bind exact native identity, immutable ciphertext and original source", async () => {
  const plan = await requestTestPlan(fixture.delivery, fixture.sourceBuildId);
  const saved = await checkpointTestPlan(fixture.delivery, plan);
  await expect(
    fixture.delivery.recordTofuPlan(
      {
        ...saved,
        receipt: {
          ...saved.receipt,
          nativeJob: { ...saved.receipt.nativeJob, uid: crypto.randomUUID() },
        },
      },
      testExecutor,
    ),
  ).rejects.toThrow("native Job identity");
  expect(await fixture.delivery.recordTofuPlan(saved, testExecutor)).toEqual(
    saved.receipt,
  );
  expect(await fixture.delivery.recordTofuPlan(saved, testExecutor)).toEqual(
    saved.receipt,
  );
  await expect(
    fixture.delivery.recordTofuPlan(
      {
        ...saved,
        encryptedPlan: {
          ...saved.encryptedPlan,
          ciphertext: Buffer.from("changed").toString("base64"),
        },
      },
      testExecutor,
    ),
  ).rejects.toThrow("immutable");
  await expect(
    fixture.delivery.tofuPlan(plan.id, testOperator),
  ).rejects.toThrow();
  expect(await fixture.delivery.tofuPlan(plan.id, testExecutor)).toEqual(saved);
  await finishTestPlatform(fixture.delivery, plan, saved);
  const detail = await fixture.delivery.detail(plan.id);
  expect(JSON.stringify(detail)).not.toContain("ciphertext");
  expect(detail.environment.acceptedDeploymentId).toBeNull();
  expect(detail.environment.acceptedVersionSetRevisionId).toBeNull();
  expect(detail.environment.observedVersionSetRevisionId).toBeNull();
});

test("routine apply is automatic, sensitive apply approves the exact public saved plan", async () => {
  for (const stack of ["github", "openai"]) {
    const plan = await requestTestPlan(
      fixture.delivery,
      fixture.sourceBuildId,
      stack,
    );
    const saved = await checkpointTestPlan(fixture.delivery, plan);
    await finishTestPlatform(fixture.delivery, plan, saved);
    const apply = await testApply(fixture.delivery, plan);
    expect(apply.status).toBe(
      stack === "openai" ? "awaiting_approval" : "queued",
    );
    expect(apply.platformSnapshot?.kind).toBe("tofu-apply");
    if (apply.platformSnapshot?.kind !== "tofu-apply")
      throw new Error("Expected apply");
    expect(apply.platformSnapshot.plan).toEqual(saved.receipt);
    if (stack === "openai")
      await fixture.delivery.approve(
        apply.id,
        { decision: "approve", reason: "Reviewed exact plan digest and state" },
        testOperator,
      );
    await fixture.delivery.claim(apply.id, testExecutor);
    await finishTestPlatform(fixture.delivery, apply);
    const detail = await fixture.delivery.detail(apply.id);
    expect(detail.environment.acceptedDeploymentId).toBe(apply.id);
    expect(detail.environment.acceptedVersionSetRevisionId).toBeNull();
    expect(detail.environment.desiredVersionSetRevisionId).toBeNull();
    await expect(testApply(fixture.delivery, plan)).rejects.toThrow(
      "already claimed",
    );
  }
});

test("the shared platform lock serializes separate state stacks and retains ambiguous ownership", async () => {
  const applies = [];
  for (const stack of ["github", "posthog"]) {
    const plan = await requestTestPlan(
      fixture.delivery,
      fixture.sourceBuildId,
      stack,
    );
    const saved = await checkpointTestPlan(fixture.delivery, plan);
    await finishTestPlatform(fixture.delivery, plan, saved);
    applies.push(await testApply(fixture.delivery, plan));
  }
  const [first, second] = applies;
  if (first === undefined || second === undefined)
    throw new Error("Expected both applies");
  const attempts = await Promise.allSettled(
    applies.map((apply) => fixture.delivery.claim(apply.id, testExecutor)),
  );
  expect(
    attempts.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const owner = await context.cluster.database.platformLock.findUniqueOrThrow({
    where: { id: "platform" },
  });
  const waiting = owner.deploymentId === first.id ? second : first;
  await fixture.delivery.finish(
    owner.deploymentId,
    {
      status: "failed",
      message: "Ambiguous native apply",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  await expect(
    fixture.delivery.claim(waiting.id, testExecutor),
  ).rejects.toThrow("Shared platform resources");
  expect(await context.cluster.database.platformLock.count()).toBe(1);
});

test("source ownership denies apply while permitting readonly plans", async () => {
  const delivery = new Delivery(
    context.cluster.database,
    1,
    new ServiceIndex({
      ...fixture.catalog.catalog,
      platformDeliveryDelegated: false,
    }),
  );
  const plan = await requestTestPlan(delivery, fixture.sourceBuildId, "arr");
  const saved = await checkpointTestPlan(delivery, plan);
  await finishTestPlatform(delivery, plan, saved);
  await expect(testApply(delivery, plan)).rejects.toThrow("legacy CI");
});

test("same-stack exclusion and exact source prerequisites apply before native effects", async () => {
  const plan = await requestTestPlan(
    fixture.delivery,
    fixture.sourceBuildId,
    "tailscale",
  );
  await expect(fixture.delivery.claim(plan.id, testExecutor)).rejects.toThrow(
    "seaweedfs",
  );
  expect(await context.cluster.database.targetLock.count()).toBe(0);
  await expect(
    requestTestPlan(fixture.delivery, fixture.sourceBuildId, "tailscale"),
  ).rejects.toThrow("pending");
});

test("automatic selection uses source receipts and does not repeat rejected source plans", async () => {
  await context.cluster.database.environment.update({
    where: { id: "gitops/tofu:github" },
    data: { automatic: true },
  });
  const selected = await fixture.delivery.reconcile(
    ["gitops/tofu:github"],
    testExecutor,
  );
  expect(selected.deployments).toHaveLength(1);
  const deploymentId = selected.deployments[0];
  if (deploymentId === undefined) throw new Error("Expected plan");
  await fixture.delivery.cancel(deploymentId, testOperator);
  expect(
    await fixture.delivery.reconcile(["gitops/tofu:github"], testExecutor),
  ).toEqual({ deployments: [] });
});

test("saved plan expiry is checked again immediately before apply effects", async () => {
  const plan = await requestTestPlan(fixture.delivery, fixture.sourceBuildId);
  const saved = await checkpointTestPlan(fixture.delivery, plan);
  saved.receipt.createdAt = new Date(Date.now() - 10_000).toISOString();
  saved.receipt.expiresAt = new Date(Date.now() + 1000).toISOString();
  await finishTestPlatform(fixture.delivery, plan, saved);
  const apply = await testApply(fixture.delivery, plan);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await expect(fixture.delivery.claim(apply.id, testExecutor)).rejects.toThrow(
    "expired",
  );
  expect(await context.cluster.database.platformLock.count()).toBe(0);
});
