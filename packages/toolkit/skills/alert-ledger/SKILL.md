---
name: alert-ledger
description: Query the read-only Alerts occurrence ledger with `toolkit alerts`. Use for active-alert checks, historical opened or resolved range queries, alert search and filtering, or inspection of one occurrence's lifecycle events.
---

# Alert Ledger

Use the repository's `toolkit alerts` command for operational alert history. The
service is read-only: do not attempt acknowledgement, assignment, manual
resolution, or silence changes through it.

## Query occurrences

Run from the monorepo or use an installed `toolkit` binary:

```bash
toolkit alerts list --state open
toolkit alerts list --severity critical --namespace storage
toolkit alerts list --search DiskFull --json
toolkit alerts list --opened-from 2026-08-03T00:00:00Z --opened-to 2026-08-10T00:00:00Z
toolkit alerts list --resolved-from 2026-08-03T00:00:00Z --resolved-to 2026-08-10T00:00:00Z
```

Combine `--state`, `--severity`, `--namespace`, `--alertname`, `--search`, and
the independent opened/resolved range flags as needed. Use RFC 3339 instants for
range boundaries. Omit `--limit` to follow every API cursor; set it when a
bounded result is sufficient. Prefer `--json` when another program will consume
the result.

## Inspect lifecycle evidence

Take an occurrence ID from the list output and inspect its timeline:

```bash
toolkit alerts show <occurrence-id>
toolkit alerts show <occurrence-id> --json
```

Report lifecycle and suppression state separately. A resolved occurrence may
have `resolutionSource=webhook` or `resolutionSource=reconciled`; do not infer
acknowledgement or human action from either value.

## Connection boundary

`ALERT_DASHBOARD_URL` overrides the default tailnet endpoint. An unavailable
endpoint is an operational error, not evidence that no alerts exist. During the
staged PagerDuty migration, use the retained `toolkit pd` command only when the
Alerts service has not yet been activated.
