import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { MockActivityEnvironment } from "@temporalio/testing";
import {
  createTestDatabase,
  platformFixture,
} from "@shepherdjerred/delivery/testing";
import {
  DeploymentDetailSchema,
  PlatformReleaseSnapshotSchema,
  TofuPlanReceiptSchema,
} from "@shepherdjerred/delivery/contract";
import type { createDeliveryClient } from "@shepherdjerred/delivery/client";
import { createHash } from "node:crypto";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import { encryptDeliveryPlan } from "#lib/delivery/platform/plan-crypto.ts";
import { finishDelivery } from "#activities/delivery/execute.ts";
import type { runDeliveryJob } from "#lib/delivery/job.ts";
import { executePlatformWithJob } from "./index.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { executionApiFixture } from "./execution-api-fixtures.ts";
import { admitPlatformNativeJob } from "#lib/delivery/platform/native-job.ts";

/** `finishDelivery` reports as the Activity of its executor Workflow (D7). */
async function finishAsExecutor(...args: Parameters<typeof finishDelivery>) {
  return await new MockActivityEnvironment().run(finishDelivery, ...args);
}

/** The platform step writes its stages as the executor's Activity (D7). */
async function asExecutor(...args: Parameters<typeof executePlatformWithJob>) {
  return await new MockActivityEnvironment().run<
    Parameters<typeof executePlatformWithJob>,
    Awaited<ReturnType<typeof executePlatformWithJob>>,
    typeof executePlatformWithJob
  >(executePlatformWithJob, ...args);
}

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let fixture: Awaited<ReturnType<typeof platformFixture>>;
let server: ReturnType<typeof Bun.serve>;
let operator: ReturnType<typeof createDeliveryClient>;
beforeAll(async () => {
  cluster = await createTestDatabase();
  fixture = await platformFixture(cluster.database);
  ({ server, operator } = executionApiFixture(
    fixture.delivery,
    fixture.environmentIds,
  ));
  vi.stubEnv("DELIVERY_API_URL", server.url.origin);
  vi.stubEnv("DELIVERY_EXECUTOR_TOKEN", "platform-test-executor");
}, 60_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await server.stop(true);
  await cluster.close();
});

const nativeJob: typeof runDeliveryJob = async (request, onReceipt) => {
  const manifest = deliveryJobManifest(request);
  const receipt = {
    namespace: "delivery-platform-jobs" as const,
    name: manifest.metadata!.name!,
    uid: crypto.randomUUID(),
    specFingerprint:
      manifest.metadata!.annotations![
        "delivery.shepherdjerred.com/fingerprint"
      ]!,
    requestId: request.deploymentId,
  };
  const intent = await fixture.delivery.detail(request.deploymentId);
  expect(intent.stages).toContainEqual(
    expect.objectContaining({
      key: request.stageKey,
      status: "running",
      operationId: receipt.name,
    }),
  );
  if (request.recipe === "tofu-apply") {
    // Kubernetes may start the child before the create response reaches onReceipt.
    expect(
      intent.stages.some((stage) => stage.message === JSON.stringify(receipt)),
    ).toBe(false);
    for (const [key, value] of Object.entries({
      DELIVERY_JOB_NAMESPACE: receipt.namespace,
      DELIVERY_JOB_NAME: receipt.name,
      DELIVERY_JOB_UID: receipt.uid,
      DELIVERY_JOB_FINGERPRINT: receipt.specFingerprint,
    }))
      vi.stubEnv(key, value);
    expect(await admitPlatformNativeJob(request)).toEqual(receipt);
    const beforeCallback = await fixture.delivery.detail(request.deploymentId);
    expect(beforeCallback.stages).toContainEqual(
      expect.objectContaining({
        key: "tofu-apply",
        message: JSON.stringify(receipt),
      }),
    );
  }
  await onReceipt(receipt);
  const persisted = await fixture.delivery.detail(request.deploymentId);
  expect(persisted.stages).toContainEqual(
    expect.objectContaining({ message: JSON.stringify(receipt) }),
  );
  const snapshot = PlatformReleaseSnapshotSchema.parse(request.input);
  if (snapshot.kind === "tofu-plan") {
    const bytes = new TextEncoder().encode(
      "private fixture original saved plan",
    );
    const createdAt = new Date();
    return encryptDeliveryPlan(
      TofuPlanReceiptSchema.parse({
        schema: "delivery-tofu-plan/v1",
        deploymentId: request.deploymentId,
        sourceBuildId: snapshot.source.id,
        sourceRevision: snapshot.source.sourceRevision,
        stack: snapshot.stack,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + 60_000).toISOString(),
        planDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        state: { lineage: "original-state", serial: 4 },
        nativeJob: receipt,
        changes: { create: 0, update: 1, delete: 0, replace: 0 },
      }),
      bytes,
      "fixture-only-private-plan-passphrase",
    );
  }
  if (snapshot.kind !== "tofu-apply") throw new Error("Unexpected recipe");
  expect(request.input).not.toHaveProperty("encryptedPlan");
  return {
    stack: snapshot.stack,
    planDeploymentId: snapshot.planDeploymentId,
    planDigest: snapshot.plan.planDigest,
    state: { lineage: "original-state", serial: 5 },
    outcome: "applied-saved-plan",
    // The apply reads back the state marker naming its deployment (T5).
    marker: {
      schema: "delivery-tofu-marker/v1",
      deploymentId: request.deploymentId,
      stack: snapshot.stack,
      stateLineage: "original-state",
      stateSerial: 5,
      archiveDigest: null,
      appliedAt: new Date().toISOString(),
    },
  };
};

test("real PG+HTTP freezes qualified plan, persists native receipt before effects, then accepts only the separate exact apply", async () => {
  const planned = await operator.createPlatformDeployment({
    requestId: crypto.randomUUID(),
    environmentId: "gitops/tofu:github",
    expectedGeneration: 0,
    kind: "tofu-plan",
    sourceBuildId: fixture.sourceBuildId,
  });
  await deliveryRequest(
    `deployments/${encodeURIComponent(planned.id)}/claim`,
    DeploymentDetailSchema,
    {},
  );
  const evidence = await asExecutor(planned.id, nativeJob);
  await finishAsExecutor(planned.id, { status: "succeeded", evidence });
  const afterPlan = await fixture.delivery.detail(planned.id);
  expect(afterPlan.environment.acceptedDeploymentId).toBeNull();
  expect(JSON.stringify(afterPlan)).not.toContain("ciphertext");
  expect(afterPlan.environment.acceptedVersionSetRevisionId).toBeNull();
  const apply = await operator.createPlatformDeployment({
    requestId: crypto.randomUUID(),
    environmentId: "gitops/tofu:github",
    expectedGeneration: afterPlan.environment.generation,
    kind: "tofu-apply",
    planDeploymentId: planned.id,
  });
  await deliveryRequest(
    `deployments/${encodeURIComponent(apply.id)}/claim`,
    DeploymentDetailSchema,
    {},
  );
  const accepted = await asExecutor(apply.id, nativeJob);
  await finishAsExecutor(apply.id, { status: "succeeded", evidence: accepted });
  const done = await fixture.delivery.detail(apply.id);
  expect(done.environment.acceptedDeploymentId).toBe(apply.id);
  expect(done.environment.acceptedVersionSetRevisionId).toBeNull();
  expect(done.deployment.platformSnapshot).toMatchObject({
    kind: "tofu-apply",
    planDeploymentId: planned.id,
  });
  expect(await cluster.database.platformLock.count()).toBe(0);
}, 60_000);
