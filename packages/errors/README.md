# @shepherdjerred/errors

First-party error tracking service for the homelab monorepo, replacing Bugsink while remaining drop-in compatible with Sentry SDK v10/v11 envelope transport (`@sentry/bun`, `@sentry/browser`, `sentry-sdk`, and Rust Sentry clients).

## Architecture

The package enforces strict five-layer module boundaries via `@shepherdjerred/architecture`:

- `src/shared/contract.ts` — Zod wire schemas, constants, and DSN builder shared by server, client, and workspace consumers (`@shepherdjerred/errors/contract`).
- `src/domain/` — Pure, deterministic envelope decompression/parsing, SHA-256 fingerprinting, LLM-ready Markdown stacktrace rendering, issue lifecycle state transitions, and token-bucket rate limiting.
- `src/infrastructure/` — Prisma PostgreSQL 18 and in-memory repositories, canonical project seeds, full Bugsink REST API importer, `@shepherdjerred/mail` transactional email outbox, Tracker `AI` tRPC issue client, feature-flag configuration, and Prometheus/OpenTelemetry telemetry.
- `src/server/` — Dual-listener Hono HTTP apps:
  - `ingest-app.ts` (`ERRORS_INGEST_PORT`, e.g. `7371`): exposes **only** `GET /healthz` and `OPTIONS`/`POST /api/:projectId/envelope(/)` for public Cloudflare Tunnel and in-cluster SDK traffic; returns `404` JSON on all other paths.
  - `admin-app.ts` (`PORT`, default `7370`): Tailscale-gated web console SPA, `/api/v1/*` management & read APIs, `/metrics`, `/readyz`, and legacy Bugsink `301` URL redirects.
- `src/client/` — React 19 + TanStack Query + `@shepherdjerred/console-ui` SPA.

## Bootstrap Environment Variables

| Variable                      | Default                                         | Description                                                                       |
| ----------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`                | _(required)_                                    | PostgreSQL connection URL                                                         |
| `HOST`                        | `0.0.0.0`                                       | Listener bind address                                                             |
| `PORT`                        | `7370`                                          | Tailscale console + `/api/v1/*` listener port                                     |
| `ERRORS_INGEST_PORT`          | _(unset)_                                       | Optional dedicated public/cluster ingest-only listener port (e.g. `7371`)         |
| `PUBLIC_INGEST_ORIGIN`        | `https://logging.sjer.red`                      | Public DSN origin                                                                 |
| `CONSOLE_PUBLIC_ORIGIN`       | `https://errors.tailnet-1a49.ts.net`            | Tailnet console origin used in alert links and ops summaries                      |
| `ERRORS_MACHINE_TOKEN`        | _(unset)_                                       | Optional Bearer token for machine mutations when `Tailscale-User-Login` is absent |
| `TRACKER_API_URL`             | `http://tracker.tracker.svc.cluster.local:7351` | Tracker tRPC base URL                                                             |
| `TRACKER_PUBLIC_URL`          | `https://tracker.tailnet-1a49.ts.net`           | Tracker browser URL                                                               |
| `MAIL_API_URL`                | _(unset)_                                       | `@shepherdjerred/mail` HTTP API base URL                                          |
| `MAIL_API_TOKEN`              | _(unset)_                                       | `@shepherdjerred/mail` Bearer API token                                           |
| `MAIL_FROM`                   | `Errors <errors@sjer.red>`                      | Sender mailbox                                                                    |
| `MAIL_TO`                     | `alerts@sjer.red`                               | Alert recipient address                                                           |
| `BUGSINK_IMPORT_URL`          | _(unset)_                                       | Source Bugsink base URL for historical import                                     |
| `BUGSINK_IMPORT_TOKEN`        | _(unset)_                                       | Source Bugsink API bearer token                                                   |
| `FEATURE_FLAGS_MODE`          | _(required by flags client)_                    | `flags`, `static`, or `disabled`                                                  |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(unset)_                                       | Optional OpenTelemetry OTLP HTTP collector endpoint                               |
| `ENVIRONMENT`                 | `production`                                    | `production`, `beta`, `development`, or `test`                                    |

## Feature Flags

Runtime behavior is controlled through `@shepherdjerred/feature-flags` (`managed-flag-inventory.json`):

- `errors-ingest-enabled` — Accept Sentry SDK envelopes on the ingest endpoint.
- `errors-email-notifications-enabled` — Dispatch transactional outbox emails via `@shepherdjerred/mail` for new issues and regressions.
- `errors-tracker-creation-enabled` — Allow creating and linking Tracker `AI` issues from error issues.
- `errors-telemetry-enabled` — Enable OpenTelemetry request tracing on startup.

## HTTP Endpoints

### Ingest Listener (`ingest-app.ts`)

- `GET /healthz`
- `OPTIONS /api/:projectId/envelope` & `OPTIONS /api/:projectId/envelope/`
- `POST /api/:projectId/envelope` & `POST /api/:projectId/envelope/`

### Console & API Listener (`admin-app.ts`)

- `GET /healthz`, `GET /readyz`, `GET /metrics`
- `GET /api/v1/overview`, `GET /api/v1/ops-summary`
- `GET /api/v1/projects`, `POST /api/v1/projects`, `GET /api/v1/projects/:idOrSlug`, `PATCH /api/v1/projects/:idOrSlug`
- `GET /api/v1/issues`, `POST /api/v1/issues/bulk-update`, `GET /api/v1/issues/:id`, `PATCH /api/v1/issues/:id`
- `POST /api/v1/issues/:id/tracker-issue`
- `GET /api/v1/issues/:id/events`
- `GET /api/v1/events/:id`, `GET /api/v1/events/:id/stacktrace` (`text/markdown` or `?format=json`)
- `GET /api/v1/releases`, `POST /api/v1/releases`
- `POST /api/v1/admin/import-bugsink`
- Legacy Bugsink redirects: `GET /issues/issue/:uuid(/*)` -> `301 /issues/:uuid`, `GET /issues/:projectId(/)` -> `301 /projects/:slug`

## Full Bugsink Import

Import projects, releases, open/resolved/muted issues, full retained event payloads, stacktrace Markdown, and normalized fingerprints (with fast delta sync and zero alert email spam):

```bash
bun run import:bugsink -- --url https://bugsink.sjer.red --concurrency 8
# Preview without database writes:
bun run import:bugsink -- --url https://bugsink.sjer.red --dry-run --json
```

## Local Development

```bash
# Run standalone with seeded in-memory fixture data + Vite HMR:
bun run dev -- --fixture
```
