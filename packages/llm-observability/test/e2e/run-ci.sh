#!/usr/bin/env bash
set -euo pipefail

# Tempo and MinIO are native sidecars in the Buildkite pod. All pod containers
# share localhost, so the existing test constants remain the public contract.
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3200/ready; then
    bun test test/e2e
    exit 0
  fi
  sleep 1
done

echo "Tempo did not become ready within 60s" >&2
exit 1
