# Feeds

First-party RSS and Atom aggregator (`@shepherdjerred/feeds`) backed by `bun:sqlite` (WAL + FTS5) with a Tailscale-only listing console (`@shepherdjerred/console-ui`) and an isolated Google Reader API listener tailored to NetNewsWire (`ReaderAPICaller`).

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

- **Code-owned (`source = 'code'`):** Public feeds in `Repo Stack` and `Blogs` live in `src/catalog/catalog.ts` alongside typed `AutoReadRule` regexes (`PRERELEASE_RULE`, negated `AI_SDK_ONLY_RULE`, and `hidden: true`). Server startup reconciles `source = 'code'` categories and feeds transactionally into SQLite without touching user feeds. Reader API and UI mutations against `code` feeds return `403`.
- **User-owned (`source = 'user'`):** Private credential-bearing feeds (such as LWN subscriber URLs) and feeds added via NetNewsWire `quickadd` or the console dialog live in SQLite. Query strings on `user` feed URLs are redacted (`?[REDACTED]`) in logs, error messages, and console listing responses.

## Commands

```bash
bun run dev        # Vite client dev server (:7432 -> :7430)
bun run start      # Start Bun HTTP server
bun run build      # Build Vite client bundle to dist/client
bun run typecheck  # Type-check with tsgo
bun run test       # Run Vitest unit, protocol, SSRF, UI, and migration suites
bun run lint       # Run ESLint
```

To import a WAL-consistent snapshot of FreshRSS's user SQLite database:

```bash
bun src/migration/import-freshrss.ts --from /tmp/freshrss-snapshot.sqlite --to /var/lib/feeds/feeds.sqlite
```
