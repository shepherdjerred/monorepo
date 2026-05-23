---
id: grafana-trace-log-prod-verification
status: waiting-on-verification
origin: packages/docs/logs/2026-05-19_grafana-trace-log-correlation.md
source_marker: false
---

# Phase 5: production click-path verification for "Logs for this span"

## What

The full trace↔log correlation pipeline shipped on 2026-05-19 (commit `59823f7c1`) — Tempo `tracesToLogsV2` mapping codified in cdk8s, OTLP-native logs from birmel + temporal-worker, Dagger CI `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` wired. Local docker-compose validation passed (Grafana datasource proxy returned the two correlated log lines for a synthetic span). Production click-path is unverified: the **Logs for this span** button on a real birmel / temporal-worker / dagger-ci-\* span in torvalds Grafana must return the matching log lines. Gated on ArgoCD sync of the `prometheus` Application.

## Why it's open

Phase 5 of the source plan (in `~/.claude/plans/`) is explicitly post-deploy verification. The originating session shipped through Phase 4 (local validation) and called Phase 5 out as remaining work.

## Done when

- ArgoCD `prometheus` Application synced and reconciled with the new Tempo `tracesToLogsV2` config.
- On torvalds Grafana, click **Logs for this span** on at least one trace from each of: birmel, temporal-worker, dagger-ci-\*. Each returns the matching log lines via `{service_name="…"} | trace_id="…"`.
- Screenshot or query URL captured for posterity.

## References

- Originating log: `packages/docs/logs/2026-05-19_grafana-trace-log-correlation.md`
- Trigger commit: `59823f7c1`
- Source plan: `~/.claude/plans/` (the trace↔log correlation plan, Phase 5 section)
- Datasource mapping: `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts:190`
