import { DELIVERY_ARCHIVE_ENDPOINT } from "#shared/delivery-job.ts";

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
