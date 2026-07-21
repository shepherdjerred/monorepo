#!/usr/bin/env bash
set -euo pipefail

# Build (+ smoke, + optionally push) the service/infra images via `docker
# buildx bake` (docker-bake.hcl at the repo root) — targets build in PARALLEL
# on one BuildKit daemon, replacing the old serial per-image loop.
#
#   --affected   PR mode: only bake targets whose owned workspace closure is
#                affected, selected without Turbo or node_modules.
#   --push       main mode: write per-target registry cache and push
#                :<sha> + :latest for every image after its smoke passes.
#   --target X   fixed benchmark mode: build and smoke only named bake targets;
#                repeatable, and deliberately incompatible with --push.
#
# Smoke scripts are invoked directly (not through `turbo run smoke`): the
# images are pre-built by bake, and turbo's smoke/docker:build tasks are
# cache:false, so no turbo caching is lost by bypassing the task graph.

REGISTRY="ghcr.io/shepherdjerred"
SHA="${BUILDKITE_COMMIT:?BUILDKITE_COMMIT is required}"
BUILD_NUMBER="${BUILDKITE_BUILD_NUMBER:?BUILDKITE_BUILD_NUMBER is required}"

AFFECTED_ONLY=false
PUSH=false
EXPLICIT_TARGETS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --affected)
      AFFECTED_ONLY=true
      shift
      ;;
    --push)
      PUSH=true
      shift
      ;;
    --target)
      if [ "$#" -lt 2 ]; then
        echo "--target requires a bake target" >&2
        exit 2
      fi
      EXPLICIT_TARGETS+=("$2")
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ "${#EXPLICIT_TARGETS[@]}" -gt 0 ] && { [ "$AFFECTED_ONLY" = true ] || [ "$PUSH" = true ]; }; then
  echo "--target cannot be combined with --affected or --push" >&2
  exit 2
fi

# bake target → package dir with the `smoke` script.
# The four homelab infra images are one unit: the `homelab` package owns all
# of them and its smoke script asserts on all four.
APP_TARGETS=(
  "birmel|packages/birmel"
  "tasknotes-server|packages/tasknotes-server"
  "starlight-karma-bot|packages/starlight-karma-bot"
  "streambot|packages/streambot"
  "temporal-worker|packages/temporal"
  "trmnl-dashboard|packages/trmnl-dashboard"
  "scout-for-lol|packages/scout-for-lol/packages/backend"
  "discord-plays-pokemon|packages/discord-plays-pokemon/packages/backend"
  "discord-plays-mario-kart|packages/discord-plays-mario-kart/packages/backend"
)
INFRA_IMAGES=(caddy-s3proxy obsidian-headless mcp-gateway redlib)
KNOWN_TARGETS_JSON=$(printf '%s\n' "${APP_TARGETS[@]%%|*}" infra | jq -R . | jq -s 'sort')

bake_targets=()
smoke_dirs=()
push_images=()

# Scope selection. PRs diff against their merge-base with origin/main. Main
# diffs against the LAST GREEN MAIN BUILD's commit: every
# image validated+pushed at that commit is guaranteed output-identical here
# (digests are content-gated), so rebuilding it moves gigabytes through an
# ephemeral BuildKit for a no-op — most merges touch no image-owning package
# at all. If the lookup fails, degrade LOUDLY to building everything — more
# work, never a silent skip.
scope="all"
scope_base=""
if [ "${#EXPLICIT_TARGETS[@]}" -gt 0 ]; then
  scope="explicit"
  selected_json=$(printf '%s\n' "${EXPLICIT_TARGETS[@]}" | jq -R . | jq -s 'unique | sort')
  if ! printf '%s' "$selected_json" | jq -e --argjson known "$KNOWN_TARGETS_JSON" \
    'length > 0 and all(.[]; type == "string" and (. as $target | $known | index($target) != null))' >/dev/null; then
    echo "--target includes an unknown image target" >&2
    exit 2
  fi
elif [ "$AFFECTED_ONLY" = true ]; then
  if scope_base=$(git merge-base origin/main HEAD); then
    scope="affected"
  else
    echo "WARN: could not resolve merge-base with origin/main — building ALL images"
  fi
elif [ "$PUSH" = true ]; then
  if resp=$(curl -fsS --connect-timeout 5 --max-time 20 --retry 2 --retry-delay 1 \
      -H "Authorization: Bearer ${BUILDKITE_API_TOKEN}" \
      "https://api.buildkite.com/v2/organizations/sjerred/pipelines/monorepo/builds?branch=main&state=passed&per_page=1") \
    && last_green=$(printf '%s' "$resp" | jq -r '.[0].commit // empty') \
    && [ -n "$last_green" ] \
    && git cat-file -e "${last_green}^{commit}"; then
    scope="affected"
    scope_base="$last_green"
    echo "images scoped to changes since last green main build ($last_green)"
  else
    echo "WARN: could not resolve last green main build — building ALL images"
  fi
fi

if [ "$scope" = "affected" ]; then
  # The dependency-free selector returns a deterministic JSON target list.
  # Any selector/tool/schema failure builds everything: selection can only
  # save work, never omit a required image.
  if selected_json=$(bun .buildkite/scripts/select-image-targets.ts --base "$scope_base") \
    && printf '%s' "$selected_json" | jq -e --argjson known "$KNOWN_TARGETS_JSON" \
      'type == "array" and all(.[]; type == "string" and (. as $target | $known | index($target) != null))' >/dev/null; then
    echo "selected image targets: $selected_json"
  else
    echo "WARN: image selector failed — building ALL images"
    scope="all"
  fi

fi

is_selected() {
  printf '%s' "$selected_json" | jq -e --arg target "$1" \
    'index($target) != null' >/dev/null
}

if [ "$scope" = "affected" ] || [ "$scope" = "explicit" ]; then
  for entry in "${APP_TARGETS[@]}"; do
    target="${entry%%|*}"
    dir="${entry#*|}"
    if is_selected "$target"; then
      bake_targets+=("$target")
      smoke_dirs+=("$dir")
      push_images+=("$target")
    fi
  done
  if is_selected "infra"; then
    bake_targets+=("infra")
    smoke_dirs+=("packages/homelab")
    push_images+=("${INFRA_IMAGES[@]}")
  fi
  if [ "${#bake_targets[@]}" -eq 0 ]; then
    echo "no image-owning packages affected — nothing to build"
    jq -n '{selectedBakeTargets: [], images: []}' > image-build-manifest.json
    if [ "$PUSH" = true ]; then
      # The version commit-back step reads this unconditionally.
      jq -n '{}' | buildkite-agent meta-data set image-digests
    fi
    exit 0
  fi
fi

if [ "$scope" = "all" ]; then
  selected_json=$KNOWN_TARGETS_JSON
  for entry in "${APP_TARGETS[@]}"; do
    target="${entry%%|*}"
    dir="${entry#*|}"
    bake_targets+=("$target")
    smoke_dirs+=("$dir")
    push_images+=("$target")
  done
  bake_targets+=("infra")
  smoke_dirs+=("packages/homelab")
  push_images+=("${INFRA_IMAGES[@]}")
fi

# Production stays on the current docker-container builder. The opt-in
# benchmark may select Docker's default builder only after the helper verifies
# that this isolated daemon has the containerd image store enabled.
BUILDX_BUILDER=$(bash .buildkite/scripts/configure-buildx-driver.sh)
IMAGE_VERSION="${CI_IMAGE_VERSION:-$BUILD_NUMBER}"

if [ -n "${CI_BUILDX_METADATA_PATH:-}" ]; then
  docker_version=$(docker version --format '{{json .}}')
  docker_info=$(docker info --format '{{json .}}')
  buildx_version=$(docker buildx version)
  builder_details=$(docker buildx inspect "$BUILDX_BUILDER")
  jq -n \
    --arg mode "${CI_BUILDX_MODE:-docker-container}" \
    --arg builder "$BUILDX_BUILDER" \
    --arg commit "$SHA" \
    --arg benchmarkId "${CI_IO_BUILDX_BENCHMARK_ID:-}" \
    --arg imageVersion "$IMAGE_VERSION" \
    --arg readCache "${CI_BUILDX_READ_CACHE:-true}" \
    --arg buildxVersion "$buildx_version" \
    --arg builderDetails "$builder_details" \
    --argjson dockerVersion "$docker_version" \
    --argjson dockerInfo "$docker_info" \
    '{mode: $mode, builder: $builder, commit: $commit, benchmarkId: $benchmarkId, imageVersion: $imageVersion, readCache: ($readCache == "true"), buildxVersion: $buildxVersion, builderDetails: $builderDetails, dockerVersion: $dockerVersion, dockerInfo: $dockerInfo}' \
    > "$CI_BUILDX_METADATA_PATH"
fi

PUSH_CACHE=false
if [ "$PUSH" = true ]; then
  PUSH_CACHE=true
fi
READ_CACHE=${CI_BUILDX_READ_CACHE:-true}
if [ "$READ_CACHE" != true ] && [ "$READ_CACHE" != false ]; then
  echo "CI_BUILDX_READ_CACHE must be true or false" >&2
  exit 2
fi

echo "--- :docker: bake ${bake_targets[*]}"
VERSION="$IMAGE_VERSION" GIT_SHA="$SHA" PUSH_CACHE="$PUSH_CACHE" READ_CACHE="$READ_CACHE" \
  docker buildx bake --builder "$BUILDX_BUILDER" --load "${bake_targets[@]}"

# Smoke serially (containers contend on the daemon; assertions are cheap).
for dir in "${smoke_dirs[@]}"; do
  echo "--- :fire: smoke ${dir}"
  if [ -n "${CADDYFILE_SMOKE_PATH:-}" ]; then
    CADDYFILE_SMOKE_PATH="$CADDYFILE_SMOKE_PATH" bun run --cwd "$dir" smoke
  else
    bun run --cwd "$dir" smoke
  fi
done

# Machine-readable output for CI I/O/driver A-B comparisons. The local image ID
# covers config identity; RootFS layer IDs cover filesystem content. Because
# this is emitted only after every smoke command succeeds, smokePassed is a
# fail-closed statement rather than an optimistic status.
manifest_entries=()
for name in "${push_images[@]}"; do
  layers=$(docker inspect --format '{{json .RootFS.Layers}}' "${name}:dev" | jq -c .)
  image_id=$(docker inspect --format '{{.Id}}' "${name}:dev")
  image_os=$(docker inspect --format '{{.Os}}' "${name}:dev")
  image_architecture=$(docker inspect --format '{{.Architecture}}' "${name}:dev")
  manifest_entries+=("$(jq -cn \
    --arg target "$name" \
    --arg image "${name}:dev" \
    --arg imageId "$image_id" \
    --arg os "$image_os" \
    --arg architecture "$image_architecture" \
    --argjson rootfsLayers "$layers" \
    '{target: $target, image: $image, imageId: $imageId, rootfsLayers: $rootfsLayers, os: $os, architecture: $architecture, smokePassed: true}')")
done
printf '%s\n' "${manifest_entries[@]}" | jq -s --argjson selectedBakeTargets "$selected_json" \
  '{selectedBakeTargets: $selectedBakeTargets, images: sort_by(.target)}' > image-build-manifest.json

if [ "$PUSH" = true ]; then
  VERSIONS_TS="packages/homelab/src/cdk8s/src/versions.ts"
  digest_args=()
  for name in "${push_images[@]}"; do
    echo "--- :arrow_up: push ${name}"
    docker tag "${name}:dev" "${REGISTRY}/${name}:${SHA}"
    docker tag "${name}:dev" "${REGISTRY}/${name}:latest"
    docker push "${REGISTRY}/${name}:${SHA}"
    docker push "${REGISTRY}/${name}:latest"
    # Record the pushed manifest digest for the version commit-back step
    # (versions.ts pins tag@digest).
    digest=$(docker inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "${REGISTRY}/${name}:${SHA}" \
      | grep -m1 "^${REGISTRY}/${name}@" | cut -d@ -f2)
    if [ -z "$digest" ]; then
      echo "no repo digest recorded for ${REGISTRY}/${name}:${SHA} after push" >&2
      exit 1
    fi
    # CONTENT gate, not manifest gate: VERSION/GIT_SHA are baked into every
    # image's config, so the MANIFEST digest changes every build even for
    # byte-identical content — gating the version bump on it would make each
    # bump build produce "new" digests and open the next bump PR forever
    # (the image-flavored version of the cooklang release loop; the old CI
    # avoided it only via change detection). The rootfs layer chain ignores
    # config-only changes: identical content => identical layers. Compare the
    # fresh image's layers against the currently-pinned digest's and only
    # report a digest when the CONTENT differs.
    pinned=""
    for key in "shepherdjerred/${name}" "shepherdjerred/${name}/beta"; do
      if pin_lines=$(grep -A1 "\"${key}\"" "$VERSIONS_TS"); then
        if pinned=$(printf '%s' "$pin_lines" | grep -om1 "sha256:[a-f0-9]*"); then
          break
        fi
      fi
    done
    if [ -n "$pinned" ]; then
      # imagetools failure (e.g. a placeholder pin that was never pushed)
      # counts as changed — the safe direction is an extra bump, never a
      # skipped one. These images are single-platform (bake runs with --load,
      # which only supports one platform), so a pinned digest always resolves
      # to an image manifest: .Image is populated and .Image.RootFS.DiffIDs is
      # a real array, never the `null` that a multi-platform manifest-list
      # index would yield.
      if old_layers=$(docker buildx imagetools inspect "${REGISTRY}/${name}@${pinned}" --format '{{json .Image.RootFS.DiffIDs}}' | jq -c .); then
        # imagetools pretty-prints its JSON while docker inspect emits compact
        # JSON, so normalize both before comparing the same uncompressed IDs.
        new_layers=$(docker inspect --format '{{json .RootFS.Layers}}' "${name}:dev" | jq -c .)
        if [ "$old_layers" = "$new_layers" ]; then
          echo "content unchanged vs pinned ${pinned} (identical rootfs) — no version bump for ${name}"
          continue
        fi
        echo "content CHANGED vs pinned ${pinned} — will bump ${name}"
      else
        echo "pinned digest ${pinned} for ${name} not resolvable — treating as changed"
      fi
    else
      echo "no existing versions.ts pin found for ${name} — will bump"
    fi
    digest_args+=(--arg "shepherdjerred/${name}" "$digest")
  done
  # One JSON object {"shepherdjerred/<image>": "sha256:..."} via build
  # meta-data, consumed by the version commit-back step. May be empty when
  # no image's content changed — the commit-back then no-ops.
  jq -n '$ARGS.named' "${digest_args[@]}" | buildkite-agent meta-data set image-digests
fi
