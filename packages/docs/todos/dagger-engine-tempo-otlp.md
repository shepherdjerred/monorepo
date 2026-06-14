---
id: dagger-engine-tempo-otlp
status: active
origin: packages/docs/plans/2026-06-14_streambot-stutter-rate-mismatch.md
---

# Dagger engine should export OTLP traces to in-cluster Tempo

## Context

Surfaced during the streambot stutter e2e (2026-06-14): the Dagger e2e run's trace
landed at `dagger.cloud/sjerred/traces/181ed6d8fef881a02e40d00032e5dca7` even though
homelab has Tempo running. Two things conspired:

1. The dagger engine StatefulSet has **zero `OTEL_*` env vars** — it never tries to
   export OTLP anywhere. Confirmed via
   `kubectl -n dagger get sts dagger-dagger-helm-engine -o yaml`.
2. The local dagger CLI is authenticated to Dagger Cloud (sjerred org), which is
   its default sink when a token is present. The trace I observed was the CLI's,
   not the engine's.

Tempo IS up and listening:

```
tempo  tempo  ClusterIP  10.111.160.236  4317/TCP (gRPC OTLP), 4318/TCP (HTTP OTLP), …
```

## Fix

Add `engine.env` to the Helm values block in
`packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts` (lines
273-350 — the `engine: {…}` Helm values block; the chart's values type already
exposes `engine.env?: unknown[]`):

```ts
engine: {
  kind: "StatefulSet",
  port: 8080,
  env: [
    { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "http://tempo.tempo.svc.cluster.local:4317" },
    { name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "grpc" },
    { name: "OTEL_SERVICE_NAME", value: "dagger-engine" },
  ],
  // …existing fields…
}
```

## Caveats to think through before shipping

- **CLI-side dual-sink.** Even after the engine exports to Tempo, CLI-driven runs
  from a laptop still push to dagger.cloud if `DAGGER_CLOUD_TOKEN` is set. If the
  goal is "no SaaS dependency for homelab traces," the CLI needs its own OTLP
  config (or the token unset). Decide whether dual-sink is acceptable.
- **Tempo retention.** Verify the homelab Tempo retention/storage config can
  absorb dagger's per-call span volume (hundreds of spans per CI build).
- **Service-name collisions** with other OTLP exporters in the cluster — pick a
  unique `OTEL_SERVICE_NAME` so Tempo's service dropdown stays clean.

## Verification

After deploy:

1. Run any `dagger call …` and confirm a trace appears in the Tempo Grafana data
   source within ~30 s.
2. `kubectl -n dagger get sts dagger-dagger-helm-engine -o jsonpath='{.spec.template.spec.containers[0].env}'`
   shows the new env vars.
3. `kubectl -n dagger logs sts/dagger-dagger-helm-engine | grep -i otel` — no
   exporter errors.
