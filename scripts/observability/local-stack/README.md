# Local trace ↔ log correlation stack

Runs Tempo + Loki + Grafana on `localhost:3000` to validate the
`tracesToLogsV2` mapping and the OTLP-logs path locally before pushing to
torvalds. Mirrors the production setup in `packages/homelab/src/cdk8s/`.

## Quick start

```bash
# Bring up the stack
docker compose up -d

# Emit one trace with two correlated log records
bun run emit-test-trace.ts

# Or emit five at once
bun run emit-test-trace.ts --count 5
```

Then open <http://localhost:3000> (auto-login as anonymous Admin) → **Explore**
→ datasource **tempo** → **Search** → pick a recent `test-emitter` trace →
click **Logs for this span**. The Loki panel should open with a query like
`{service_name="test-emitter"} | trace_id="<id>"` and return the log lines
emitted inside that span.

## Tear down

```bash
docker compose down -v   # -v also removes anonymous volumes
```

## What this validates

- **Phase 1** (datasource config): `grafana-datasources.yml` mirrors the cdk8s
  block at [prometheus.ts:190-208](../../../packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts:190).
  If you change one, change the other.
- **Phase 2** (OTLP logs from apps): `emit-test-trace.ts` uses the same OTel
  JS SDK + ordering that birmel and temporal-worker use. If the production
  init order breaks (e.g. someone moves the LoggerProvider construction
  after the global TracerProvider registration), the script's emit() would
  ECONNREFUSE here too.
- **Phase 3** (the old CI's Dagger logs endpoint): no longer applicable —
  the Dagger/Buildkite pipeline was removed 2026-07.
