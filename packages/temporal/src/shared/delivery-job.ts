import { z } from "zod";

export const DeliveryJobRequestSchema = z
  .object({
    deploymentId: z.string().min(1).max(160),
    stageKey: z.string().regex(/^[a-z0-9-]{1,64}$/u),
    recipe: z.enum([
      "worker-preflight",
      "worker-images",
      "worker-step",
      "root-release",
      "tofu-plan",
      "tofu-apply",
      "control-plane",
      "platform-recovery",
    ]),
    runnerImage: z
      .string()
      .regex(/^docker\.io\/shepherdjerred\/ci-base@sha256:[a-f0-9]{64}$/u),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
    input: z.unknown(),
  })
  .strict();
export type DeliveryJobRequest = z.infer<typeof DeliveryJobRequestSchema>;
export function deliveryJobNamespace(
  recipe: DeliveryJobRequest["recipe"],
): "delivery-worker-jobs" | "delivery-platform-jobs" {
  return ["worker-preflight", "worker-images", "worker-step"].includes(recipe)
    ? "delivery-worker-jobs"
    : "delivery-platform-jobs";
}
export const DeliveryJobReceiptSchema = z.object({
  namespace: z.enum(["delivery-worker-jobs", "delivery-platform-jobs"]),
  name: z.string(),
  uid: z.string().min(1),
  specFingerprint: z.string(),
  requestId: z.string(),
});
export type DeliveryJobReceipt = z.infer<typeof DeliveryJobReceiptSchema>;

export const DELIVERY_JOB_RESULT_PREFIX = "DELIVERY_JOB_RESULT_V1=";

/** Input is validated by the selected source-owned handler, never executed as shell. */
export const DELIVERY_JOB_BOOTSTRAP = `set -euo pipefail
unset OP_SERVICE_ACCOUNT_TOKEN
mkdir -p /workspace/source /workspace/home /workspace/tmp /workspace/bin /workspace/mise
cp -R /opt/mise/. /workspace/mise/
export MISE_DATA_DIR=/workspace/mise
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
git init -q /workspace/source
git -C /workspace/source fetch --quiet --depth=1 https://github.com/shepherdjerred/monorepo.git "$DELIVERY_SOURCE_REVISION"
git -C /workspace/source checkout --quiet --detach FETCH_HEAD
test "$(git -C /workspace/source rev-parse HEAD)" = "$DELIVERY_SOURCE_REVISION"
cd /workspace/source
mise trust .mise.toml
MISE_LOCKED=1 mise install --yes bun node gh jq helm argocd awscli opentofu aqua:temporalio/cli github:theseus-rs/postgresql-binaries
tool_paths=$(mise bin-paths bun node gh jq helm argocd awscli opentofu aqua:temporalio/cli github:theseus-rs/postgresql-binaries)
test -n "$tool_paths"
export PATH="$(echo "$tool_paths" | paste -sd:):$PATH"
bun install --frozen-lockfile
bunx turbo run generate build --filter=@shepherdjerred/temporal^...
bun build packages/toolkit/src/index.ts --compile --external ffmpeg-static --outfile=/workspace/bin/toolkit
export PATH="/workspace/bin:$PATH"
cd packages/temporal
bun scripts/jobs/run-delivery-job.ts
`;
