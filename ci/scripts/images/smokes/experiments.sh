#!/bin/sh
set -eu

cd /app/packages/experiments
export HOST=127.0.0.1 PORT=17407 INTERNAL_PORT=17408 ENVIRONMENT=test
export DATABASE_URL=postgresql://localhost/experiments
export EXPERIMENTS_MACHINE_TOKEN=fixture-machine-token
export EXPERIMENTS_HUB_TOKEN=fixture-hub-token
export EXPERIMENTS_PUBLIC_ORIGIN=http://127.0.0.1:17407
export EXPERIMENTS_OPERATOR_LOGINS=fixture@example.test
export EXPERIMENTS_INGRESS_IDENTITY_DIR=/tmp/experiments-smoke-ingress

bun src/index.ts >/tmp/experiments-smoke.log 2>&1 &
pid=$!
trap 'if kill -0 "$pid"; then kill "$pid"; wait "$pid" || test "$?" -eq 143; fi' EXIT
for _ in $(seq 1 30); do
  if bun -e 'const health = await fetch("http://127.0.0.1:17407/healthz"); if (!health.ok) process.exit(1);'; then
    exit 0
  fi
  if ! kill -0 "$pid"; then break; fi
  sleep 1
done

cat /tmp/experiments-smoke.log
exit 1
