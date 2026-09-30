---
title: Enable Mac usage metrics
description: Turn on the toolkit history daemon's OTLP push so personal Claude Code, Codex, and subscription quota usage reaches Prometheus and the operations overview.
sidebar:
  order: 16
---

The `toolkit history` daemon can push personal AI usage to Prometheus. The push
is off by default. Enable it once per Mac, after the Alloy gateway's
`otlp-metrics` tailnet host is deployed.

1. Install the current toolkit binary. The launchd daemon runs
   `~/.local/bin/toolkit`.

   ```bash
   cd packages/toolkit && bun run install:local
   ```

2. Enable the push in `~/.toolkit/config.toml`. Use the file rather than an
   environment variable, because the daemon's launchd plist sets no
   environment.

   ```toml
   [history.metrics.push]
   enabled = true
   ```

3. Restart the daemon. It reads configuration once at boot.

   ```bash
   toolkit history daemon stop && toolkit history daemon start
   ```

4. Confirm the daemon log at `~/.toolkit/history/logs/daemon-<date>.log`
   contains `usage metrics push enabled`, followed by
   `usage metrics ledger refreshed` with `seeded=true`.

5. Confirm the series in Prometheus:

   ```bash
   toolkit prom query 'ai_usage_tokens_total{job="toolkit-history"}'
   ```

:::note
Counters start at zero on the first run. The export ledger records existing
history without exporting it, so usage before enablement never appears.
:::

## Settings

| Setting                         | Environment variable            | `config.toml` key               | Default                                               |
| ------------------------------- | ------------------------------- | ------------------------------- | ----------------------------------------------------- |
| Push enabled                    | `HISTORY_METRICS_PUSH_ENABLED`  | `history.metrics.push.enabled`  | `false`                                               |
| Push endpoint                   | `HISTORY_METRICS_PUSH_ENDPOINT` | `history.metrics.push.endpoint` | `https://otlp-metrics.tailnet-1a49.ts.net/v1/metrics` |
| Ops dashboard for `toolkit ops` | `OPS_DASHBOARD_URL`             | `ops.dashboard.url`             | `https://ops.tailnet-1a49.ts.net`                     |

Environment variables override the file, and the file overrides the default.
An invalid value is an error, not a fallback.

## If the metrics do not arrive

- `usage metrics export failed` in the daemon log means the endpoint is
  unreachable. Check that this Mac is on the tailnet and that the
  `otlp-metrics` host resolves.
- Metrics that reach Alloy but not Prometheus are usually dropped by name.
  The receiver forwards only `ai_usage_*` and `ai_subscription_*` series.
- No `ai_subscription_*` series means Brim has not written its snapshot cache
  yet. The daemon skips quota metrics until that file exists.

## Related

- [Operations overview](/explanation/homelab/operations-overview/) — why the
  push is one-way and how the counters stay monotonic.
- [QuotaBar](/explanation/quotabar/) — the source of subscription quota data.
