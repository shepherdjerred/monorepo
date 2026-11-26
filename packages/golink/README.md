# @shepherdjerred/golink

First-party Tailscale `go/` short-link service for the homelab tailnet (`http://go/<slug>` / `https://go.tailnet-1a49.ts.net/<slug>`).

Combines durable PostgreSQL-backed manual short links with zero-configuration discovery of live Kubernetes Tailscale ingresses/services, repo-declared public and static sites from `packages/homelab/src/platform-model.json`, deterministic suffix-stripped aliases, and parameterized developer shortcuts.

## Resolution Precedence

Every `GET /:short` and `GET /:short/*` request evaluates five deterministic tiers in order:

1. **Manual (`manual`)**: Operator-defined links stored in PostgreSQL (`manual_links`). Always wins; if a manual link shares a slug with a lower-tier entry, the directory API exposes the overridden target under `shadows`.
2. **Cluster Ingress (`ingress`)**: Live Kubernetes `Ingress` (`ingressClassName: tailscale`) and `Service` (`loadBalancerClass: tailscale`) hostnames discovered every 30s via the in-cluster ServiceAccount (`EXCLUDED_DYNAMIC_INGRESS_SHORTS` omits migrated aliases like `alerts`/`ops`, headless gRPC/cache/S3/OTLP endpoints, and scaled-to-zero game maps). Beats `site` so dual-exposed homelab services stay tailnet-routed.
3. **Platform Site (`site`)**: Public hostnames and static sites derived deterministically from `packages/homelab/src/platform-model.json` when not already claimed by Tier 2 (`EXCLUDED_PLATFORM_HOSTNAMES` omits retired/duplicate hostnames, webhook receivers, and scaled-to-zero maps).
4. **Stripped Alias (`alias`)**: Suffix-stripped aliases (`-ui`, `-dashboard`, `-admin`, `-server`, `-service`, `-web`, `-frontend`, `-build-cache`) over Tiers 2 and 3. Ambiguous collisions pointing to distinct destinations are dropped.
5. **Parameterized Shortcut (`shortcut`)**:
   - `gh` / `gh/<rest>` -> `https://github.com/shepherdjerred/[<rest>]`
   - `mono` / `mono/<rest>` -> `https://github.com/shepherdjerred/monorepo[/<rest>]`
   - `pr` / `pr/<num>` -> `https://github.com/shepherdjerred/monorepo/pulls` or `/pull/<num>`
   - `commit/<sha>` -> `https://github.com/shepherdjerred/monorepo/commit/<sha>`
   - `ai/<num>` | `ai-<num>`, `sj/<num>` | `sj-<num>`, `fm/<num>` | `fm-<num>` -> Tracker issues and forum threads.

Tiers 1–4 forward any request subpath and merge query parameters onto the destination URL. Tiers 2–5 are gated together by the `golink-dynamic-aliases-enabled` feature flag.

## HTTP Surface

| Route                  | Method   | Description                                                                    |
| ---------------------- | -------- | ------------------------------------------------------------------------------ |
| `/healthz`             | `GET`    | Liveness probe (`200 "ok"`).                                                   |
| `/readyz`              | `GET`    | Readiness probe (`SELECT 1` on PostgreSQL; `200` or `503`).                    |
| `/metrics`             | `GET`    | Prometheus metrics (`golink_redirects_total`, `golink_links_configured`).      |
| `/.export`             | `GET`    | Tailscale golink-compatible NDJSON export of manual links.                     |
| `/api/links`           | `GET`    | Full directory catalog, shortcuts, flag states, and Tailscale viewer identity. |
| `/api/links`           | `POST`   | Upsert a manual link (gated by `golink-writes-enabled`).                       |
| `/api/links/:short`    | `DELETE` | Delete a manual link (gated by `golink-writes-enabled`).                       |
| `/`                    | `GET`    | React directory & link management SPA (see [Web UI](#web-ui)).                 |
| `/:short`, `/:short/*` | `GET`    | `302` redirect (`Cache-Control: no-store`), or `404` SPA/JSON on miss.         |

## Web UI

The SPA is laid out as a Hub page with the `@shepherdjerred/console-ui` shell and page kit, and has no router: one page, one `GET /api/links` load.

- **Sidebar.** The workspace button shows "Go links" and lists the other consoles and tools from `CONSOLE_LINKS` in `@shepherdjerred/ops-model`; the search button beside it focuses the search field. A Directory group links to the Links card and the Shortcuts reference, with counts. The theme row cycles system, light and dark (`golink-theme` in `localStorage`). Below 900px the shared `TopBar` replaces the sidebar with a menu drawer, search and theme buttons.
- **Page.** A Hub page heading with the New link button, then summary cards (links, manual, tailnet, public sites, total clicks), then the Links card.
- **Search and source filter.** The Links card's toolbar holds a search field matching slug, destination and source detail (`/` focuses it from anywhere outside a text field or dialog) and a segmented All, Manual, Tailnet, Public sites and Auto-aliases filter with counts. At phone width each table row becomes a labelled card.
- **Dialogs.** New link, Edit and Override open one native `<dialog>` (`showModal()`) with the same slug and URL validation; Delete asks for confirmation in a second dialog. Escape closes either and focus returns to the opener. A `go/<slug>` that does not exist shows a banner whose button opens the New link dialog prefilled.
- **Read-only mode.** When `golink-writes-enabled` is off the page heading shows a "Read-only" tag instead of New link, and rows show no actions.

## Development

```bash
bun run generate        # Generate Prisma client into generated/prisma
bun run dev             # Run local API server (in-memory or DATABASE_URL) + Vite
bun run typecheck       # Native TypeScript strict check
bun run lint            # ESLint (--max-warnings=0) + check-architecture
bun run test            # Domain, resolver, architecture, client render, and HTTP app unit tests
bun run test:extended   # Real PostgreSQL migration & CRUD integration suite
```
