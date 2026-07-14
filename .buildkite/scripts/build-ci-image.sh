#!/usr/bin/env bash
set -euo pipefail

# Rebuild the CI toolchain image from .mise.toml + .buildkite/ci-image.
# Registry layer cache makes a no-change rebuild near-free, so this runs on
# every main build — no VERSION file, no commit-back PR (unlike the old
# ci-base lifecycle). Steps always pull :latest.

IMAGE="ghcr.io/shepherdjerred/ci-base"
SHA="${BUILDKITE_COMMIT:?BUILDKITE_COMMIT is required}"

docker buildx build \
  --file .buildkite/ci-image/Dockerfile \
  --cache-from "type=registry,ref=${IMAGE}:buildcache" \
  --cache-to "type=registry,ref=${IMAGE}:buildcache,mode=max" \
  --tag "${IMAGE}:${SHA}" \
  --tag "${IMAGE}:latest" \
  --push \
  .
