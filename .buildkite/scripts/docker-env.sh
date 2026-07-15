#!/usr/bin/env bash
# Docker preamble for the privileged image/e2e steps — `source`d after
# toolchain.sh. The dind sidecar (see pod_privileged in pipeline.yml) provides
# the daemon on tcp://127.0.0.1:2375; this ensures a client CLI exists (the
# fresh ci-base bakes one; the stale image doesn't) and waits for the daemon.
set -euo pipefail

if ! command -v docker >/dev/null; then
  # renovate: datasource=docker depName=docker versioning=docker
  DOCKER_CLI_VERSION="28.5.2"
  curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz" |
    tar xz --strip-components=1 -C /usr/local/bin docker/docker
fi

export DOCKER_HOST="${DOCKER_HOST:-tcp://127.0.0.1:2375}"

# Bounded wait for the dind sidecar to come up.
for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    exit_ready=1
    break
  fi
  sleep 1
done
if [ "${exit_ready:-0}" != "1" ]; then
  echo "docker daemon did not become ready within 60s" >&2
  docker info
  exit 1
fi
