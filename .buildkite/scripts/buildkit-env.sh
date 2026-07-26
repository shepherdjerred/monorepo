#!/usr/bin/env bash
# Remote BuildKit preamble for CI image solves. The Docker CLI is only a
# BuildKit client here: no daemon, DOCKER_HOST, Compose plugin, or DinD sidecar
# is involved.
set -euo pipefail

if [ -n "${GH_TOKEN:-}" ]; then
  printf '%s' "$GH_TOKEN" | docker login ghcr.io -u shepherdjerred --password-stdin
fi
