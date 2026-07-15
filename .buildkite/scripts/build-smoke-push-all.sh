#!/usr/bin/env bash
set -euo pipefail

# Build + smoke + push every service image, one at a time. The build itself
# is each owner package's `docker:build` script (smoke dependsOn it in turbo);
# BuildKit registry cache makes unchanged images near-free on ephemeral pods.

REGISTRY="ghcr.io/shepherdjerred"
SHA="${BUILDKITE_COMMIT:?BUILDKITE_COMMIT is required}"
BUILD_NUMBER="${BUILDKITE_BUILD_NUMBER:?BUILDKITE_BUILD_NUMBER is required}"

# Bake the real version + sha into images (the Dockerfiles declare ARG
# VERSION/GIT_SHA with `dev`/`unknown` defaults for local builds).
VERSION_ARGS="--build-arg VERSION=${BUILD_NUMBER} --build-arg GIT_SHA=${SHA}"

# image name → turbo package filter that owns docker:build + smoke
IMAGES=(
  "birmel=@shepherdjerred/birmel"
  "tasknotes-server=tasknotes-server"
  "starlight-karma-bot=starlight-karma-bot"
  "streambot=@shepherdjerred/streambot"
  "temporal-worker=@shepherdjerred/temporal"
  "trmnl-dashboard=@shepherdjerred/trmnl-dashboard"
  "scout-for-lol=@scout-for-lol/backend"
  "discord-plays-pokemon=@discord-plays-pokemon/backend"
  "discord-plays-mario-kart=@discord-plays-mario-kart/backend"
)

for entry in "${IMAGES[@]}"; do
  name="${entry%%=*}"
  filter="${entry#*=}"
  echo "--- :docker: ${name}"
  DOCKER_BUILD_EXTRA_ARGS="${VERSION_ARGS} --cache-from type=registry,ref=${REGISTRY}/${name}:buildcache --cache-to type=registry,ref=${REGISTRY}/${name}:buildcache,mode=max" \
    bunx turbo run smoke --filter="${filter}"
  docker tag "${name}:dev" "${REGISTRY}/${name}:${SHA}"
  docker tag "${name}:dev" "${REGISTRY}/${name}:latest"
  docker push "${REGISTRY}/${name}:${SHA}"
  docker push "${REGISTRY}/${name}:latest"
done

# Homelab infra images build via the homelab package's umbrella scripts.
# (Self-contained contexts; they don't consume VERSION/GIT_SHA.)
echo "--- :docker: homelab infra images"
DOCKER_BUILD_EXTRA_ARGS="" bunx turbo run smoke --filter=homelab
for name in caddy-s3proxy obsidian-headless mcp-gateway redlib; do
  docker tag "${name}:dev" "${REGISTRY}/${name}:${SHA}"
  docker tag "${name}:dev" "${REGISTRY}/${name}:latest"
  docker push "${REGISTRY}/${name}:${SHA}"
  docker push "${REGISTRY}/${name}:latest"
done
