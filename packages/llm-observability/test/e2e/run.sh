#!/usr/bin/env bash
set -euo pipefail

# Compose-backed e2e: bring the stack up, run the suite, always tear down,
# and propagate the suite's exit code. Lives in bash because bun's package-
# script shell mis-handles the `ec=$?` capture chain (the suite never ran and
# the script exited 1 with no output).

cd "$(dirname "$0")/../.."

# --wait races with one-shot containers (minio-init exiting 0 fails it) and
# tempo's distroless image can't run an exec healthcheck at all. So: --wait
# only minio (real healthcheck), poll tempo's /ready from the host, then run
# the bucket init explicitly (deterministic exit code).
docker compose -f test/e2e/compose.yaml up -d --wait minio
docker compose -f test/e2e/compose.yaml up -d tempo
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:3200/ready >/dev/null 2>&1; then
    tempo_ready=1
    break
  fi
  sleep 1
done
if [ "${tempo_ready:-0}" != "1" ]; then
  echo "tempo did not become ready within 60s" >&2
  docker compose -f test/e2e/compose.yaml logs tempo
  docker compose -f test/e2e/compose.yaml down -v
  exit 1
fi
docker compose -f test/e2e/compose.yaml run --rm minio-init

set +e
bun test test/e2e
ec=$?
set -e

docker compose -f test/e2e/compose.yaml down -v
exit "$ec"
