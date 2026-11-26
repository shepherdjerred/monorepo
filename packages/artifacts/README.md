# Artifacts

Review service for agent-made artifacts (`@shepherdjerred/artifacts`). An agent
publishes a page, a site, a PDF, a diagram, a recording or any file; Jerred
reviews it on a board, pins comments to a point in it, and the agent that is
waiting receives each comment, replies, and publishes the next version.

This package is **prepared and inactive**: it holds the Prisma schema, the
wire contract and the server. `ARTIFACTS_ACTIVE` is `false`, so the image
builds and the chart publishes, and nothing deploys. The UI, `toolkit
artifacts` and the activation each land in their own change.

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
Tracker; a browser needs no header, because the server derives
`human:<login>` from the verified Tailscale login. `wait` delivers each human
comment once, then acknowledges it, so a second `wait` returns only newer
comments. The service serves its own guide at `/agent/SKILL.md`,
`/agent/reference/{publishing,concepts,review-loop,sandbox}.md` and
`/agent/index.json`, rendered from the same limits and CDN list as the
Content-Security-Policy.

## Server

`src/index.ts` boots one `Bun.serve` listener (`idleTimeout` 60 s,
`maxRequestBodySize` the per-file limit) whose `fetch` routes on `Host`:

- **App** (`ARTIFACTS_APP_ORIGIN`): the UI, `/trpc`, `/api/uploads`,
  `/api/feedback/stream`, `/api/events/stream`, `/agent/*`. Login gate, CSRF
  rules (`src/domain/csrf.ts`), no CORS. Every response carries the app
  Content-Security-Policy (`appPolicy` in `src/domain/csp.ts`: `'self'` plus the
  content origin for images, media, fetches and frames; `frame-ancestors 'none'`).
  `/_t/*` and `/_p/*` are 404, and it never reads object bytes: only
  `src/server/content-host.ts` calls `ObjectStore.read`/`readRange`.
- **Probes on both public hosts:** `GET|HEAD /healthz` and `/readyz` answer
  before the login gate and CSRF checks (`src/server/health.ts`), with the
  internal host's body and the host's own headers. `/readyz` runs `SELECT 1`.
  Every other route stays gated.
- **Content** (`ARTIFACTS_CONTENT_ORIGIN`): `GET|HEAD|OPTIONS` of
  `/_t/<token>/*`, `/_bridge/*`, `/_viewer/*`. Every response, whatever its
  status, carries the sandbox Content-Security-Policy with sources scoped to
  the request's own token prefix (`src/domain/csp.ts`). HTML is streamed
  through `HTMLRewriter` to add `/_bridge/<hash>.js`; Mermaid artifacts get the
  self-hosted viewer at their token root.
- **Internal** (any other `Host`): `/healthz`, `/readyz`, `/metrics` and
  `/trpc/maintenance.*`. A request carrying `Tailscale-User-Login` came through
  an ingress proxy and is refused.

```text
src/shared/      contract.ts (wire contract), procedures.ts (tRPC schemas)
src/domain/      pure rules: CSP, CSRF, Range, paths, board ops, claim predicate
src/application/ use cases over Prisma: boards, artifacts, uploads, threads,
                 feedback, maintenance, inbox
src/infrastructure/  config, database, object store, LISTEN hub, metrics
src/server/      the three host handlers, tRPC router, SSE, agent guide
src/bridge/      the in-frame script injected into HTML
src/viewer/      the Mermaid viewer bundled on first request
src/client/      the review UI (Vite + React), built to dist/client
e2e/             Playwright acceptance with an in-memory fake of the service
```

Publishing is `POST /api/uploads` (manifest, idempotency key and compare-and-set
token), `PUT /api/uploads/:id/blobs/:sha256` (raw body streamed through a
counting sha256 into the object store; a mismatch deletes the object) and
`POST /api/uploads/:id/commit` (one transaction: lock, check, mint the content
token, insert the version and its files, place the frame, record the event).
A retry after a successful commit returns the original result with
`deduplicated: true`: the request digest covers the artifact target and the
manifest, not the compare-and-set token, the note or `boardTitle`. The hourly
cleanup also sweeps objects under `objects/` that no `Blob` row names (an
upload that died mid-body) once they are older than the blob grace.
`@shepherdjerred/artifacts/testing` boots the whole service in process for
other packages' tests.

A feedback stream (`/api/feedback/stream`) only wakes an agent; the CLI then
calls `feedback.claim`, prints, and calls `feedback.ack`.

### Configuration

Bootstrap environment: `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`,
`S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`ARTIFACTS_APP_ORIGIN`, `ARTIFACTS_CONTENT_ORIGIN` (origins, no path),
`ARTIFACTS_OPERATOR_LOGINS` (comma-separated Tailscale logins), `HOST`, `PORT`,
`FEATURE_FLAGS_MODE`, `ENVIRONMENT`. Everything else is typed configuration
resolved `flag -> default` (`src/infrastructure/config.ts`): the
`artifacts-enabled` flag (off pauses writes with 403 and the cleanup reports
`paused`) and the limits `artifacts-max-file-bytes`, `-max-version-bytes`,
`-max-files`, `-feedback-settle-seconds`, `-delivery-orphan-minutes`,
`-board-idle-days`, `-archive-grace-days`, `-upload-ttl-hours`,
`-blob-grace-hours` and `-event-retention-days`. The flag keys join the managed
inventory with the activation.

## Review UI

`src/client` is a React 19 / Vite single-page app on the console look
(`@shepherdjerred/console-ui`, TanStack Query, `@base-ui/react`, tRPC over
`/trpc`). `vite build` writes `dist/client`, which the app host serves.

| Route               | Shows                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| `/`                 | Inbox: Needs review, Active, Kept, Archived; Keep, Archive, expiry                      |
| `/a/:artifactId?v=` | Focused view: viewer, version switcher, thread sidebar                                  |
| `/b/:slug`          | Board as a free canvas (`src/client/canvas/`); `?view=canvas` skips the launch redirect |
| `/b/:slug/outline`  | The same board as a list: every review action is a button or link                       |

`ArtifactViewer` is the single switch over artifact kinds
(`src/client/viewers/`). Each viewer exposes an `AnchorAdapter`
(`toAnchor`, `toClient`, optional `probe` and `reveal`), so the pins overlay,
comment mode and the thread sidebar never know which kind they are on:

- **html, site, mermaid**: a sandboxed iframe (`allow-scripts allow-forms
allow-popups`, never `allow-same-origin`) at a fixed 390 / 768 / 1440 or fit
  width, scaled to the pane, `inert` until activated. The host side of the
  bridge (`bridge-protocol.ts`) mirrors `src/bridge/bridge.ts`: a
  `MessageChannel` per frame, every message schema-validated, clamped and
  rate-limited, identity from the port. Pins are `doc` anchors from the bridge's
  reported scroll and size, or approximate `frame` anchors when no bridge
  answered.
- **pdf**: pdf.js (legacy build, module worker), virtualized pages loaded by
  range, canvas at `cssScale x dpr` capped at 16 MP, text layer in the focused
  view, `page` anchors in unrotated page coordinates.
- **image, video, markdown, cast, file**: native `<img>` with wheel zoom,
  `<video preload="metadata">` with a timeline of pins, Markdown without raw
  HTML (remote images become links), the asciinema player, a download card.

**The canvas** is a hand-rolled DOM canvas, not a library. The world layer is
`translate(x, y) scale(s)` (origin 0 0, `s` from 0.05 to 4); chips, the
selection ring, pins and the toolbar live in an unscaled overlay and follow the
camera. The camera is a plain object written once per animation frame by
`controller.ts`; React hears about it once, when it settles (120 ms after a
pan, 250 ms after a zoom). `will-change: transform` is set only while it moves,
because leaving it on blurs host text. Input (`gestures.ts`): non-passive wheel
(Ctrl or Meta zooms at the cursor), Safari `gesture*` events and a two-pointer
pinch arbitrated so one pinch is applied once (`pinch.ts`), Space-drag,
middle-drag and `H` to pan, and wheel or gesture input a live frame forwards
over the bridge. `1` fits all, `2` the selection, `0` is 100 %; the camera is
stored per board in `localStorage`. Frames render in three tiers (`tiers.ts`):
the one live frame, at most 8 inert previews (4 in Firefox, lowered by two when
the frame rate over the last two seconds of motion is slow, never below 3) and
the typed placeholder card. Stacking is CSS `z-index` from the index `order`;
an iframe is never moved or remounted, because that reloads it. The outline
route stays the keyboard and screen-reader path.

**Shell.** The canvas and the focused view are full-bleed: the console-ui shell bar
and the page header are one floating pill at the top left (`shell/floating-nav.tsx`:
the workspace switcher and Inbox the bar had, then the page's title and actions;
a phone keeps the mark, the title and an overflow menu). The inbox and the outline
keep the normal bar. The comments are a floating card on the right
(`shell/comments-panel.tsx`; a bottom sheet on a phone) that collapses to a pill
with the `MessageCircle` icon, the open count and a dot while an agent waits.
Shift+C toggles it, the choice is remembered per viewer in `localStorage`, and a
pin click, J/K or a new comment opens it on the thread. While it is open the
canvas fits and reveals into what it leaves, and the viewer narrows (the
`--ar-inset-right` variable). The comment cursor and the pins are lucide's
`MessageCircle` glyph, read from its icon data (`lib/pin-shape.ts`), with the tail
tip as the hotspot and the anchor.

**Arranging** (`src/client/canvas/arrange/`). Click selects, Shift-click adds,
a drag on empty canvas draws a marquee, a drag on a frame moves the selection
(4 px threshold, pointer capture, edge auto-pan, 8 px grid, Alt for free
movement, Esc cancels), eight handles resize one frame (a fixed-viewport frame
keeps its aspect), arrows nudge by 1 px (Shift 10), `[` `]` step z-order, Delete
removes from the board after a confirm (never the artifact), Mod+Z and
Shift+Mod+Z undo and redo. The arrangement is a replicated document:
`useBoardLayout` keeps the server's index plus an outbox of
`boards.applyOps` ops (`moveFrames` with optional `w` and `h`, `reorder`,
`removeFrame`), saved 400 ms after the last edit and on `pagehide` (a
`keepalive` request). What is drawn is the index with the outbox applied on
top, and the ops are absolute, so another actor's change (an agent publishing a
frame) merges by id without moving the camera or losing a drag in progress;
a toast names the new frame with a jump-to. Undo entries record before and
after per touched frame and replay as ops against the current board.

Browser support is Baseline Widely Available. `bun run dev:client` serves the
UI with Vite against a service on `:7440`.

### End-to-end tests

```bash
bun run test:e2e        # Playwright + axe: desktop Chromium, mobile Chromium, WebKit
bun e2e/serve-demo.ts   # the fake service, seeded with one artifact of each kind
```

The suite runs against `e2e/fake-service.ts`, an in-memory implementation of
the same procedures and upload routes with a second listener for the content
origin. It serves the real injected bridge (`buildBridge`) and the real
content-host isolation headers, so the sandbox, the bridge and the viewers are
exercised end to end; swapping in the PostgreSQL-backed server only changes
`e2e/start.ts`. Playwright's bundled Firefox does not launch on macOS 27.

## Contract

`@shepherdjerred/artifacts/contract` (`src/shared/contract.ts`) is the
wire contract shared by the server, the UI and the CLI: the actor, the board
index and its operations, comment anchors, the upload manifest, feedback
items, the live-stream messages, the limits, the allowed CDN origins and the
type-only `AppRouter`. The input and output schemas of every tRPC procedure
are in `@shepherdjerred/artifacts/procedures` (`src/shared/procedures.ts`).
Neither imports server code at runtime. tRPC reserves the router key `apply`,
so the board operation procedure is `boards.applyOps`.

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
bun run start           # The server on :7440 (needs the bootstrap environment)
bun run test            # Unit tests: contract, domain, bridge, host handlers
bun run test:extended   # PostgreSQL suites: schema, publishing, feedback, cleanup
bun run typecheck
bun run lint
```
