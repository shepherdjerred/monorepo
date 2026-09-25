# Ops dashboard (`alert-dashboard`)

`@shepherdjerred/alert-dashboard` is the homelab's ops overview and durable,
read-only alert ledger. The deployed identity (package, namespace, Service,
PVC, and webhook URL) stays `alert-dashboard` so the ledger history is kept;
the UI is titled **Ops** and is served on both the `alerts` and `ops` tailnet
hosts.

It has two halves in one process:

- **Ops overview.** The Temporal `ops-snapshot` workflow posts an
  [`@shepherdjerred/ops-model`](../ops-model/README.md) snapshot and change
  events every five minutes. The dashboard stores them in SQLite, applies the
  freshness policy at read time (a stale snapshot is never green), and renders
  Overview, Services, Delivery, AI, Maintenance, and Review pages plus the
  daily and weekly digest email. Trend charts read Prometheus through named
  presets only; the browser never sends PromQL.
- **Alert ledger.** Alertmanager remains authoritative for evaluation,
  grouping, inhibition, routing, and silences; this service stores occurrence
  history, serves the Alerts, History, and System pages, sends grouped opening
  email through Postal, and renders bounded Grafana-backed Prometheus, Loki,
  and Tempo previews for firing alerts. Alert openings and resolutions also
  appear on the ops change timeline, derived from the ledger at read time.

It is deployed: CI builds and pushes the image (the `alert-dashboard` target in
[`ci/scripts/images/image-targets.ts`](../../ci/scripts/images/image-targets.ts)),
the digest is pinned in
[`packages/homelab/src/cdk8s/src/versions.ts`](../homelab/src/cdk8s/src/versions.ts),
and an ArgoCD `Application`
([`argo-applications/observability/alert-dashboard.ts`](../homelab/src/cdk8s/src/resources/argo-applications/observability/alert-dashboard.ts))
manages the workload.

## Local development

From the repository root, point `DATABASE_URL` at a local SQLite file and apply
the Prisma migration, then:

```bash
bun install
cd packages/alert-dashboard
export DATABASE_URL="file:$PWD/data/alert-dashboard.db"
export FEATURE_FLAGS_MODE=disabled
mkdir -p data
bun run generate         # Prisma client
bun run migrate:deploy   # create the SQLite schema
bun run dev
```

The package-local `data/` directory is ignored, including the primary database
and SQLite's `-wal` and `-shm` companions, so this workflow does not leave
retained alert data in the repository status.

Required configuration is validated at startup: `DATABASE_URL` (a SQLite
`file:` URL), `ALERTMANAGER_URL`, `ALERT_DASHBOARD_WEBHOOK_TOKEN`,
`GRAFANA_URL`, `GRAFANA_API_KEY`, `OPS_INGEST_TOKEN` (at least 32 characters;
the bearer token the Temporal workflow presents), and `PROMETHEUS_URL` (the
in-cluster Prometheus, `http://prometheus-operated.prometheus:9090`). Set
`EMAIL_ENABLED=true` only with `POSTAL_HOST`, `POSTAL_API_KEY`, `POSTAL_FROM`,
and `POSTAL_TO` present.

The flag client needs its bootstrap variables: `FEATURE_FLAGS_MODE` (`flipt`
in the cluster, `disabled` locally), plus `FLIPT_URL`, `FLIPT_NAMESPACE`
(`alert-dashboard`), and `FLIPT_ENVIRONMENT` in `flipt` mode. The digest email
is gated by the Flipt flag `ops-digest-email-enabled` (default off). While it
is off, `POST /internal/v1/digests/:kind` records a skipped run and sends
nothing. Digests use the Postal settings whenever all four are present,
independently of `EMAIL_ENABLED`, and are sent synchronously with a
per-period `DigestRun` claim rather than through the alert outbox, so enabling
digests cannot drain alert email that was queued while `EMAIL_ENABLED` was
off. The `DigestRun` row for each `(kind, period)` is the digest's ledger: a
request claims it, sends through Postal with a stable message id, and marks
it `sent` or `failed`. A repeated request for a sent or skipped period returns
`duplicate: true`, a failed period is retried by the next request, and a claim
older than five minutes is presumed abandoned and may be reclaimed.

`EMAIL_ENABLED` and Alertmanager's own mail are alternatives, not layers. The
`alerts` receiver carries `email_configs` alongside its webhook, so every
warning and critical alert is already mailed directly over Postal SMTP; turning
this on as well would mail the same opening twice, once from Alertmanager and
once from this outbox. Enable it only together with removing `email_configs`
from that receiver in
`packages/homelab/src/cdk8s/src/resources/argo-applications/observability/prometheus.ts`.
While it stays off, `AlertDashboardOutboxStranded` reports any rows queued
before it was disabled, since those can neither drain nor expire.

The API server listens on port 7341 and the Vite dev server on 7342 (proxying
`/api` and `/trpc` to 7341). The UI and tRPC transport share the same process
in production (`bun run start`).

| Route                                   | Purpose                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /internal/v1/alertmanager/events` | Alertmanager v4 webhook (bearer `ALERT_DASHBOARD_WEBHOOK_TOKEN`)                                                                           |
| `POST /internal/v1/ops/snapshots`       | Collector ingest `{snapshot, changes}` (bearer `OPS_INGEST_TOKEN`); validates with `parseOpsIngest`, upserts changes, prunes old snapshots |
| `POST /internal/v1/digests/:kind`       | `daily` or `weekly` digest (bearer `OPS_INGEST_TOKEN`); idempotent per Los Angeles date or ISO week                                        |
| `GET /api/v1/ops/snapshot?consumer=`    | Latest snapshot with freshness applied; `503 snapshot_unavailable` before the first ingest; `consumer=web` annotates `newSignalIds`        |
| `GET /api/v1/ops/changes`               | Change timeline (`service`, `since`, `limit`), stored events merged with alert openings and resolutions                                    |
| `GET /api/v1/ops/services/:id`          | Catalog entry, its signals, recent changes, and Grafana Explore, dashboard, and Argo CD links                                              |
| `GET /api/v1/ops/series?preset=&range=` | Named Prometheus preset (`ai-cost-by-source`, `prs-open`, `node-cpu`, …) over `24h`, `7d`, `30d`, or `90d`                                 |
| `PUT /api/v1/ops/cursor`                | `{consumer: "web", seenSignalIds}` for "mark all seen"                                                                                     |
| `GET /api/v1/ops/review?kind=`          | The digest report for the current period, as JSON                                                                                          |
| `GET /api/v1/{summary,alerts,events}`   | Alert ledger reads                                                                                                                         |

Snapshot retention runs inside ingest, not on a timer: the latest snapshot is
kept, plus the earliest sample in each UTC hour for
`OPS_POLICY.snapshotHistoryDays`. `/metrics` adds
`alert_dashboard_ops_ingest_total{result}`,
`alert_dashboard_ops_last_ingest_timestamp_seconds`,
`alert_dashboard_ops_digest_total{kind,result}`, and the shared
`feature_flag_*` series.

Webhook deliveries retain Alertmanager's `truncatedAlerts` count in their API
evidence. Opening email lists at most 25 accepted occurrences and states both
the remaining accepted count and any upstream Alertmanager truncation; every
accepted occurrence remains in the SQLite ledger.

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
| `bun run test:e2e`           | Playwright tests against the fixture server (`e2e/server.ts`)       |
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
cancellation matches active unclaimed rows plus claims expired for five
minutes, so an in-flight send cannot race cancellation while an abandoned
claim can still be cleaned up. Claims are reclaimable after a process restart.
Delivery is therefore at-least-once: reclaiming a claim can duplicate a Postal
message if the original worker was still alive, but the claim token prevents
that stale worker from recording the reclaimed row's result.

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

Pass `--alertname <name>` to target a different incident. `--all-alertnames`
instead cancels every pending row in the window regardless of alertname,
including rows carrying no occurrences at all — a truncation notice, or one
whose occurrences were since pruned. Those rows are unreachable by any
alertname and nothing else can ever clear them, but the flag also cancels
unrelated warning and critical notifications, so it is opt-in and cannot be
combined with `--alertname`.

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

`src/shared` holds the Zod API contracts both sides parse (`ops-schema.ts` for
the ops routes), and `src/test-fixtures` holds the ops-model-valid fixture
snapshot and in-memory adapters that the unit tests and the Playwright fixture
server share.

Circular dependencies are forbidden anywhere in `src/`.
