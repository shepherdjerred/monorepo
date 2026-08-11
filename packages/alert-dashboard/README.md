# Alert Dashboard

`@shepherdjerred/alert-dashboard` is the homelab's durable, read-only alert
ledger. Alertmanager remains authoritative for evaluation, grouping,
inhibition, routing, and silences; this service stores occurrence history in
PostgreSQL, serves a tailnet dashboard and API, sends grouped opening email
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

From the repository root, start PostgreSQL separately, then:

```bash
bun install
cd packages/alert-dashboard
bun run generate   # Prisma client
bun run dev
```

Required configuration is validated at startup: `DATABASE_URL`,
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
| `bun run test`               | Unit tests (`bun test src`)                                         |
| `bun run test:postgres`      | PostgreSQL integration test (`integration/postgres.integration.ts`) |
| `bun run test:e2e`           | Playwright end-to-end tests (`e2e/`, `playwright.config.ts`)        |
| `bun run lint`               | ESLint plus the architecture check                                  |
| `bun run check:architecture` | dependency-cruiser layering rules (`scripts/check-architecture.ts`) |
| `bun run migrate:deploy`     | Apply Prisma migrations (`prisma migrate deploy`)                   |
| `bun run wait:database`      | Block until the database accepts connections                        |
| `bun run docker:build`       | Build the production image locally (`alert-dashboard:dev`)          |

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
