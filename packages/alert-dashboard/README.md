# Alerts

`@shepherdjerred/alert-dashboard` is the homelab's durable, read-only alert
ledger. Alertmanager remains authoritative for evaluation, grouping,
inhibition, routing, and silences; this service stores occurrence history,
provides a tailnet dashboard/API, sends grouped opening email through Postal,
and offers bounded Grafana-backed Prometheus, Loki, and Tempo previews.

## Local development

From the repository root, start PostgreSQL separately, then set the required
environment and run:

```bash
bun install
cd packages/alert-dashboard
bun run generate
bun run dev
```

Required configuration is validated at startup: `DATABASE_URL`,
`ALERTMANAGER_URL`, `ALERT_DASHBOARD_WEBHOOK_TOKEN`, `GRAFANA_URL`, and
`GRAFANA_API_KEY`. Set `EMAIL_ENABLED=true` only with `POSTAL_HOST`,
`POSTAL_API_KEY`, `POSTAL_FROM`, and `POSTAL_TO` present.

The API listens on port 7341 and Vite on 7342. Alertmanager posts official v4
webhooks to `POST /internal/v1/alertmanager/events` with a bearer token. Public
read-only REST routes live under `/api/v1`; the UI and tRPC transport share the
same process in production.

## Verification

```bash
bun run typecheck
bun run test
bun run lint
bun run build
```

Production deployment is intentionally gated on making the newly-created GHCR
package public and pinning its real digest in `versions.ts`.
