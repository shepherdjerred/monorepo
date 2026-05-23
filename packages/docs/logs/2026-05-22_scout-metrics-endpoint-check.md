# Scout Metrics Endpoint Check

## Status

Complete

## Summary

Checked the live Scout backend metrics endpoints through the Kubernetes API proxy:

- Beta: `scout-service-beta.scout-beta.svc:3000/metrics`
- Prod: `scout-service-prod.scout-prod.svc:3000/metrics`

Both pods were ready with zero restarts, both services had endpoints, and Prometheus reported `up=1` for both targets.

## Findings

- Beta exported `environment="beta"`, `version="2.0.0-2635"`, `git_sha="7bbd6f8ea89deb1ed43fe43d7365c28b1b60ac53"`.
- Prod exported `environment="prod"`, `version="2.0.0-2473"`, `git_sha="6610ecf15763e2738328dc665eb9b4bfba5ae34f"`.
- A parser check found zero malformed samples, non-finite values, counter negatives, histogram bucket regressions, or `+Inf`/`_count` mismatches.
- Dynamic usage gauges matched live SQLite counts exactly in both environments:
  - Beta: 28 players, 41 accounts, 28 subscriptions, 3 active competitions, 12 total competitions, 1 server with data, 279 joined competition participants, 9 active reports.
  - Prod: 73 players, 93 accounts, 66 subscriptions, 4 active competitions, 13 total competitions, 18 servers with data, 23 joined competition participants.
- Beta provider-health gauges were inactive: `ai_provider_issue_active` was `0` for OpenAI quota and rate-limit labels.
- Beta had two recorded spectator timeouts: `riot_api_requests_total{source="spectator",status="timeout"} 2` and `riot_api_errors_total{source="spectator",http_status="unknown"} 2`.

## Caveats

- Prod is on an older image and does not have the `Report`/`ReportRun` schema or newer scheduled-report/AI-provider metric families. That is expected from the deployed version skew, but dashboards that expect `scheduled_reports_*` will currently only show beta data.
- Scheduled-report run counters are process counters since the current beta pod started, not full historical DB totals.

## Session Log — 2026-05-22

### Done

- Loaded relevant Scout, Kubernetes, TypeScript, League, and Grafana guidance.
- Used `toolkit recall search` for prior Scout metrics context.
- Inspected Scout `/metrics` implementation and homelab service wiring.
- Hit beta and prod `/healthz` and `/metrics` endpoints via Kubernetes API proxy.
- Ran deterministic Prometheus exposition consistency checks over full endpoint snapshots.
- Queried live SQLite inside both pods with read-only Bun SQLite queries and compared usage gauges against DB counts.
- Verified Prometheus is scraping both services with `up=1`.
- Wrote this log at `packages/docs/logs/2026-05-22_scout-metrics-endpoint-check.md`.

### Remaining

- Decide whether prod should be promoted to a newer Scout image so scheduled-report and AI-provider metrics exist in prod too.

### Caveats

- Local `bun`/`python3` shims were blocked by untrusted `.mise.toml`; read-only parsing used `/usr/bin/python3`.
- The local worktree's `versions.ts` shows beta `2.0.0-2572`, while the live beta pod reports `2.0.0-2635`; treat the live cluster as the source of truth for this check.
