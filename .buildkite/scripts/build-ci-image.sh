#!/usr/bin/env bash
set -euo pipefail

# Rebuild the CI toolchain image from .mise.toml + .buildkite/ci-image.
# Registry layer cache makes a no-change rebuild near-free, so this runs on
# every main build — no VERSION file, no commit-back PR (unlike the old
# ci-base lifecycle). Steps always pull :latest.

SHA="${BUILDKITE_COMMIT:?BUILDKITE_COMMIT is required}"

# The shared BuildKit daemon writes the cache once to its bounded PVC and
# pushes directly to GHCR. No local Docker daemon is required.
if ! docker buildx inspect ci; then
  docker buildx create --name ci --driver remote tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234
fi

build_and_push() {
  local image=$1
  local dockerfile=$2

  docker buildx build \
    --builder ci \
    --file "$dockerfile" \
    --cache-from "type=registry,ref=${image}:buildcache" \
    --cache-to "type=registry,ref=${image}:buildcache,mode=max,image-manifest=true" \
    --tag "${image}:${SHA}" \
    --tag "${image}:latest" \
    --push \
    .
}

build_and_push "ghcr.io/shepherdjerred/ci-base" ".buildkite/ci-image/Dockerfile"
build_and_push "ghcr.io/shepherdjerred/ci-playwright" ".buildkite/ci-playwright/Dockerfile"
