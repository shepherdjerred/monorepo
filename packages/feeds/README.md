# Feeds

First-party RSS and Atom aggregator (`@shepherdjerred/feeds`) backed by `bun:sqlite` (WAL + FTS5), moving to Prisma on its own PostgreSQL cluster (`feeds-postgresql`), with a Tailscale-only listing console (`@shepherdjerred/console-ui`) and an isolated Google Reader API listener tailored to NetNewsWire (`ReaderAPICaller`).

## HTTP Surfaces

The server exposes two listeners with strict surface separation:

- **Primary listener (`PORT`, `7430` in production):**
  - `GET /healthz`: Kubelet and blackbox readiness/liveness probe (`200 ok`).
  - `GET /metrics`: Prometheus gauges and HTTP request counters across both listeners.
  - `POST /internal/refresh`: Authenticated with `Authorization: Bearer $FEEDS_MACHINE_TOKEN`; triggers a single-flight bounded-concurrency poll of all non-backed-off feeds (gated by the `feeds.refresh.enabled` flag on `feeds/prod`).
  - `/api/greader.php/*`: Google Reader API endpoints (`ClientLogin` + `GoogleLogin auth=<token>` + HMAC write token `T=`).
  - `/api/v1/*` and `/*` (Vite SPA): Protected by verified Tailscale ingress proxy peer IP (`FEEDS_INGRESS_IDENTITY_DIR` in Kubernetes or `FEEDS_TRUSTED_PROXIES` locally), `Tailscale-User-Login` (`FEEDS_OPERATOR_LOGINS`), and same-origin `Origin` checks (`FEEDS_PUBLIC_ORIGIN`) on writes.
- **Public Reader API listener (`FEEDS_READER_PORT`, `7431` in production):**
  - Mounted behind `https://feeds.sjer.red` via Cloudflare Tunnel so iOS NetNewsWire can sync off-tailnet.
  - Serves **only** `GET /healthz` and `/api/greader.php/*`. All console, `/api/v1/*`, `/metrics`, and `/internal/*` paths return `404`, and `Tailscale-*` headers are never consulted.

## Subscription Ownership

- **Code-owned (`source = 'code'`):** Public feeds across `Engineering & Infra`, `AI`, and `Essays & Personal Blogs` live in `src/catalog/catalog.ts` alongside typed single or multi-clause `AutoReadRule` definitions matching `title`, `url`, or parsed RSS/Atom `<category>` tags (`STRICT_RELEASE_RULES`, `BLOG_PRERELEASE_RULE`, negated `AI_SDK_ONLY_RULE`, vendor noise rules, and `hidden: true`). Server startup reconciles `source = 'code'` categories and feeds transactionally into SQLite, removes obsolete managed categories, and retroactively sweeps unstarred unread entries against updated `autoRead` rules without touching user feeds. Reader API and UI mutations against `code` feeds return `403`.
- **User-owned (`source = 'user'`):** Private credential-bearing feeds (such as LWN subscriber URLs) and feeds added via NetNewsWire `quickadd` or the console dialog live in SQLite. Query strings on `user` feed URLs are redacted (`?[REDACTED]`) in logs, error messages, and console listing responses.

## Storage

The server reads and writes through `FeedsRepository` (`src/server/types.ts`). Two implementations keep the same behaviour, checked by one contract suite (`src/server/contract/`):

- `FeedsStore` (`src/server/store.ts`): the SQLite file at `FEEDS_DATABASE_PATH`, which production still serves from.
- `PostgresFeedsStore` (`src/server/postgres/store.ts`): Prisma on `DATABASE_URL`, schema and migrations in `prisma/`. Writes run one at a time in their own transactions, as on SQLite, so entry IDs stay newest-highest.

Search matches titles and authors. PostgreSQL stores a tsvector literal built by `src/server/search/search-tokens.ts`, which tokenizes exactly as SQLite FTS5's `unicode61` tokenizer did (its per-code-point table, `unicode61-table.json`, is checked against SQLite for every code point by `search-tokens.test.ts`; `bun run generate:unicode61` rewrites it). The same query therefore returns the same entries on both stores, newest first.

### Moving data to PostgreSQL

`src/migration/import-sqlite.ts` copies the SQLite file into PostgreSQL in one transaction from one read snapshot, then checks every gate and prints a JSON report (counts, check names and row IDs only):

1. every table has the same rows, column for column;
2. the console and Reader API read paths return the same records from both stores;
3. the same search terms return the same entries, and every title and author tokenizes as FTS5 indexed it.

```bash
# Rehearsal against the live file, from the feeds pod (DATABASE_URL is set there).
kubectl --context admin@torvalds -n feeds exec deploy/feeds -c feeds -- \
  bun src/migration/import-sqlite.ts --from /var/lib/feeds/feeds.sqlite
```

A rehearsal replaces PostgreSQL's rows and exits non-zero when a gate fails. `--cutover` does the same against a quiescent file and then records the `storage_cutover` marker in `meta`; once that marker exists the importer leaves PostgreSQL alone and a rehearsal refuses to run.

## Commands

```bash
bun run dev        # Vite client dev server (:7432 -> :7430)
bun run start      # Start Bun HTTP server
bun run build      # Build Vite client bundle to dist/client
bun run typecheck  # Type-check with tsgo
bun run test       # Run Vitest unit, protocol, SSRF, UI, and migration suites
bun run test:extended  # PostgreSQL store contract, search parity, and importer suites
bun run lint       # Run ESLint
```

To import a WAL-consistent snapshot of FreshRSS's user SQLite database:

```bash
bun src/migration/import-freshrss.ts --from /tmp/freshrss-snapshot.sqlite --to /var/lib/feeds/feeds.sqlite
```
