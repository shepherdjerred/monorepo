# Feeds

First-party RSS and Atom aggregator (`@shepherdjerred/feeds`) backed by Prisma on its own PostgreSQL cluster (`feeds-postgresql`), with a Tailscale-only listing console (`@shepherdjerred/console-ui`) and an isolated Google Reader API listener tailored to NetNewsWire (`ReaderAPICaller`).

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

- **Code-owned (`source = 'code'`):** Public feeds across `Engineering & Infra`, `AI`, and `Essays & Personal Blogs` live in `src/catalog/catalog.ts` alongside typed single or multi-clause `AutoReadRule` definitions matching `title`, `url`, or parsed RSS/Atom `<category>` tags (`STRICT_RELEASE_RULES`, `BLOG_PRERELEASE_RULE`, negated `AI_SDK_ONLY_RULE`, vendor noise rules, and `hidden: true`). Server startup reconciles `source = 'code'` categories and feeds transactionally into PostgreSQL, removes obsolete managed categories, and retroactively sweeps unstarred unread entries against updated `autoRead` rules without touching user feeds. Reader API and UI mutations against `code` feeds return `403`.
- **User-owned (`source = 'user'`):** Private credential-bearing feeds (such as LWN subscriber URLs) and feeds added via NetNewsWire `quickadd` or the console dialog live in PostgreSQL. Query strings on `user` feed URLs are redacted (`?[REDACTED]`) in logs, error messages, and console listing responses.

## Storage

The server reads and writes through `FeedsRepository` (`src/server/types.ts`), served by `PostgresFeedsStore` (`src/server/postgres/store.ts`): Prisma on `DATABASE_URL` (required), with schema and migrations in `prisma/`. Writes run one at a time, each in its own transaction, so entry IDs stay newest-highest.

One contract suite (`src/server/contract/`) defines the store's behaviour and runs against PostgreSQL in the extended test tier.

Search matches titles and authors. PostgreSQL stores a tsvector literal built by `src/server/search/search-tokens.ts`, which tokenizes exactly as SQLite FTS5's `unicode61` tokenizer did (its per-code-point table, `unicode61-table.json`, is checked against SQLite for every code point by `search-tokens.test.ts`; `bun run generate:unicode61` rewrites it). The same query therefore returns the same entries that FTS5 did, newest first.

## Commands

```bash
bun run dev        # Vite client dev server (:7432 -> :7430)
bun run start      # Start Bun HTTP server
bun run build      # Build Vite client bundle to dist/client
bun run typecheck  # Type-check with tsgo
bun run test       # Run Vitest unit, protocol, SSRF, and UI suites
bun run test:extended  # PostgreSQL store contract and search parity suites
bun run lint       # Run ESLint
```
