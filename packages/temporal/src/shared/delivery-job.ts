import { z } from "zod";

/** A stack archive fetched by digest from the Delivery artifact bucket (X8). */
export const DeliveryJobArchiveSchema = z
  .object({
    uri: z.string().regex(/^s3:\/\/delivery-artifacts\/\S+$/u),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();
export type DeliveryJobArchive = z.infer<typeof DeliveryJobArchiveSchema>;

export const DeliveryJobRequestSchema = z
  .object({
    deploymentId: z.string().min(1).max(160),
    stageKey: z.string().regex(/^[a-z0-9-]{1,64}$/u),
    recipe: z.enum([
      "worker-preflight",
      "worker-images",
      "worker-step",
      "test",
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
  return ["worker-preflight", "worker-images", "worker-step", "test"].includes(
    recipe,
  )
    ? "delivery-worker-jobs"
    : "delivery-platform-jobs";
}
/** The archive a Job request names, when its input selects archive mode. */
export function deliveryJobArchive(
  request: Pick<DeliveryJobRequest, "recipe" | "input">,
): DeliveryJobArchive | undefined {
  if (request.recipe !== "tofu-plan" && request.recipe !== "tofu-apply")
    return undefined;
  const wrapper = z
    .object({ archive: z.unknown().optional() })
    .loose()
    .safeParse(request.input);
  if (!wrapper.success || wrapper.data.archive === undefined) return undefined;
  // A present archive is validated strictly; a malformed one never degrades to source mode.
  return DeliveryJobArchiveSchema.parse(wrapper.data.archive);
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

/** Archive bytes are read from the artifact store and verified by digest before use. */
export const DELIVERY_ARCHIVE_ENDPOINT =
  "https://seaweedfs-s3.tailnet-1a49.ts.net";

/**
 * Input is validated by the selected source-owned handler, never executed as shell.
 *
 * The workspace is an emptyDir on liskov's OS disk, so every byte written here
 * wears that drive. The image toolchain is linked, not copied: version
 * directories hold symlinks into the read-only image, while mise's per-tool
 * metadata and alias links are real copies, so mise still sees every image
 * tool as installed and adds only a version the image lacks. Image provenance
 * runs only its read-only inspection path, so it installs the Temporal
 * workspace's runtime closure instead of every workspace's packages.
 */
export const DELIVERY_JOB_BOOTSTRAP = String.raw`set -euo pipefail
unset OP_SERVICE_ACCOUNT_TOKEN
mkdir -p /workspace/source /workspace/home /workspace/tmp /workspace/bin /workspace/mise
cp -Rs /opt/mise/. /workspace/mise/
(cd /opt/mise && find installs -mindepth 1 -maxdepth 2 ! -type d -exec cp -PT --remove-destination {} /workspace/mise/{} \;)
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
recipe=$(jq -er '.recipe' <<< "$DELIVERY_JOB_REQUEST")
if [ "$recipe" = worker-images ]; then
  bun install --frozen-lockfile --production --filter=@shepherdjerred/temporal
else
  bun install --frozen-lockfile
  bunx turbo run generate --filter=@shepherdjerred/temporal^...
  bun run --cwd packages/llm-models build:runtime
  bun build packages/toolkit/src/index.ts --compile --external ffmpeg-static --outfile=/workspace/bin/toolkit
  export PATH="/workspace/bin:$PATH"
fi
if [ "$recipe" = test ]; then
  test_workspace=$(jq -er '.input.workspace' <<< "$DELIVERY_JOB_REQUEST")
  bunx turbo run generate --filter="{./$test_workspace}..."
fi
archive_uri=$(jq -r '.input.archive.uri // empty' <<< "$DELIVERY_JOB_REQUEST")
if [ -n "$archive_uri" ]; then
  archive_digest=$(jq -er '.input.archive.digest' <<< "$DELIVERY_JOB_REQUEST")
  mkdir -p /workspace/stack
  AWS_ACCESS_KEY_ID="$DELIVERY_ARCHIVE_READER_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$DELIVERY_ARCHIVE_READER_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=us-east-1 AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED aws --endpoint-url ${DELIVERY_ARCHIVE_ENDPOINT} s3 cp "$archive_uri" /workspace/tmp/stack-archive.tar --no-progress
  observed_digest="sha256:$(sha256sum /workspace/tmp/stack-archive.tar | cut -d' ' -f1)"
  test "$observed_digest" = "$archive_digest"
  tar -xf /workspace/tmp/stack-archive.tar -C /workspace/stack
  export DELIVERY_STACK_ARCHIVE_DIR=/workspace/stack
fi
cd packages/temporal
bun scripts/jobs/run-delivery-job.ts
`;

/**
 * Bootstraps of earlier releases, accepted only when adopting or recovering a
 * Job one of them created; a new Job always runs DELIVERY_JOB_BOOTSTRAP.
 * Remove an entry once no retained Job or recovery receipt can still name it.
 */
export const PREVIOUS_DELIVERY_JOB_BOOTSTRAPS: readonly string[] = [
  // Linked the image toolchain; ran no test-workspace or stack-archive step.
  String.raw`set -euo pipefail
unset OP_SERVICE_ACCOUNT_TOKEN
mkdir -p /workspace/source /workspace/home /workspace/tmp /workspace/bin /workspace/mise
cp -Rs /opt/mise/. /workspace/mise/
(cd /opt/mise && find installs -mindepth 1 -maxdepth 2 ! -type d -exec cp -PT --remove-destination {} /workspace/mise/{} \;)
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
if [ "$(jq -er '.recipe' <<< "$DELIVERY_JOB_REQUEST")" = worker-images ]; then
  bun install --frozen-lockfile --production --filter=@shepherdjerred/temporal
else
  bun install --frozen-lockfile
  bunx turbo run generate --filter=@shepherdjerred/temporal^...
  bun run --cwd packages/llm-models build:runtime
  bun build packages/toolkit/src/index.ts --compile --external ffmpeg-static --outfile=/workspace/bin/toolkit
  export PATH="/workspace/bin:$PATH"
fi
cd packages/temporal
bun scripts/jobs/run-delivery-job.ts
`,
  // Copied the whole image toolchain and installed every workspace for image provenance.
  `set -euo pipefail
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
if [ "$(jq -er '.recipe' <<< "$DELIVERY_JOB_REQUEST")" != worker-images ]; then
  bunx turbo run generate --filter=@shepherdjerred/temporal^...
  bun run --cwd packages/llm-models build:runtime
  bun build packages/toolkit/src/index.ts --compile --external ffmpeg-static --outfile=/workspace/bin/toolkit
  export PATH="/workspace/bin:$PATH"
fi
cd packages/temporal
bun scripts/jobs/run-delivery-job.ts
`,
];
