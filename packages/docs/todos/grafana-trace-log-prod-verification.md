---
id: grafana-trace-log-prod-verification
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-05-19_grafana-trace-log-correlation.md
source_marker: false
---

# Phase 5: production click-path verification for "Logs for this span"

## Evidence

The Tempo datasource on the live Grafana (`grafana.tailnet-1a49.ts.net`) carries the correct
`tracesToLogsV2` config: `datasourceUid: loki`, `filterByTraceID: true`, span time shifts ±5m,
and a `service.name → service_name` tag map. So the config that powers the "Logs for this span"
button is present and correct. What I could **not** confirm from the API: live data flow — a
quick Tempo search and Loki label query returned 0 in my window, so I couldn't eyeball an actual
trace→log jump. Keep open for the one manual click on a real span; the wiring itself is done.

## What

The full trace-to-log correlation pipeline shipped on 2026-05-19 (commit
`59823f7c1`): Tempo `tracesToLogsV2` mapping codified in cdk8s and OTLP-native
logs from birmel and temporal-worker. Local docker-compose validation passed.
The former Dagger CI tracer was removed with the static Buildkite replatform;
the current `.buildkite/pipeline.yml` has no OTLP exporter configuration, so CI
is no longer part of this production acceptance criterion.

## Why it's open

Phase 5 of the source plan (in `~/.claude/plans/`) is explicitly post-deploy verification. The originating session shipped through Phase 4 (local validation) and called Phase 5 out as remaining work.

## Done when

- ArgoCD `prometheus` Application synced and reconciled with the new Tempo `tracesToLogsV2` config.
- On torvalds Grafana, use **Logs for this span** on at least one trace from each
  of birmel and temporal-worker. Each returns matching log lines via
  `{service_name="..."} | trace_id="..."`.
- Screenshot or query URL captured for posterity.

## Remaining

- [x] Confirm a recent birmel trace returns Loki lines with the same trace ID.
- [ ] Find a recent temporal-worker trace whose span emits a correlated log.
- [ ] Use **Logs for this span** for that temporal-worker trace and record the
      trace ID, query window, and deployment version.

## References

- Originating log: `packages/docs/logs/2026-05-19_grafana-trace-log-correlation.md`
- Trigger commit: `59823f7c1`
- Source plan: `~/.claude/plans/` (the trace↔log correlation plan, Phase 5 section)
- Datasource mapping: `packages/homelab/src/cdk8s/src/resources/argo-applications/grafana-values.ts`

## Comment Log

### 2026-07-27 — Awaiting-human audit

The datasource mapping is present in `grafana-values.ts`; only live data-flow
observation remains. A browser click with an explicit trace-ID result is an
agent-operable production check, not subjective UAT.

### 2026-07-27 — Partial production verification

Birmel trace `8359cac2a26d294b7db7c47e31c37510` exists in Tempo and contains
the `job.aggregate-activity` parent span with Prisma child spans. The equivalent
Loki query, `{service_name="birmel"} |
trace_id="8359cac2a26d294b7db7c47e31c37510"`, returned the matching `Starting
activity aggregation` and `Activity aggregation completed` lines at
`2026-07-27T19:44:35Z`. Birmel correlation is verified.

Tempo also returned temporal-worker trace
`53558599786ee18d5054b254de0c9e1d`, but Loki returned no temporal-worker line
with that trace ID and no trace-correlated temporal-worker logs over the
preceding seven days. Keep the card active for the missing temporal-worker
evidence rather than asking for user acceptance.
