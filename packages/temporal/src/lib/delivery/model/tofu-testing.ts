import { TofuPlanReceiptSchema } from "@shepherdjerred/delivery/contract";
import { DeliveryJobReceiptSchema } from "#shared/delivery-job.ts";
import { artifact, digest } from "./testing.ts";

/** Test fixtures for a model tofu recipe: tofu-cloudflare/prod planned from its stack archive. */
export const tofuArchive = artifact({
  id: "archive/tofu-cloudflare",
  component: "archive:tofu-cloudflare",
  kind: "archive",
  uri: `s3://delivery-artifacts/tofu/cloudflare/${"d".repeat(64)}.tar`,
  version: "d".repeat(40),
  character: "d",
});

export const tofuRecipe = {
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

/** The plan step's native Job. */
export const tofuNativeJob = DeliveryJobReceiptSchema.parse({
  namespace: "delivery-platform-jobs",
  name: `delivery-${"9".repeat(40)}`,
  uid: "33333333-3333-4333-8333-333333333333",
  specFingerprint: "f".repeat(64),
  requestId: "deployment/1",
});

const now = Date.now();
/** The plan the plan step saved, valid for an hour. */
export const tofuPlanReceipt = TofuPlanReceiptSchema.parse({
  schema: "delivery-tofu-plan/v1",
  deploymentId: "deployment/1",
  sourceBuildId: "build/1",
  sourceRevision: "a".repeat(40),
  stack: "cloudflare",
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
  planDigest: digest("7"),
  state: { lineage: "lineage-1", serial: 4 },
  nativeJob: tofuNativeJob,
  changes: { create: 1, update: 0, delete: 0, replace: 0 },
});

/** The saved plan record `platform/plans/<deployment>` serves. */
export const savedTofuPlan = {
  receipt: tofuPlanReceipt,
  encryptedPlan: {
    algorithm: "aes-256-gcm",
    salt: btoa("s".repeat(16)),
    iv: btoa("i".repeat(12)),
    tag: btoa("t".repeat(16)),
    ciphertext: btoa("plan"),
  },
};
