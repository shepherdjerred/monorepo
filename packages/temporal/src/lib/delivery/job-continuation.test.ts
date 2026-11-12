import { expect, test, vi } from "vitest";
import { KubeConfig } from "@kubernetes/client-node";
import { getOrCreateDeliveryJob, runDeliveryJob } from "./job.ts";
import { deliveryJobManifest } from "./job-manifest.ts";
import { DELIVERY_JOB_REQUEST_MAX_BYTES } from "./job-request-limit.ts";

function fixture() {
  const expected = deliveryJobManifest({
    deploymentId: "continuation/1",
    stageKey: "tofu-apply",
    recipe: "tofu-apply",
    runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
    sourceRevision: "b".repeat(40),
    input: { stack: "github" },
  });
  const native = structuredClone(expected);
  native.metadata!.uid = crypto.randomUUID();
  native.status = {
    conditions: [{ type: "Complete", status: "True" }],
    active: 0,
  };
  const prior = {
    namespace: "delivery-platform-jobs" as const,
    name: native.metadata!.name!,
    uid: native.metadata!.uid,
    specFingerprint:
      native.metadata!.annotations!["delivery.shepherdjerred.com/fingerprint"]!,
    requestId: "continuation/1",
  };
  const create = vi.fn(async () => native);
  return {
    expected,
    native,
    prior,
    create,
    api: {
      readNamespacedJob: vi.fn(async () => native),
      createNamespacedJob: create,
    },
  };
}
test("resumes only the exact persisted native Job after executor replacement without another create", async () => {
  const { expected, native, prior, create, api } = fixture();
  expect(
    await getOrCreateDeliveryJob(api, expected, prior, {
      createIfAbsent: false,
      expectedReceipt: prior,
    }),
  ).toBe(native);
  expect(create).not.toHaveBeenCalled();
});
test("missing or replaced Jobs never recreate side effects, including a persisted intent without UID", async () => {
  const { expected, native, prior, create, api } = fixture();
  api.readNamespacedJob.mockRejectedValue({ code: 404 });
  await expect(
    getOrCreateDeliveryJob(api, expected, prior, {
      createIfAbsent: false,
    }),
  ).rejects.toThrow("absent");
  await expect(
    getOrCreateDeliveryJob(api, expected, prior, {
      createIfAbsent: true,
      expectedReceipt: prior,
    }),
  ).rejects.toThrow("absent");
  const replaced = structuredClone(native);
  replaced.metadata!.uid = crypto.randomUUID();
  api.readNamespacedJob.mockResolvedValue(replaced);
  await expect(
    getOrCreateDeliveryJob(api, expected, prior, {
      createIfAbsent: false,
      expectedReceipt: prior,
    }),
  ).rejects.toThrow("incarnation");
  expect(create).not.toHaveBeenCalled();
});
test("a request its container could never exec is refused before any Kubernetes call", async () => {
  const kubernetes = new KubeConfig();
  // Nothing listens here: reaching the API would fail with a connection error.
  kubernetes.loadFromOptions({
    clusters: [{ name: "fixture", server: "http://127.0.0.1:9" }],
    users: [{ name: "fixture" }],
    contexts: [{ name: "fixture", cluster: "fixture", user: "fixture" }],
    currentContext: "fixture",
  });
  const receipts = vi.fn<() => Promise<void>>();
  await expect(
    runDeliveryJob(
      {
        deploymentId: "oversized/1",
        stageKey: "worker-image-provenance",
        recipe: "worker-images",
        runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
        sourceRevision: "b".repeat(40),
        input: { pool: "x".repeat(DELIVERY_JOB_REQUEST_MAX_BYTES) },
      },
      receipts,
      undefined,
      {
        kubernetes,
        heartbeat: vi.fn(),
        cancellationSignal: new AbortController().signal,
      },
    ),
  ).rejects.toMatchObject({
    type: "DeliveryJobRequestTooLarge",
    nonRetryable: true,
  });
  expect(receipts).not.toHaveBeenCalled();
});
