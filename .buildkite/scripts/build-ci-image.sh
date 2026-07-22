#!/usr/bin/env bash
set -euo pipefail

# Rebuild the CI toolchain image from .mise.toml + .buildkite/ci-image.
# Registry layer cache makes a no-change rebuild near-free, so this runs on
# every main build — no VERSION file, no commit-back PR (unlike the old
# ci-base lifecycle). Steps always pull :latest.

IMAGE="ghcr.io/shepherdjerred/ci-base"
SHA="${BUILDKITE_COMMIT:?BUILDKITE_COMMIT is required}"

# Registry cache export needs a docker-container builder — dind's default
# docker driver cannot export cache. image-manifest=true keeps the cache
# manifest OCI-conformant for ghcr.
if ! docker buildx inspect ci; then
  docker buildx create --name ci --driver docker-container
fi

docker buildx build \
  --builder ci \
  --file .buildkite/ci-image/Dockerfile \
  --cache-from "type=registry,ref=${IMAGE}:buildcache" \
  --cache-to "type=registry,ref=${IMAGE}:buildcache,mode=max,image-manifest=true" \
  --tag "${IMAGE}:${SHA}" \
  --tag "${IMAGE}:latest" \
  --push \
  .
