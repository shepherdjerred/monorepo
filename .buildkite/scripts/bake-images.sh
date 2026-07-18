#!/usr/bin/env bash
set -euo pipefail

# Build (+ smoke, + optionally push) the service/infra images via `docker
# buildx bake` (docker-bake.hcl at the repo root) — targets build in PARALLEL
# on one BuildKit daemon, replacing the old serial per-image loop.
#
#   --affected   PR mode: only bake targets whose owning turbo package is
#                affected (plus the three families turbo's nested --affected
#                under-selects — same workaround as the native shims).
#   --push       main mode: write per-target registry cache and push
#                :<sha> + :latest for every image after its smoke passes.
#
# Smoke scripts are invoked directly (not through `turbo run smoke`): the
# images are pre-built by bake, and turbo's smoke/docker:build tasks are
# cache:false, so no turbo caching is lost by bypassing the task graph.

REGISTRY="ghcr.io/shepherdjerred"
SHA="${BUILDKITE_COMMIT:?BUILDKITE_COMMIT is required}"
BUILD_NUMBER="${BUILDKITE_BUILD_NUMBER:?BUILDKITE_BUILD_NUMBER is required}"

AFFECTED_ONLY=false
PUSH=false
for arg in "$@"; do
  case "$arg" in
    --affected) AFFECTED_ONLY=true ;;
    --push) PUSH=true ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# bake target → owning turbo package → package dir with the `smoke` script.
# The four homelab infra images are one unit: the `homelab` package owns all
# of them and its smoke script asserts on all four.
APP_TARGETS=(
  "birmel|@shepherdjerred/birmel|packages/birmel"
  "tasknotes-server|tasknotes-server|packages/tasknotes-server"
  "starlight-karma-bot|starlight-karma-bot|packages/starlight-karma-bot"
  "streambot|@shepherdjerred/streambot|packages/streambot"
  "temporal-worker|@shepherdjerred/temporal|packages/temporal"
  "trmnl-dashboard|@shepherdjerred/trmnl-dashboard|packages/trmnl-dashboard"
  "scout-for-lol|@scout-for-lol/backend|packages/scout-for-lol/packages/backend"
  "discord-plays-pokemon|@discord-plays-pokemon/backend|packages/discord-plays-pokemon/packages/backend"
  "discord-plays-mario-kart|@discord-plays-mario-kart/backend|packages/discord-plays-mario-kart/packages/backend"
)
# turbo's nested --affected under-selects these families (documented in the
# old PR dry-run step); they always build on PRs until that bug is fixed.
ALWAYS_ON_TARGETS=(scout-for-lol discord-plays-pokemon discord-plays-mario-kart)
INFRA_IMAGES=(caddy-s3proxy obsidian-headless mcp-gateway redlib)

bake_targets=()
smoke_dirs=()
push_images=()

if [ "$AFFECTED_ONLY" = true ]; then
  # Fail loud if turbo ls breaks or changes shape — a tool error must never
  # read as "nothing affected".
  affected_json=$(bunx turbo ls --affected --output=json)
  echo "$affected_json" | jq -e '.packages.items' >/dev/null

  is_affected() {
    echo "$affected_json" | jq -e --arg n "$1" \
      '.packages.items[] | select(.name == $n)' >/dev/null
  }

  for entry in "${APP_TARGETS[@]}"; do
    target="${entry%%|*}"
    rest="${entry#*|}"
    pkg="${rest%%|*}"
    dir="${rest#*|}"
    always=false
    for a in "${ALWAYS_ON_TARGETS[@]}"; do
      if [ "$a" = "$target" ]; then always=true; fi
    done
    if [ "$always" = true ] || is_affected "$pkg"; then
      bake_targets+=("$target")
      smoke_dirs+=("$dir")
      push_images+=("$target")
    fi
  done
  if is_affected "homelab"; then
    bake_targets+=("infra")
    smoke_dirs+=("packages/homelab")
    push_images+=("${INFRA_IMAGES[@]}")
  fi
  if [ "${#bake_targets[@]}" -eq 0 ]; then
    echo "no image-owning packages affected — nothing to build"
    exit 0
  fi
else
  for entry in "${APP_TARGETS[@]}"; do
    target="${entry%%|*}"
    rest="${entry#*|}"
    dir="${rest#*|}"
    bake_targets+=("$target")
    smoke_dirs+=("$dir")
    push_images+=("$target")
  done
  bake_targets+=("infra")
  smoke_dirs+=("packages/homelab")
  push_images+=("${INFRA_IMAGES[@]}")
fi

# Registry cache export needs a docker-container builder — dind's default
# docker driver can't export cache. Used in both modes so the PR dry-run
# rehearses exactly what main runs (including the --load transfer).
if ! docker buildx inspect ci; then
  docker buildx create --name ci --driver docker-container
fi

PUSH_CACHE=false
if [ "$PUSH" = true ]; then
  PUSH_CACHE=true
fi

echo "--- :docker: bake ${bake_targets[*]}"
VERSION="$BUILD_NUMBER" GIT_SHA="$SHA" PUSH_CACHE="$PUSH_CACHE" \
  docker buildx bake --builder ci --load "${bake_targets[@]}"

# Smoke serially (containers contend on the daemon; assertions are cheap).
for dir in "${smoke_dirs[@]}"; do
  echo "--- :fire: smoke ${dir}"
  bun run --cwd "$dir" smoke
done

if [ "$PUSH" = true ]; then
  digest_args=()
  for name in "${push_images[@]}"; do
    echo "--- :arrow_up: push ${name}"
    docker tag "${name}:dev" "${REGISTRY}/${name}:${SHA}"
    docker tag "${name}:dev" "${REGISTRY}/${name}:latest"
    docker push "${REGISTRY}/${name}:${SHA}"
    docker push "${REGISTRY}/${name}:latest"
    # Record the pushed manifest digest for the version commit-back step
    # (versions.ts pins tag@digest; digest equality is its change gate).
    digest=$(docker inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "${REGISTRY}/${name}:${SHA}" \
      | grep -m1 "^${REGISTRY}/${name}@" | cut -d@ -f2)
    if [ -z "$digest" ]; then
      echo "no repo digest recorded for ${REGISTRY}/${name}:${SHA} after push" >&2
      exit 1
    fi
    digest_args+=(--arg "shepherdjerred/${name}" "$digest")
  done
  # One JSON object {"shepherdjerred/<image>": "sha256:..."} via build
  # meta-data, consumed by the version commit-back step.
  jq -n '$ARGS.named' "${digest_args[@]}" | buildkite-agent meta-data set image-digests
fi
