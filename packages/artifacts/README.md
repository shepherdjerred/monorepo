# Artifacts

Review service for agent-made artifacts (`@shepherdjerred/artifacts`). An agent
publishes a page, a site, a PDF, a diagram, a recording or any file; Jerred
reviews it on a board, pins comments to a point in it, and the agent that is
waiting receives each comment, replies, and publishes the next version.

This package is **prepared and inactive**: it holds the Prisma schema, the
frozen wire contract, and a health-only server. `ARTIFACTS_ACTIVE` is `false`,
so the image builds and the chart publishes, and nothing deploys. The server
routes, the UI, `toolkit artifacts` and the activation each land in their own
change.

## Hosts and isolation

One listener serves three host classes, routed on `Host`:

| Host class | Hostname                                | Serves                                                              |
| ---------- | --------------------------------------- | ------------------------------------------------------------------- |
| App        | `artifacts.tailnet-1a49.ts.net`         | The UI, `/trpc`, `/api`, `/agent`. Never object bytes               |
| Content    | `artifacts-content.tailnet-1a49.ts.net` | `GET\|HEAD\|OPTIONS /_t/<token>/*`, `/_bridge/*`, `/_viewer/*` only |
| Internal   | service DNS                             | `/healthz`, `/readyz`, `/metrics`, `/trpc/maintenance.*`            |

`ts.net` is on the Public Suffix List, so both hostnames are same-site.
Isolation therefore comes from an opaque origin, never from the hostname:
content is served under `Content-Security-Policy: sandbox allow-scripts ...`
and framed with the same sandbox tokens, without `allow-same-origin`. A
content URL carries a random 24-byte token minted at commit
(`Version.contentToken`), and sources are scoped to that token's prefix.

Every request needs a `Tailscale-User-Login` in the `operatorLogins`
configuration. There is no bearer token: agents and Jerred present the same
login, so a token would authenticate nothing new. This deviates from Flags,
Feeds and Delivery on purpose.

## How agents use it

Agents never call the service directly. `toolkit artifacts` publishes
(`publish`), blocks for feedback (`wait`), answers (`reply`) and lists
(`list`, `show`, `boards`, `guide`). The caller identifies itself with the
`X-Artifacts-Actor` header, the same base64 JSON actor `toolkit` sends to
Tracker. `wait` delivers each human comment once, then acknowledges it, so a
second `wait` returns only newer comments.

## Contract

`@shepherdjerred/artifacts/contract` (`src/shared/contract.ts`) is the frozen
wire contract shared by the server, the UI and the CLI: the actor, the board
index and its operations, comment anchors, the upload manifest, feedback
items, the live-stream messages, the limits and the allowed CDN origins. It
imports nothing from the server. The tRPC `AppRouter` type joins it with the
server change.

## Data

`prisma/schema.prisma` and `prisma/migrations/`. The migration also holds what
Prisma cannot express: lowercase-hex `CHECK` constraints on every SHA-256, a
`Board.revision > 0` check, a partial index over unhandled `Delivery` rows, and
an `AFTER INSERT` trigger on `Event` that sends `pg_notify('artifacts_events')`
with ids only.

## Commands

```bash
bun run generate        # Prisma client into generated/prisma
bun run migrate:deploy  # Apply migrations to DATABASE_URL
bun run start           # Health-only server on :7440
bun run test            # Contract and server unit tests
bun run test:extended   # Migration, trigger and constraint tests (needs PostgreSQL)
bun run typecheck
bun run lint
```
