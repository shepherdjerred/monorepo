import { afterEach, describe, expect, it, vi } from "vitest";
import { MockActivityEnvironment } from "@temporalio/testing";
import { TofuPlanReceiptSchema } from "@shepherdjerred/delivery/contract";
import {
  DeliveryJobReceiptSchema,
  type DeliveryJobReceipt,
  type DeliveryJobRequest,
} from "#shared/delivery-job.ts";
import { artifact, detail, digest } from "#lib/delivery/model/testing.ts";
import { modelApplyInput } from "#lib/delivery/model/tofu.ts";
import { requireModelRecipe } from "#lib/delivery/model/recipe.ts";

const api = vi.hoisted(() => {
  const calls: { path: string; body: unknown }[] = [];
  return { calls, responses: new Map<string, unknown>() };
});
vi.mock("#lib/delivery/client.ts", () => ({
  deliveryRequest: vi.fn(
    (
      path: string,
      schema: { parse: (raw: unknown) => unknown },
      body?: unknown,
    ) => {
      api.calls.push({ path, body });
      return Promise.resolve(schema.parse(api.responses.get(path) ?? {}));
    },
  ),
}));

const platformStep = await import("./model-tofu.ts");
/** The step runs as an Activity, whose context names the owning executor. */
async function runDeliveryModelPlatformStep(
  ...args: Parameters<typeof platformStep.runDeliveryModelPlatformStep>
) {
  return await new MockActivityEnvironment().run(
    platformStep.runDeliveryModelPlatformStep,
    ...args,
  );
}

const archive = artifact({
  id: "archive/tofu-cloudflare",
  component: "archive:tofu-cloudflare",
  kind: "archive",
  uri: `s3://delivery-artifacts/tofu/cloudflare/${"d".repeat(64)}.tar`,
  version: "d".repeat(40),
  character: "d",
});
const tofu = {
  kind: "tofu",
  stack: "cloudflare",
  archiveComponent: "archive:tofu-cloudflare",
  runner: { service: "ci", component: "image:ci-base" },
  steps: ["plan", "approve", "apply"].map((kind) => ({
    kind,
    instance: "stack:cloudflare",
  })),
  sharedLock: "platform",
};
const native = DeliveryJobReceiptSchema.parse({
  namespace: "delivery-platform-jobs",
  name: `delivery-${"9".repeat(40)}`,
  uid: "33333333-3333-4333-8333-333333333333",
  specFingerprint: "f".repeat(64),
  requestId: "deployment/1",
});
const now = Date.now();
const receipt = TofuPlanReceiptSchema.parse({
  schema: "delivery-tofu-plan/v1",
  deploymentId: "deployment/1",
  sourceBuildId: "build/1",
  sourceRevision: "a".repeat(40),
  stack: "cloudflare",
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
  planDigest: digest("7"),
  state: { lineage: "lineage-1", serial: 4 },
  nativeJob: native,
  changes: { create: 1, update: 0, delete: 0, replace: 0 },
});
const saved = {
  receipt,
  encryptedPlan: {
    algorithm: "aes-256-gcm",
    salt: btoa("s".repeat(16)),
    iv: btoa("i".repeat(12)),
    tag: btoa("t".repeat(16)),
    ciphertext: btoa("plan"),
  },
};
const plansPath = "platform/plans/deployment%2F1";

function current(
  stages: { key: string; status: "running" | "succeeded" | "failed" }[],
) {
  const value = detail(tofu, archive, stages);
  api.responses.set("deployments/deployment%2F1", value);
  return value;
}

function job(result: unknown) {
  const requests: DeliveryJobRequest[] = [];
  return {
    requests,
    run: async (
      request: DeliveryJobRequest,
      onReceipt: (received: DeliveryJobReceipt) => Promise<void>,
    ) => {
      requests.push(request);
      await onReceipt(native);
      return result;
    },
  };
}

function stageWrites() {
  return api.calls
    .filter((call) => call.path.endsWith("/stages"))
    .map((call) => call.body);
}

afterEach(() => {
  api.calls.splice(0);
  api.responses.clear();
});

describe("model tofu steps (section 5, X8)", () => {
  it("plans from the frozen stack archive and records the saved plan", async () => {
    current([]);
    const runner = job(saved);
    expect(
      await runDeliveryModelPlatformStep(
        "deployment/1",
        "step-plan",
        runner.run,
      ),
    ).toEqual({ waiting: false });
    expect(runner.requests[0]).toMatchObject({
      recipe: "tofu-plan",
      stageKey: "step-plan",
      sourceRevision: "a".repeat(40),
      input: {
        model: {
          kind: "plan",
          stack: "cloudflare",
          sourceBuildId: "build/1",
          sourceRevision: "a".repeat(40),
        },
        archive: { uri: archive.uri, digest: archive.digest },
      },
    });
    expect(api.calls.map((call) => call.path)).toContain("platform/plans");
    expect(stageWrites()).toEqual([
      expect.objectContaining({ key: "step-plan", status: "running" }),
      expect.objectContaining({ key: "step-plan", status: "succeeded" }),
    ]);
  });

  it("waits for a human approval of the exact saved plan", async () => {
    current([{ key: "step-plan", status: "succeeded" }]);
    expect(
      await runDeliveryModelPlatformStep("deployment/1", "step-approve"),
    ).toEqual({ waiting: true });
    current([
      { key: "step-plan", status: "succeeded" },
      { key: "step-approve", status: "running" },
      { key: "approve/plan", status: "succeeded" },
    ]);
    expect(
      await runDeliveryModelPlatformStep("deployment/1", "step-approve"),
    ).toEqual({ waiting: false });
    expect(stageWrites()).toEqual([
      expect.objectContaining({ key: "step-approve", status: "running" }),
      expect.objectContaining({ key: "step-approve", status: "succeeded" }),
    ]);
  });

  it("ends on a rejection: the approve step settles failed and nothing is applied", async () => {
    current([
      { key: "step-plan", status: "succeeded" },
      { key: "step-approve", status: "running" },
      { key: "approve/plan", status: "failed" },
    ]);
    await expect(
      runDeliveryModelPlatformStep("deployment/1", "step-approve"),
    ).rejects.toMatchObject({
      type: "DeliveryPlanRejected",
      nonRetryable: true,
    });
    // No stage is left running, so the failed deployment releases its locks.
    expect(stageWrites()).toEqual([
      expect.objectContaining({ key: "step-approve", status: "failed" }),
    ]);
    expect(api.calls.map((call) => call.path)).not.toContain(plansPath);
  });

  it("applies the saved plan this deployment produced and proves its state marker", async () => {
    const value = current([
      { key: "step-plan", status: "succeeded" },
      { key: "step-approve", status: "succeeded" },
    ]);
    api.responses.set(plansPath, saved);
    const recipe = requireModelRecipe(value);
    if (recipe.kind !== "tofu") throw new Error("Expected a tofu recipe");
    const runner = job({
      stack: "cloudflare",
      planDeploymentId: "deployment/1",
      planDigest: receipt.planDigest,
      outcome: "applied-saved-plan",
      state: { lineage: "lineage-1", serial: 5 },
      marker: {
        schema: "delivery-tofu-marker/v1",
        deploymentId: "deployment/1",
        stack: "cloudflare",
        stateLineage: "lineage-1",
        stateSerial: 5,
        archiveDigest: archive.digest,
        appliedAt: new Date(now).toISOString(),
      },
    });
    await runDeliveryModelPlatformStep(
      "deployment/1",
      "step-apply",
      runner.run,
    );
    expect(runner.requests[0]?.input).toEqual(
      modelApplyInput(value, recipe, receipt),
    );
    expect(stageWrites()).toContainEqual(
      expect.objectContaining({ key: "step-apply", status: "succeeded" }),
    );
  });
});
