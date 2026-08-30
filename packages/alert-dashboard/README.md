# Alert Dashboard

`@shepherdjerred/alert-dashboard` is the homelab's durable, read-only alert
ledger. Alertmanager remains authoritative for evaluation, grouping,
inhibition, routing, and silences; this service stores occurrence history in
SQLite, serves a tailnet dashboard and API, sends grouped opening email
through Postal, and renders bounded Grafana-backed Prometheus, Loki, and Tempo
previews for firing alerts.

It is deployed: CI builds and pushes the image (the `alert-dashboard` target in
[`.buildkite/scripts/image-targets.ts`](../../.buildkite/scripts/image-targets.ts)),
the digest is pinned in
[`packages/homelab/src/cdk8s/src/versions.ts`](../homelab/src/cdk8s/src/versions.ts),
and an ArgoCD `Application`
([`argo-applications/alert-dashboard.ts`](../homelab/src/cdk8s/src/resources/argo-applications/alert-dashboard.ts))
manages the workload.

## Local development

From the repository root, point `DATABASE_URL` at a local SQLite file and apply
the Prisma migration, then:

```bash
bun install
cd packages/alert-dashboard
export DATABASE_URL="file:$PWD/data/alert-dashboard.db"
mkdir -p data
bun run generate         # Prisma client
bun run migrate:deploy   # create the SQLite schema
bun run dev
```

The package-local `data/` directory is ignored, including the primary database
and SQLite's `-wal` and `-shm` companions, so this workflow does not leave
retained alert data in the repository status.

Required configuration is validated at startup: `DATABASE_URL` (a SQLite
`file:` URL),
`ALERTMANAGER_URL`, `ALERT_DASHBOARD_WEBHOOK_TOKEN`, `GRAFANA_URL`, and
`GRAFANA_API_KEY`. Set `EMAIL_ENABLED=true` only with `POSTAL_HOST`,
`POSTAL_API_KEY`, `POSTAL_FROM`, and `POSTAL_TO` present.

The API server listens on port 7341 and the Vite dev server on 7342 (proxying
`/api` and `/trpc` to 7341). Alertmanager posts v4 webhooks to
`POST /internal/v1/alertmanager/events` with a bearer token. Public read-only
REST routes live under `/api/v1`; the UI and tRPC transport share the same
process in production (`bun run start`).

## Scripts

| Command                      | What it does                                                        |
| ---------------------------- | ------------------------------------------------------------------- |
| `bun run dev`                | API server + Vite dev server                                        |
| `bun run start`              | Production server (`src/server/index.ts`)                           |
| `bun run build`              | Prisma generate + Vite production build                             |
| `bun run generate`           | Generate the Prisma client                                          |
| `bun run typecheck`          | TypeScript (native `tsc`) after codegen                             |
| `bun run test`               | Unit tests (`bun run test src`)                                     |
| `bun run test:sqlite`        | SQLite integration test (`integration/sqlite.integration.test.ts`)  |
| `bun run test:e2e`           | Playwright end-to-end tests (`e2e/`, `playwright.config.ts`)        |
| `bun run lint`               | ESLint plus the architecture check                                  |
| `bun run check:architecture` | dependency-cruiser layering rules (`scripts/check-architecture.ts`) |
| `bun run migrate:deploy`     | Apply Prisma migrations (`prisma migrate deploy`)                   |
| `bun run docker:build`       | Build the production image locally (`alert-dashboard:dev`)          |

### Cancel incident email safely

`email:cancel-incident` is dry-run by default. It selects only unsent,
uncanceled outbox messages created in the explicit window where every linked
occurrence is `TemporalWorkflowFailed`. Confirmed cancellations atomically
record their time, operator, and reason; they do not delete ledger evidence.
The email worker atomically claims an outbox row before calling Postal, and
cancellation only matches unclaimed rows, so an in-flight send cannot race
the cancellation. Claims expire after five minutes and are reclaimable after a
process restart. Delivery is therefore at-least-once: reclaiming a claim can
duplicate a Postal message if the original worker was still alive, but the
claim token prevents that stale worker from recording the reclaimed row's
result.

```bash
bun run email:cancel-incident -- \
  --database file:/data/alert-dashboard.db \
  --from 2026-08-29T22:47:35Z \
  --to 2026-08-30T19:39:00Z \
  --operator <operator> \
  --reason "Scout retry amplification incident"

# Repeat the reviewed command with --confirm to apply it. A claimed row is
# excluded and remains owned by the sender.
```

## Architecture

The source tree is layered hexagonally and the layering is enforced by
dependency-cruiser (`dependency-cruiser.config.cjs`, run via
`check:architecture` as part of `lint`):

- `src/domain` — pure domain types and logic; may not import any other layer
- `src/application` — use cases over domain types; may not import adapters
- `src/infrastructure` — Prisma, Alertmanager, Grafana, and Postal adapters;
  may not import transports
- `src/server` — Hono HTTP server and tRPC router; may not import the client
- `src/client` — React UI; may only take type-only imports from the server

Circular dependencies are forbidden anywhere in `src/`.
