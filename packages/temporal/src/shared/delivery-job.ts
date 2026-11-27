import { z } from "zod";
import {
  DELIVERY_STAGE_WORKSPACE_CLAIMS,
  type DeliveryStageWorkspaceProfile,
} from "homelab/src/delivery-stage-admission.ts";

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
/**
 * The persistent workspace a recipe runs in. Image provenance installs only
 * the Temporal workspace's production closure; every other recipe installs
 * every workspace, and the two must not alternate on one claim.
 */
export function deliveryStageWorkspaceProfile(
  recipe: DeliveryJobRequest["recipe"],
): DeliveryStageWorkspaceProfile {
  return recipe === "worker-images" ? "production" : "full";
}
export function deliveryStageWorkspaceClaim(
  recipe: DeliveryJobRequest["recipe"],
): string {
  return DELIVERY_STAGE_WORKSPACE_CLAIMS[deliveryStageWorkspaceProfile(recipe)]
    .claim;
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
  // A present archive is validated strictly; a malformed one never degrades to source mode.
  return !wrapper.success || wrapper.data.archive === undefined
    ? undefined
    : DeliveryJobArchiveSchema.parse(wrapper.data.archive);
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

/**
 * Where a worker rollout Job prepares a candidate revision other than its own:
 * a tree the stage claim keeps across Jobs beside `/workspace/source`, so each
 * candidate writes only its difference from the previous one.
 */
export const DELIVERY_JOB_CANDIDATE_CHECKOUT = "/workspace/candidate";

/** Archive bytes are read from the artifact store and verified by digest before use. */
export const DELIVERY_ARCHIVE_ENDPOINT =
  "https://seaweedfs-s3.tailnet-1a49.ts.net";

/**
 * Tools a Job installs through `MISE_LOCKED=1 mise install`, from the
 * checked-out revision's own `.mise.toml` and `mise.lock`. The Job runs the
 * executor's source revision, which can predate the CI image's pins: mise
 * installs a tool version the image lacks only from a checksum that revision's
 * lockfile records. A tool is therefore installed only when its recipe runs it.
 * Image provenance runs `git`, the image's `docker` and `helm template`, from
 * Bun. `jq` is installed first because the bootstrap reads the recipe with it.
 */
export const DELIVERY_JOB_IMAGE_PROVENANCE_TOOLS = "bun node jq helm";
/** Every other recipe; `awscli` is not here (see DELIVERY_JOB_AWS_TOOLS). */
export const DELIVERY_JOB_FULL_TOOLS =
  "bun node gh jq helm argocd opentofu aqua:temporalio/cli github:theseus-rs/postgresql-binaries";
/**
 * `aws` runs in the stack-archive download and in OpenTofu stacks whose
 * `local-exec` provisioners call it (SeaweedFS), so OpenTofu recipes and any
 * archive download install it. Revisions before the awscli 2.41 pin record no
 * linux-x64 checksum for it, which locked mode cannot install; no other recipe
 * runs it.
 */
export const DELIVERY_JOB_AWS_TOOLS = "awscli";

/**
 * Input is validated by the selected source-owned handler, never executed as shell.
 *
 * `/workspace` is the persistent stage claim of the recipe's install profile
 * (`deliveryStageWorkspaceClaim`), reused by every Job of that profile. The
 * lock serializes Jobs that share it: Kueue admits one stage Job at a time,
 * and the lock covers a Job still queued on the CI-shared LocalQueue. Each Job
 * discards the previous Job's scratch and extracted stack archive (a stale
 * member, such as HCL a stack no longer has, would otherwise join the next
 * archive's configuration).
 *
 * Source. `/workspace/git` is a bare object store kept across Jobs, so a
 * depth-1 fetch negotiates against the previous revision (its
 * `delivery-checkout` branch) and downloads only what changed; with no ref to
 * offer, the same fetch downloads the whole ~670 MB tree. Only its objects,
 * shallow boundary and that one ref survive: every other file in it
 * (configuration, hooks, locks, alternates, derived indexes) is removed and
 * rebuilt, and `git fsck --full` must verify every kept object, or the Job
 * says so on stderr and starts from an empty store. `/workspace/source/.git`
 * is created fresh for every Job and borrows the store's objects through
 * alternates, so nothing a Job does in its repository (a candidate's fetch or
 * configuration) outlives it. The checkout starts from an index with no stat
 * data: `update-index --refresh` hashes every tracked file against the
 * revision's tree and `reset --hard` rewrites only the files whose content
 * differs, so the tree equals the revision whatever an earlier Job left, while
 * an unchanged file is never rewritten. Everything untracked except
 * `node_modules`, nested repositories included, is removed, and the tracked
 * tree must then report no modification. The store is repacked to the current
 * revision's objects once it holds more than eight packs, and unreachable loose
 * objects are pruned, so it holds about one revision.
 *
 * Generated code, `llm-models`' runtime build and the toolkit binary depend
 * only on the checked-out revision, its lockfile's `node_modules`, the runner
 * image and this script, which together form the prepared-outputs key. A full
 * install that generated them keeps hard links to every untracked output and
 * the binary in `/workspace/prepared` with a sha256 manifest and that key. A
 * later Job with the same key restores them as hard links only if every file
 * still matches the manifest and nothing was added; otherwise it regenerates
 * as before. Test recipes, which generate more, always regenerate and discard
 * the kept outputs. The image toolchain is re-linked, not copied: version
 * directories hold symlinks into the read-only image, while mise's per-tool
 * metadata and alias links are real copies, so mise still sees every image
 * tool as installed and adds only a version the image lacks. Image provenance
 * runs only its read-only inspection path, so it installs the Temporal
 * workspace's runtime closure instead of every workspace's packages, and the
 * tool set is the recipe's own (DELIVERY_JOB_*_TOOLS).
 */
export const DELIVERY_JOB_BOOTSTRAP = String.raw`set -euo pipefail
unset OP_SERVICE_ACCOUNT_TOKEN
exec 9>/workspace/.lock
flock 9
rm -rf /workspace/tmp /workspace/bin /workspace/buildx /workspace/stack
mkdir -p /workspace/source /workspace/home /workspace/tmp /workspace/bin /workspace/mise /workspace/git/objects/pack
cp -Rsf /opt/mise/. /workspace/mise/
(cd /opt/mise && find installs -mindepth 1 -maxdepth 2 ! -type d -exec cp -PT --remove-destination {} /workspace/mise/{} \;)
export MISE_DATA_DIR=/workspace/mise
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
previous=
[ ! -f /workspace/git/refs/heads/delivery-checkout ] || previous=$(cat /workspace/git/refs/heads/delivery-checkout)
find /workspace/git -mindepth 1 -maxdepth 1 ! -name objects ! -name shallow -exec rm -rf {} +
rm -rf /workspace/git/objects/info
find /workspace/git/objects/pack -type f ! -name 'pack-*.idx' ! -name 'pack-*.pack' -delete
for pack in /workspace/git/objects/pack/pack-*.pack; do [ -e "$(dirname "$pack")/$(basename "$pack" .pack).idx" ] || rm -f "$pack"; done
git init -q --bare --initial-branch=delivery-checkout /workspace/git
if [ -n "$previous" ] && ! { [[ $previous =~ ^[0-9a-f]{40}$ ]] && git --git-dir=/workspace/git update-ref refs/heads/delivery-checkout "$previous" && git --git-dir=/workspace/git fsck --full --no-dangling --no-progress; }; then
  echo "Delivery stage workspace: the kept Git object store failed verification; this Job fetches a fresh one" >&2
  previous=
fi
if [ -z "$previous" ]; then
  rm -rf /workspace/git
  git init -q --bare --initial-branch=delivery-checkout /workspace/git
fi
git --git-dir=/workspace/git fetch --quiet --no-tags --no-auto-maintenance --depth=1 https://github.com/shepherdjerred/monorepo.git "$DELIVERY_SOURCE_REVISION"
git --git-dir=/workspace/git update-ref refs/heads/delivery-checkout "$DELIVERY_SOURCE_REVISION"
rm -rf /workspace/source/.git
git init -q /workspace/source
echo /workspace/git/objects >/workspace/source/.git/objects/info/alternates
[ ! -f /workspace/git/shallow ] || cp /workspace/git/shallow /workspace/source/.git/shallow
git -C /workspace/source update-ref --no-deref HEAD "$DELIVERY_SOURCE_REVISION"
git -C /workspace/source read-tree HEAD
git -C /workspace/source update-index -q --refresh
git -C /workspace/source reset -q --hard
git -C /workspace/source clean -ffdxq -e node_modules
test "$(git -C /workspace/source rev-parse HEAD)" = "$DELIVERY_SOURCE_REVISION"
test -z "$(git -C /workspace/source status --porcelain=v1 --untracked-files=no)"
if [ "$(find /workspace/git/objects/pack -name 'pack-*.pack' | wc -l)" -gt 8 ]; then
  git --git-dir=/workspace/git -c repack.writeBitmaps=false repack -a -d -q
fi
git --git-dir=/workspace/git prune --expire=now
cd /workspace/source
mise trust .mise.toml
MISE_LOCKED=1 mise install --yes jq
jq_paths=$(mise bin-paths jq)
test -n "$jq_paths"
export PATH="$(echo "$jq_paths" | paste -sd:):$PATH"
recipe=$(jq -er '.recipe' <<< "$DELIVERY_JOB_REQUEST")
archive_uri=$(jq -r '.input.archive.uri // empty' <<< "$DELIVERY_JOB_REQUEST")
if [ "$recipe" = worker-images ]; then
  tools="${DELIVERY_JOB_IMAGE_PROVENANCE_TOOLS}"
else
  tools="${DELIVERY_JOB_FULL_TOOLS}"
fi
if [ -n "$archive_uri" ] || [ "$recipe" = tofu-plan ] || [ "$recipe" = tofu-apply ]; then
  tools="$tools ${DELIVERY_JOB_AWS_TOOLS}"
fi
MISE_LOCKED=1 mise install --yes $tools
tool_paths=$(mise bin-paths $tools)
test -n "$tool_paths"
export PATH="$(echo "$tool_paths" | paste -sd:):$PATH"
if [ "$recipe" = worker-images ]; then
  bun install --frozen-lockfile --production --filter=@shepherdjerred/temporal
else
  bun install --frozen-lockfile
  prepared_key=$(printf '%s\n' "$DELIVERY_SOURCE_REVISION" "$(jq -er '.runnerImage' <<< "$DELIVERY_JOB_REQUEST")" "$BASH_EXECUTION_STRING" | sha256sum | cut -d' ' -f1)
  if [ "$recipe" = test ] || ! bun packages/temporal/scripts/jobs/prepared-outputs.ts restore "$prepared_key"; then
    rm -rf /workspace/prepared
    bunx turbo run generate --filter=@shepherdjerred/temporal^...
    bun run --cwd packages/llm-models build:runtime
    bun build packages/toolkit/src/index.ts --compile --external ffmpeg-static --outfile=/workspace/bin/toolkit
    [ "$recipe" = test ] || bun packages/temporal/scripts/jobs/prepared-outputs.ts keep "$prepared_key" || echo "Delivery stage workspace: prepared outputs were not kept" >&2
  fi
  export PATH="/workspace/bin:$PATH"
fi
if [ "$recipe" = test ]; then
  test_workspace=$(jq -er '.input.workspace' <<< "$DELIVERY_JOB_REQUEST")
  bunx turbo run generate --filter="{./$test_workspace}..."
fi
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
  // Prepared a fresh emptyDir workspace on the OS disk for every Job.
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
`,
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
  // Kept every fetched revision's objects in the claim's repository.
  String.raw`set -euo pipefail
unset OP_SERVICE_ACCOUNT_TOKEN
exec 9>/workspace/.lock
flock 9
rm -rf /workspace/tmp /workspace/bin /workspace/buildx
mkdir -p /workspace/source /workspace/home /workspace/tmp /workspace/bin /workspace/mise
cp -Rsf /opt/mise/. /workspace/mise/
(cd /opt/mise && find installs -mindepth 1 -maxdepth 2 ! -type d -exec cp -PT --remove-destination {} /workspace/mise/{} \;)
export MISE_DATA_DIR=/workspace/mise
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
git init -q /workspace/source
git -C /workspace/source fetch --quiet --depth=1 https://github.com/shepherdjerred/monorepo.git "$DELIVERY_SOURCE_REVISION"
git -C /workspace/source checkout --quiet --detach --force FETCH_HEAD
git -C /workspace/source worktree prune
git -C /workspace/source clean -fdxq -e node_modules
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
`,
  // Extracted a stack archive over the previous Job's extracted stack.
  String.raw`set -euo pipefail
unset OP_SERVICE_ACCOUNT_TOKEN
exec 9>/workspace/.lock
flock 9
rm -rf /workspace/tmp /workspace/bin /workspace/buildx
mkdir -p /workspace/source /workspace/home /workspace/tmp /workspace/bin /workspace/mise
cp -Rsf /opt/mise/. /workspace/mise/
(cd /opt/mise && find installs -mindepth 1 -maxdepth 2 ! -type d -exec cp -PT --remove-destination {} /workspace/mise/{} \;)
export MISE_DATA_DIR=/workspace/mise
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
rm -rf /workspace/source/.git
git init -q /workspace/source
git -C /workspace/source fetch --quiet --depth=1 https://github.com/shepherdjerred/monorepo.git "$DELIVERY_SOURCE_REVISION"
git -C /workspace/source checkout --quiet --detach --force FETCH_HEAD
git -C /workspace/source clean -fdxq -e node_modules
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
`,
  // Installed the full tool set, awscli included, for every recipe.
  String.raw`set -euo pipefail
unset OP_SERVICE_ACCOUNT_TOKEN
exec 9>/workspace/.lock
flock 9
rm -rf /workspace/tmp /workspace/bin /workspace/buildx /workspace/stack
mkdir -p /workspace/source /workspace/home /workspace/tmp /workspace/bin /workspace/mise
cp -Rsf /opt/mise/. /workspace/mise/
(cd /opt/mise && find installs -mindepth 1 -maxdepth 2 ! -type d -exec cp -PT --remove-destination {} /workspace/mise/{} \;)
export MISE_DATA_DIR=/workspace/mise
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
rm -rf /workspace/source/.git
git init -q /workspace/source
git -C /workspace/source fetch --quiet --depth=1 https://github.com/shepherdjerred/monorepo.git "$DELIVERY_SOURCE_REVISION"
git -C /workspace/source checkout --quiet --detach --force FETCH_HEAD
git -C /workspace/source clean -fdxq -e node_modules
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
`,
  // Removed the claim's repository and fetched the whole tree for every Job.
  String.raw`set -euo pipefail
unset OP_SERVICE_ACCOUNT_TOKEN
exec 9>/workspace/.lock
flock 9
rm -rf /workspace/tmp /workspace/bin /workspace/buildx /workspace/stack
mkdir -p /workspace/source /workspace/home /workspace/tmp /workspace/bin /workspace/mise
cp -Rsf /opt/mise/. /workspace/mise/
(cd /opt/mise && find installs -mindepth 1 -maxdepth 2 ! -type d -exec cp -PT --remove-destination {} /workspace/mise/{} \;)
export MISE_DATA_DIR=/workspace/mise
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
rm -rf /workspace/source/.git
git init -q /workspace/source
git -C /workspace/source fetch --quiet --depth=1 https://github.com/shepherdjerred/monorepo.git "$DELIVERY_SOURCE_REVISION"
git -C /workspace/source checkout --quiet --detach --force FETCH_HEAD
git -C /workspace/source clean -fdxq -e node_modules
test "$(git -C /workspace/source rev-parse HEAD)" = "$DELIVERY_SOURCE_REVISION"
cd /workspace/source
mise trust .mise.toml
MISE_LOCKED=1 mise install --yes jq
jq_paths=$(mise bin-paths jq)
test -n "$jq_paths"
export PATH="$(echo "$jq_paths" | paste -sd:):$PATH"
recipe=$(jq -er '.recipe' <<< "$DELIVERY_JOB_REQUEST")
archive_uri=$(jq -r '.input.archive.uri // empty' <<< "$DELIVERY_JOB_REQUEST")
if [ "$recipe" = worker-images ]; then
  tools="bun node jq helm"
else
  tools="bun node gh jq helm argocd opentofu aqua:temporalio/cli github:theseus-rs/postgresql-binaries"
fi
if [ -n "$archive_uri" ] || [ "$recipe" = tofu-plan ] || [ "$recipe" = tofu-apply ]; then
  tools="$tools awscli"
fi
MISE_LOCKED=1 mise install --yes $tools
tool_paths=$(mise bin-paths $tools)
test -n "$tool_paths"
export PATH="$(echo "$tool_paths" | paste -sd:):$PATH"
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
if [ -n "$archive_uri" ]; then
  archive_digest=$(jq -er '.input.archive.digest' <<< "$DELIVERY_JOB_REQUEST")
  mkdir -p /workspace/stack
  AWS_ACCESS_KEY_ID="$DELIVERY_ARCHIVE_READER_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$DELIVERY_ARCHIVE_READER_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=us-east-1 AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED aws --endpoint-url https://seaweedfs-s3.tailnet-1a49.ts.net s3 cp "$archive_uri" /workspace/tmp/stack-archive.tar --no-progress
  observed_digest="sha256:$(sha256sum /workspace/tmp/stack-archive.tar | cut -d' ' -f1)"
  test "$observed_digest" = "$archive_digest"
  tar -xf /workspace/tmp/stack-archive.tar -C /workspace/stack
  export DELIVERY_STACK_ARCHIVE_DIR=/workspace/stack
fi
cd packages/temporal
bun scripts/jobs/run-delivery-job.ts
`,
];
