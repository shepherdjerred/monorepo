# Hub (`alert-dashboard`)

`@shepherdjerred/alert-dashboard` is **Hub**, the homelab's web app for
personal tools, composed of [modules](#modules). Its built-in `core` module is
the ops overview and the durable, read-only alert ledger.

Hub is the product name only. The package, namespace, Service, PVC, Flags
namespace, image, metrics, 1Password item, Argo CD Application, and webhook URL
all stay `alert-dashboard`, so the ledger history is kept. The app is served on
the `hub`, `ops`, and `alerts` tailnet hosts. The wiki's
[Why Hub is one app built from modules](../docs/wiki/src/content/docs/explanation/homelab/hub.md)
explains the naming, the module model, and why Delivery stays a separate app.

The core module has two halves in one process:

- **Ops overview.** The Temporal `ops-snapshot` workflow posts an
  [`@shepherdjerred/ops-model`](../ops-model/README.md) snapshot, change events,
  and optional typed `OpsFacets` every five minutes. The dashboard stores
  snapshots and changes in SQLite, upserts each facet key as a latest-only
  `OpsFacet` row cached in memory, applies the freshness policy at read time (a
  stale snapshot is never green), and renders Home (`/`), Services
  (`/services`), Cluster (`/cluster`), Flow (`/flow`), Monorepo (`/monorepo`),
  Renovate (`/renovate`), Product (`/product`), The Storm (`/the-storm`), AI
  (`/ai`), Maintenance (`/maintenance`), Review (`/review`), and Reports
  (`/reports`) pages plus the daily and weekly digest email. Home is the one overview page. In order it
  shows the overall status; tiles for firing alerts, what waits on Jerred, and
  Tracker triage; a card per area; a "Needs attention" list beside what is new
  since the last visit; and a launcher for Tracker, Delivery, and the tools.
  "Needs attention" lists every signal at attention severity or waiting on
  Jerred, and its filter narrows it to what waits on him (`/?show=waiting`,
  where the "Waiting on you" tile links). `/overview` was a separate page and
  now redirects to `/`, keeping its query string. Flow (pull requests and
  Tracker work) and Maintenance are section pages
  (`src/client/ops/section-page.tsx`): a summary card per snapshot section with
  every metric, then the trend charts, then a signal list per section. Flow was
  served at `/delivery`, the name of a different app; that URL redirects to
  `/flow` with its query string and fragment. A metric tile at warning, error,
  or unknown carries an accent bar and a named icon. The AI page
  (`src/client/ops/ai-page.tsx`) shows its status with the section summary that
  explains it, API spend against the monthly budget beside the section's other
  metrics, then one table of subscription quota windows grouped by provider
  beside a table of usage by tool. Quota severity comes from the snapshot: a row
  takes its signal's severity and the page never derives one from the usage
  ratio, so a short window the collector reports as informational because it is
  about to reset stays informational. A window whose reset time is at or before
  the snapshot shows its last reading as "reset · was N%". Usage by tool is
  API-equivalent spend: what each tool's usage on the Mac this month would have
  cost at API prices. Most of it runs on subscriptions, so it compares the tools
  and is not a bill. Trend charts read Prometheus through named presets only;
  the browser never sends PromQL. A chart's legend shows each series' newest
  sample until a point is hovered. Every signal list renders through
  `SignalList` (`src/client/ops/signal-list.tsx`): it collapses same-kind
  signals with ops-model's `groupSignals` (an allowlist of kinds, so alerts
  never collapse), shows a capped number of entries (ten unless the list sets
  its own), and expands in place. There is no uncapped mode; the digest email
  groups the same way before its own row cap. Change timelines cap the same way,
  at fifteen. `e2e/volume.spec.ts` bounds page height at production volume, how
  far down Home its area cards start, and how far down the section pages their
  charts start.
- **Alert ledger & House chores.** Alertmanager remains authoritative for
  evaluation, grouping, inhibition, routing, and silences; this service stores
  actionable occurrence history (excluding `Watchdog`, `InfoInhibitor`,
  `severity=info`, and `null`-only receivers at ingest), serves the Ops Active
  (`/alerts`), House (`/house`), History (`/history` with `Ops`/`House`/`All`
  scope links), and System (`/system`) pages, sends grouped opening email
  through `@shepherdjerred/mail`, pushes eligible non-`pet-care` `category=household` chores and
  dismissals durably to Home Assistant (`HomeAssistantOutbox`) when
  `HOMEASSISTANT_URL` and `HOMEASSISTANT_TOKEN` are configured, and renders
  bounded Grafana-backed Prometheus, Loki, and Tempo previews for firing alerts.
  On `/alerts` (`src/client/dashboard-page.tsx`), any retained `Watchdog`
  occurrences are hidden by default behind a URL-synced `Show Watchdog` /
  `Hide Watchdog` toggle (`?watchdog=1`, forced visible when `severity=unknown`
  or search matches `"watchdog"`), and `AlertTable` (`src/client/alert-table.tsx`)
  collapses `alertname`s with two or more occurrences into expandable
  `<details>` groups showing highest severity, occurrence count, and newest
  `openedAt` age while leaving single occurrences inline. Alert openings and
  resolutions also appear on the ops change timeline, derived from the ledger at
  read time, while daily and weekly Ops incident statistics exclude
  `category=household` chores.
- **Reports & outbound mail ledger (`/reports`).** Temporal report delivery and
  local backfill post `ReportRunIngestBatch` payloads (`ReportEnvelopeV1`,
  rendered HTML/plain-text mail, semantic `@sjer.red` sender/recipient, and
  Mail delivery or quiet-skip metadata) to `POST /internal/v1/reports/runs`,
  stored idempotently in the SQLite `ReportRun` table and broadcast over the
  SSE `changes` bus (`reason: "reports"`). Completed daily and weekly `DigestRun`
  rows archive their `DigestReport` JSON, rendered HTML/plain-text bodies,
  subject, severity, signal counts, and `skipReason`. `/reports`
  (`src/client/reports/reports-page.tsx`) combines five headline KPIs, the
  14-stream recurring schedule matrix (12 Temporal scheduled reports + daily and
  weekly Ops digests with 30-day Pacific activity strips, freshness budgets, and
  PR badges), and a unified filterable feed across scheduled reports, digests,
  agent tasks, and incident outbox mail. Deep-dive inspectors at
  `/reports/runs/:id`, `/reports/digests/:kind/:periodKey` (serving a live
  preview for the active period before its scheduled send), and
  `/reports/mail/:id` expose remediation pull requests, finding state filters,
  all passed and failed checks, raw evidence commands and excerpts, sibling run
  history, linked `/alerts/:id` occurrences, and a sandboxed HTML/plain-text
  email preview.

### Facet-backed explorer routes & Visuals Kit

Beyond the snapshot section pages, Hub serves dedicated deep-dive explorers
backed by latest-only `OpsFacets` (`@shepherdjerred/ops-model/facets.ts`) and
shared visual primitives:

| Route        | Client entry                              | Facets & data                                                                                                                                                                                                    |
| ------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/cluster`   | `src/client/ops/pages/cluster-page.tsx`   | `cluster` facet + Prometheus presets across URL-synced `?tab=` views (`nodes`, `workloads` with `?retained=1` pool toggle and degraded-first sort, `databases`, and `storage` for ZFS pools, NVMe, SeaweedFS)    |
| `/monorepo`  | `src/client/ops/pages/monorepo-page.tsx`  | `monorepo` facet + CI/Turborepo presets: 7d remote cache hit ratio and saved hours, audit strip, expensive/cache-missing tasks, and filterable workspace package directory                                       |
| `/renovate`  | `src/client/ops/pages/renovate-page.tsx`  | `renovate` facet + velocity presets: open PR concurrency and LLM delta coverage meters, `?tab=` queue buckets (`prs`, `approval`, `held`, `hygiene`, `merged`), and `?expand=` version-delta drawers             |
| `/product`   | `src/client/ops/pages/product-page.tsx`   | `product` snapshot section + `posthog` facet: 24h/7d traffic KPIs, conversion funnels with step retention, site traffic & Core Web Vitals (`p75` LCP/INP, exceptions, rageclicks), and top pages/referrers       |
| `/the-storm` | `src/client/ops/pages/the-storm-page.tsx` | `minecraft`, `storm-brain`, and `storm-forum` service health, `ts-mc.net` slice of the `posthog` facet, player/companion and `target="minecraft"` namespace presets, filtered signals/changes, `/promotion` link |
| `/reports`   | `src/client/reports/reports-page.tsx`     | `ReportRun` + archived `DigestRun` + incident `EmailOutbox` ledger: 14-stream 30d Pacific schedule matrix, URL-synced unified feed, and `/reports/{runs/:id,digests/:kind/:periodKey,mail/:id}` inspectors       |

These pages share the **Visuals Kit** (`src/client/visuals/`):

- `DataTable` (`data-table.tsx`): accessible sortable/searchable table with
  select filters, initial row caps, expandable detail rows (`renderExpanded`),
  and client-side CSV/JSON export (`formatDataTableCsv`, `formatDataTableJson`).
- `BudgetMeter` and `StackedMeter` (`meters.tsx`): capacity/endurance gauges and
  proportional segment bars.
- `Sparkline` (`sparkline.tsx`), `StatusMatrix` (`status-matrix.tsx`), and
  `StackTree` / `buildStackForest` (`stack-tree.tsx`) for inline 7d trends,
  multi-environment check grids, and stacked PR trees.
- Multi-mode `UplotChart` (`src/client/charts/uplot-chart.tsx`) and
  `SeriesChart` (`src/client/charts/series-chart.tsx`): supports `"line"`,
  `"stacked-area"`, and `"bar"` modes, horizontal `ChartThreshold` overlays,
  crosshair synchronization across sibling charts via `syncKey`
  (`getChartSync`), live resting legends, and collapsible data tables.

It is deployed: CI builds and pushes the image (the `alert-dashboard` target in
[`ci/scripts/images/image-targets.ts`](../../ci/scripts/images/image-targets.ts)),
the digest is pinned in
[`packages/homelab/src/cdk8s/src/versions.ts`](../homelab/src/cdk8s/src/versions.ts),
and an ArgoCD `Application`
([`argo-applications/observability/alert-dashboard.ts`](../homelab/src/cdk8s/src/resources/argo-applications/observability/alert-dashboard.ts))
manages the workload.

## Local development

### The Storm promotion progress

Hub includes `/promotion`, inside the shell under "The Storm" in the sidebar.
Its server forwards the read-only promotion API to the worker's internal
status Service, authenticated with `OPS_INGEST_TOKEN`; browser clients never
receive that credential.
`PROMOTION_STATUS_URL` is an optional bootstrap service-address override.
Production reads shared worker history; the standalone local launcher below
reads the local SQLite ledger instead.

On the hosted page, Reddit outreach shows the schedule, publishing and account
state, today's Pacific totals, and the 12 most recent production sweeps from
today and yesterday. Expand a sweep to see its decision counts and verified
Reddit receipts. A later verification updates the original sweep. Open reply
attempts and remaining daily reply slots come from the reply ledger.

From the repository root, run:

```bash
bun packages/temporal/scripts/promotion/dashboard.ts
```

Open `http://127.0.0.1:7342/promotion` on the Mac running the command. This
local entry (`src/client/promotion/standalone.tsx`) renders the same page
content under a minimal bar of its own instead of the Hub shell, so it uses
Hub's theme without starting alert subscriptions.
It reads the promotion SQLite database and saved reports through a read-only API
on port 7343. It needs no site credentials, Grafana, or Temporal server.
Use `--state-dir`, `--port`, and `--api-port` to select local storage and ports.

The page opens on the latest full run, including later retries and corrections.
Its headline shows completed actions, unresolved outcomes and sources not run.
Sources are grouped as working, disabled (missing setup/access or paused), or
needing attention. Normal cooldowns count as correct skips; a failed action,
unconfirmed effect or unresolved cleanup failure prevents a pass. Successful
retries and verified corrections count as working; recovery details remain in
expandable receipts and history.
An access failure is an error on its first occurrence. Two consecutive failed
executions automatically pause publishing and appear as disabled; verified
success resets that streak. Cooldown skips and previews do not count as failures.
Disabled sources and cooldown reasons expand on demand; receipts and filtered
history live beneath the summary. Targeted follow-ups do not replace the full
run. Older journals infer full scope only when they cover the current inventory.
Existing reports have unknown mode/timing where those were not recorded.
Sources omitted from a run are not skips. New local runs record scope, queued
targets, phases, outcomes and heartbeats; the page polls every five seconds.
Uncertain effects and locks are never cleared by viewing the page. Historical
receipts describe verification at the recorded time, not current visibility.

Each source shows its last started publishing run, most recent confirmed action,
and next expected scheduled opportunity in Pacific time. Previews, unstarted
inventory skips and report save times do not advance the last-run column; a
later failure does not erase the last success. The scheduled forecast reads the
live dispatch schedule and current enabled audience, then applies the runner's
cooldown, preferred posting window and daily attempt cap. It is an opportunity,
not a reserved execution: runtime availability and spend limits still apply.
Paused, disabled, held or manually run sources show the reason instead of a
date. If an older producer omits timing observations, the page derives run and
success times from the recorded execution batches and confirmed action history.
Its next planned column says `Schedule data unavailable` until the producer can
observe the schedule; the raw recorded cooldown is never presented as a planned
run.

Each source also shows its last 30 Pacific days as one cell per day. A filled
cell is a day with a confirmed post, darker for more; a heavy outline is a day
with a failed run, and a day can be both. A short bar is a run that posted
nothing and did not fail. Each publishing occurrence counts once and its
recorded attempt decides it, so a run that failed and was later confirmed is a
post. An unconfirmed attempt counts as a failure only after its run has ended,
never while that run is still in progress. Skips, previews, reconciliation and
cleanup are not activity. Confirmed
posts are known for all time, but failed and no-post runs are known only as far
back as the retained run batches, so an empty day older than the oldest batch
is drawn as a baseline meaning "no run records kept" rather than as a quiet
day. The strip links to that source's history. An older producer that does not
report activity shows `Unavailable`.

The dashboard and runner are independent processes. Closing the page or stopping
its launcher does not stop promotion execution. No publishing controls or
unattended schedule are enabled by this command. Missing/invalid local storage
is shown as unavailable; viewing does not initialize a database. Receipt files
must remain beneath the state directory. From another machine, forward the
frontend port over your existing SSH connection.

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
in-cluster Prometheus, `http://prometheus-operated.prometheus:9090`). Outbound
mail uses the credential `MAIL_API_TOKEN` and bootstrap connection setting
`MAIL_API_URL`.

Incident mail uses `alert-dashboard-email-enabled` (default on). Incident
sender and recipient come from `alert-dashboard-incident-email-from` /
`alert-dashboard-incident-email-to`, and digest sender and recipient come from
`alert-dashboard-digest-email-from` / `alert-dashboard-digest-email-to`.
These values are resolved through typed configuration at startup, so changing
them requires a restart. The defaults route incident mail to `alerts@sjer.red`
and digests to `digests@sjer.red`.

The flag client needs its bootstrap variables: `FEATURE_FLAGS_MODE` (`flags`
in the cluster, `disabled` locally), plus `FLAGS_URL` and `FLAGS_DEPLOYMENT`
(`alert-dashboard/prod`) in `flags` mode. Digests use the
Mail settings whenever all four are present,
independently of the incident-mail flag, and are sent synchronously with a
per-period `DigestRun` claim rather than through the alert outbox, so enabling
digests cannot drain alert email that was queued while incident mail was
off. The `DigestRun` row for each `(kind, period)` is the digest's ledger: a
request claims it, sends through `@shepherdjerred/mail` with a stable message id, and marks
it `sent` or `failed`. A repeated request for a sent period, or one skipped
while sending was still flag-gated, returns
`duplicate: true`, a failed period is retried by the next request, and a claim
older than five minutes is presumed abandoned and may be reclaimed. When
`alert-dashboard-daily-digest-quiet-clear` is enabled (default on in beta and
prod), a healthy, non-stale daily digest with zero `needsMe`, `attention`,
`newSinceLast`, and opened incidents whose prior completed daily digest was also
clear is recorded as `status = "skipped"` (`skipReason = "unchanged-clear"`)
without calling Mail, while still archiving the rendered digest for `/reports`
and advancing the `digest` cursor.

Incident mail and Alertmanager's own mail are alternatives. Hub's outbox sends
opening mail for ordinary warning and critical alerts (`alert-dashboard-email-enabled`
on), while Alertmanager's `alerts` receiver delivers webhook-only and
`mail-fallback` retains direct Mail STARTTLS mail for alerts that diagnose
Hub or its webhook (`packages/homelab/src/cdk8s/src/resources/argo-applications/observability/prometheus.ts`).
If `alert-dashboard-email-enabled` is turned off, `AlertDashboardOutboxStranded`
reports any rows queued before it was disabled, since those can neither drain
nor expire.

The API server listens on port 7341 and the Vite dev server on 7342 (proxying
`/api` and `/trpc` to 7341). The UI and tRPC transport share the same process
in production (`bun run start`).

To work on the client without any of that setup, run `bun run dev:fixture`. It
starts the same Vite dev server with hot reload, but puts the in-memory fixture
server (`e2e/server.ts`) on port 7341 in place of the real API. It needs no
database, credentials, Grafana, or Prometheus, and no prior `bun run build`.
`OPS_FIXTURE` selects the ops snapshot it serves:

| `OPS_FIXTURE`          | Snapshot                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `volume` (the default) | Production volume as the collector emits it today: about 220 signals, over 120 waiting on you, one signal per pending Renovate update                                                                                                                   |
| `volume-aggregate`     | The same world after the in-flight collector fixes: Renovate updates and healthy Renovate pull requests are one signal each, restore failures have their own kind, and `alerts.firing` carries its severity. About 115 signals, under 30 waiting on you |
| `default`              | The small snapshot the Playwright specs assert against                                                                                                                                                                                                  |

Any other value stops the fixture server at startup. The volume snapshots live
in `src/test-fixtures/ops-snapshot-volume.ts` and use the collector's real
signal ids, kinds, and metric ids, so they are also the fixtures to import in
client tests. Both carry a week of changes, about ninety, so the Review and
service timelines run past their cap. `FIXTURE_OPS_FACETS`
(`src/test-fixtures/ops-facets.ts`) provides schema-validated sample payloads
across all 13 `OpsFacets` keys (`renovate`, `github`, `posthog`, `bugsink`,
`flags`, `tracker`, `cloudflare`, `tailscale`, `golink`, `monorepo`, `cluster`,
`observability`, `temporal`); `src/dev.ts` attaches it to the local fixture
ingest and the unit, route, and SQLite integration suites share it. While
`OPS_FIXTURE` is set the fixture server re-ingests its snapshot every five
minutes, as the collector does, so a long-running session never goes stale.
Series charts and alert ledger pages show the fixture server's fixed sample
data.

| Route                                           | Purpose                                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /internal/v1/alertmanager/events`         | Alertmanager v4 webhook (bearer `ALERT_DASHBOARD_WEBHOOK_TOKEN`)                                                                                                     |
| `POST /internal/v1/ops/snapshots`               | Collector ingest `{snapshot, changes, facets?}` (bearer `OPS_INGEST_TOKEN`, 8 MiB limit); validates with `parseOpsIngest`, upserts `OpsFacet` rows & changes, prunes |
| `POST /internal/v1/digests/:kind`               | `daily` or `weekly` digest (bearer `OPS_INGEST_TOKEN`); idempotent per Los Angeles date or ISO week                                                                  |
| `POST /internal/v1/reports/runs`                | `ReportRunIngestBatch` upsert (bearer `OPS_INGEST_TOKEN`, 8 MiB limit); persists `ReportRun` envelopes/mail and emits `changes` (`"reports"`)                        |
| `GET /api/v1/reports/overview`                  | `/reports` KPIs and 14 recurring report/digest schedules with freshness and 30-day Pacific activity cells                                                            |
| `GET /api/v1/reports/feed`                      | Unified filterable feed (`tab`, `scheduleId`, `mailbox`, `verdict`, `delivery`, `hasPr`, `q`, `limit`) across reports, digests, agent tasks, and incident mail       |
| `GET /api/v1/reports/runs/:id`                  | Full `ReportEnvelopeV1` inspector payload, rendered HTML/plain-text mail, Mail receipt/skip metadata, and recent sibling runs                                        |
| `GET /api/v1/reports/digests/:kind/:periodKey`  | Archived `DigestRun` payload and rendered email, or a live preview when `:periodKey` is the active period                                                            |
| `GET /api/v1/reports/incidents/:id`             | Incident `EmailOutbox` metadata, linked `/alerts/:id` occurrences, and rendered HTML/plain-text email                                                                |
| `GET /api/v1/ops/snapshot?consumer=`            | Latest snapshot with freshness applied; `503 snapshot_unavailable` before the first ingest; `consumer=web` annotates `newSignalIds`                                  |
| `GET /api/v1/ops/facets`                        | All stored latest-only facets `{generatedAt, receivedAt, stale, facets}` with the snapshot staleness budget applied                                                  |
| `GET /api/v1/ops/facets/:key`                   | Single facet `{key, generatedAt, receivedAt, stale, data}` for a validated `FacetKey` (`data: null` before first ingest; `400` on invalid key)                       |
| `GET /api/v1/ops/changes`                       | Change timeline (`service`, `since`, `limit`), stored events merged with alert openings and resolutions                                                              |
| `GET /api/v1/ops/services/:id`                  | Catalog entry, its signals, recent changes, and Grafana Explore, dashboard, and Argo CD links                                                                        |
| `GET /api/v1/ops/series?preset=&range=&target=` | Named Prometheus preset (`src/domain/ops-series.ts`) over `24h`, `7d`, `30d`, or `90d`, optionally scoped by a validated `target` regex (`SeriesTargetSchema`)       |
| `PUT /api/v1/ops/cursor`                        | `{consumer: "web", seenSignalIds}` for "mark all seen"                                                                                                               |
| `GET /api/v1/ops/review?kind=`                  | The digest report for the current period, as JSON                                                                                                                    |
| `GET /api/v1/{summary,alerts,events}`           | Alert ledger reads                                                                                                                                                   |

Snapshot retention runs inside ingest, not on a timer: the latest snapshot is
kept, plus the earliest sample in each UTC hour for
`OPS_POLICY.snapshotHistoryDays`. `OpsFacet` storage is latest-only:
`PrismaOpsRepository` (`src/infrastructure/prisma-ops-repository.ts`) upserts
one row per `FacetKey` in the `OpsFacet` table inside the ingest transaction,
retains no historical facet rows, and serves reads from an in-memory facet
cache hydrated from SQLite on demand. `PrometheusSeries`
(`src/infrastructure/prometheus-series.ts`) bounds upstream range queries with a
6-concurrency abort-aware semaphore, singleflight deduplication across
concurrent subscribers (aborting upstream only when all subscribers abort), and
a 30-second TTL cache (up to 256 entries). `/metrics` adds
`alert_dashboard_ops_ingest_total{result}`,
`alert_dashboard_ops_last_ingest_timestamp_seconds`,
`alert_dashboard_ops_digest_total{kind,result}`, and the shared
`feature_flag_*` series.

The ledger writes only what changed. Reconciliation runs every 15 seconds,
but an occurrence present in consecutive snapshots with the same labels,
annotations, and suppression is not rewritten; label rows are diffed rather
than replaced. Its `lastSeenAt` is derived at read time from the latest
successful `SnapshotRun`, and frozen into the row when reconciliation first
records it missing. An unchanged snapshot writes only its `SnapshotRun` row.

An hourly retention pass deletes webhook deliveries (with their occurrence
links) once their 90-day raw-payload retention expires, and snapshot runs
older than 24 hours, always keeping the latest run and latest successful run.
It deletes in batches of 1,000 so it never holds the write lock for long.
SQLite reuses the freed pages; it does not run `VACUUM`.

Every libSQL connection gets `foreign_keys = ON`, `synchronous = NORMAL` (WAL),
and a 5-second busy timeout. libSQL opens a new connection for each
transaction, so `PrismaLibSqlWithConnectionPragmas` (`prisma-client.ts`) sets
them on each connection rather than once at startup.

Webhook deliveries retain Alertmanager's `truncatedAlerts` count in their API
evidence. Opening email lists at most 25 accepted occurrences and states both
the remaining accepted count and any upstream Alertmanager truncation; every
accepted occurrence remains in the SQLite ledger.

## Scripts

Turbo's `generate` task produces the Prisma client before `build`, `test`,
`typecheck`, and `lint`; run those through Turbo from the repository root, or
run `bun run generate` first. `test:sqlite` runs alone in its own CI step and
generates inline.

| Command                      | What it does                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `bun run dev`                | API server + Vite dev server                                                          |
| `bun run dev:fixture`        | Fixture server + Vite dev server; no database or credentials (see `OPS_FIXTURE`)      |
| `bun run start`              | Production server (`src/server/index.ts`)                                             |
| `bun run build`              | Vite production build                                                                 |
| `bun run generate`           | Generate the Prisma client                                                            |
| `bun run typecheck`          | TypeScript (native `tsc`)                                                             |
| `bun run test`               | Unit tests (`bun run test src`)                                                       |
| `bun run test:sqlite`        | SQLite integration test (`integration/sqlite.integration.test.ts`)                    |
| `bun run test:e2e`           | Playwright tests against the fixture server (`e2e/server.ts`)                         |
| `bun run lint`               | ESLint plus the architecture check                                                    |
| `bun run check:architecture` | dependency-cruiser layering rules (`check-architecture` from `packages/architecture`) |
| `bun run migrate:deploy`     | Apply Prisma migrations (`prisma migrate deploy`)                                     |
| `bun run docker:build`       | Build the production image locally (`alert-dashboard:dev`)                            |

### Cancel incident email safely

`email:cancel-incident` is dry-run by default. It selects only unsent,
uncanceled outbox messages created in the explicit window where every linked
occurrence is `TemporalWorkflowFailed`. Confirmed cancellations atomically
record their time, operator, and reason; they do not delete ledger evidence.
The email worker atomically claims an outbox row before calling Mail, and
cancellation matches active unclaimed rows plus claims expired for five
minutes, so an in-flight send cannot race cancellation while an abandoned
claim can still be cleaned up. Claims are reclaimable after a process restart.
Delivery is therefore at-least-once: reclaiming a claim takes advantage of the
mail broker's `idempotencyKey`, and the claim token prevents
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
- `src/infrastructure` — Prisma, Alertmanager, Grafana, and Mail adapters;
  may not import transports
- `src/server` — Hono HTTP server and tRPC router; may not import the client
- `src/client` — React UI; may only take type-only imports from the server

`src/shared` holds the Zod API contracts both sides parse (`ops-schema.ts` for
the ops, facet, and series routes), and `src/test-fixtures` holds the
ops-model-valid fixture snapshots, `FIXTURE_OPS_FACETS` (`ops-facets.ts`), and
in-memory adapters that the unit tests, `dev:fixture`, and the Playwright
fixture server share.

Circular dependencies are forbidden anywhere in `src/`.

### Modules

The app is composed from modules. Ops and the alert ledger are the built-in
`core` module: they stay in the layered tree above and keep their root-level
URLs. Every other module is a self-contained area with its own URL prefix.

| Half   | Contract                        | Composition root        | Where it is served                                            |
| ------ | ------------------------------- | ----------------------- | ------------------------------------------------------------- |
| Client | `src/client/platform/module.ts` | `src/client/modules.ts` | Routes and nav under the module's `basePath`                  |
| Server | `src/server/platform/module.ts` | `src/server/modules.ts` | `/api/<id>/*`, `/api/<id>/trpc`, and readiness `/readyz/<id>` |

A client module declares `id`, `title`, `icon`, `basePath`, `routes`, and
`nav`, plus optional `commands`, `search`, and `homeCards`. Home renders
every module's `homeCards` in module order, then its launcher of other apps
and tools. The core module's one card is the whole ops overview
(`src/client/ops/home-overview.tsx`), so another module's cards sit between it
and the launcher. The ⌘K command palette
(`src/client/platform/palette.tsx`) lists every module's nav entries and
`commands` and calls each `search` with the debounced query; the core module
searches catalog services and recent alerts. The router and the
shell navigation are generated from the composition root. Only `core` may use
an empty `basePath`; the registry refuses duplicate ids, duplicate routes, and
a `basePath` that collides with another module or a server path, at startup.

The shell (`src/client/shell.tsx`) is the shared console shell from
[`@shepherdjerred/console-ui`](../console-ui/README.md): a quiet sidebar beside
an inset panel that holds the page. The sidebar opens with the app switcher (a
menu of every console in `CONSOLE_LINKS` from
`@shepherdjerred/ops-model/tool-links.ts`, Hub marked current, each opening in
the same tab) and the search button for the palette, then the grouped pages,
then the theme row. Hub's look is console-ui's stylesheet and tokens; Hub's
own sheets (`src/styles/`) still use their original custom property names,
which `src/styles/legacy-tokens.css` maps onto the shared `--ui-*` tokens, and
`src/client/theme.ts` is console-ui's theme store under the `ops-theme` key.
Charts take their axis, grid and threshold colours from the same tokens.
Berkeley Mono is licensed and stays in `public/fonts`, declared by Hub's own
`@font-face`.

The sidebar is grouped. Each `nav` entry is
listed under its `group`, which defaults to the module's `title`; entries from
different modules that name the same group share one heading, and groups
appear in the order they are first declared. An entry's `label` is its short
name under that heading, and its optional `title` is the full name used where
the group is not shown: "Active" under "Alerts" is "Go to Active alerts" in
the palette, which also matches a page by its group. The registry refuses a
blank group, two entries with the same target, and an entry that points at no
declared route.

At 900px and narrower the sidebar gives way to Hub's top bar (menu button,
app switcher, search and theme) whose menu button opens the same groups in a
modal drawer. Every page renders its own `<main>` inside the panel's content
container, which is a size container named `content`: page layouts respond to
its width with `@container content (...)` rather than to the viewport, because
the sidebar makes the two differ. The document scrolls, never the panel, so
page-height checks measure the document.

A server module declares `id` and `register(app)`, plus optional `trpc`,
`ready`, and `close`. Modules mount before the `/api/*` catch-all, so an
unmatched module path still returns the shared JSON 404. `/readyz` reports the
core database only, so one module's outage does not take the pod out of
service; `/readyz/<id>` reports a single module.

A small module lives in `src/modules/<id>/`. To add one:

1. Add its id to `MODULE_IDS` in `architecture.config.ts`. That generates the
   module's boundary: it may not import the core `domain`, `application`, or
   `infrastructure` layers, or any other module.
2. Commit a negative fixture `architecture-fixtures/modules-<id>-<what>.ts`
   that breaks the boundary.
3. Register its halves in the two composition roots.

A module is one layer to the architecture checker, which refuses nested
layers, so a module cannot declare its own inner client and server layers.

A module that needs its own storage stays a separate workspace package that
exports `./hub-server` and `./hub-client`. Its `src/modules/<id>/` adapter
checks those exports with `satisfies` against the two module contracts, so
the storage never enters this package.
