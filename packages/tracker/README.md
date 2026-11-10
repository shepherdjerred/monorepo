# Tracker

A first-party issue tracker for the homelab. Teams own independent issue
sequences; projects span teams. The browser and automation use the same tRPC
contract. PostgreSQL 18 owns issues, identity, votes and immutable edit history;
SeaweedFS owns attachment bytes.

The service has no application authentication. Its deployment must restrict
ingress to the tailnet and explicitly authorized cluster clients. Actor
envelopes provide attribution, not proof of identity. Do not expose this app
through a public ingress.

The homelab chart remains packageable while its image is unpublished by rendering
only an inactive marker. The root ArgoCD chart omits Tracker until the release
supplies a published immutable image; that gate activates its private ingress,
database, migration and service together. Writes and imports retain their
independent flags and remain disabled until acceptance.

## Development

From the repository root, install the pinned tools and workspace dependencies:

```sh
mise install
bun install --frozen-lockfile
bunx turbo run generate --filter=@shepherdjerred/tracker
```

Provide `DATABASE_URL`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` through the existing credential wrapper. The database
must be a dedicated PostgreSQL database; the bucket must already exist.
`S3_BUCKET` defaults to `tracker-attachments`, `S3_REGION` to `us-east-1`,
`HOST` to `0.0.0.0`, and `PORT` to `7351`. `ENVIRONMENT` is `production`,
`beta`, `development` or `test` and defaults to `production`.

```sh
bun run --cwd packages/tracker migrate:deploy
bun run --cwd packages/tracker dev
```

Vite serves the development UI on port 7352 and proxies API requests to 7351.
The production server serves `dist/client` itself: content-hashed `/assets/*`
are immutable for a year, a missing asset is a 404, and every other path
returns `index.html` with `no-cache` so a deploy is picked up on the next
navigation. Migrations run with
`prisma migrate deploy`; never use `db push` against a deployed database.

Operational behavior comes from the typed configuration package and the
`tracker` Flipt namespace. `tracker-writes-enabled` defaults to false.
`tracker-attachment-max-bytes` defaults to 26214400 (25 MiB) and is bounded at
100 MiB. `tracker-telemetry-enabled` defaults on in production; tracing requires
`OTEL_EXPORTER_OTLP_ENDPOINT`. `BUGSINK_DSN` is an optional credential. Telemetry
does not send request bodies, actor metadata or issue descriptions.

## Browser data layer

The UI never asks for `limit: "all"`. Lists page through `issues.list` 100 at
a time and render only the rows near the viewport; the board reads its team in
250-issue pages until the cursor ends, because a drag needs every neighbouring
card. `issues.list` returns no total, so a list shows its loaded count with a
`+` while more pages exist.

Every mutation goes through `src/client/data`. An issue edit shows at once on
each cached copy of the issue, is sent behind that issue's earlier edits with
the revision the server last returned, and on failure is taken back and
reported as a toast. A `CONFLICT` reloads the issue and retries once, except
for a description, which is never resent over someone else's text. A settled
mutation refetches only that issue, its history and the issue lists; only
catalog changes refetch `meta.bootstrap`.

Toasts are the one live region. Reversible edits offer Undo for as long as
their toast shows, also on Cmd/Ctrl+Z. The server cannot restore a deleted
issue, so a delete only hides it until its toast goes away and is sent then,
or at once when the tab is hidden or unloaded, in a request that outlives the
page. Unsent text is kept in `sessionStorage` per form and the browser asks
before a tab holding any is closed.

## Contract and invariants

Consumers import `@shepherdjerred/tracker/contract`: the `AppRouter` type and
browser-safe Zod schemas. The export has no runtime server dependency.
Reads require no identity. Every normal mutation includes an `actor` with
`key`, `kind`, `name` and `metadata`. Session keys use an explicit namespace,
such as `codex:<thread-id>`, `claude-code:<session-id>` or `human:jerred`.
An actor's first metadata is retained; later mutations update latest metadata
and the observation count.

Each mutation's actor, records and audit events commit in one transaction.
Issue updates optionally accept `expectedRevision`; board moves and deletes
require it. A stale revision returns `CONFLICT` without changing actor counts,
records or history. State columns and issues are locked in a consistent order;
team counters allocate issue numbers atomically. State and label references
cannot cross team boundaries. Votes have one row per issue and actor and their
displayed count is recomputed while holding the issue lock.

Identifiers, state names/types, label names and project slugs are the public
references. The API includes issue search/list/detail/history, comments,
relations, votes, projects, labels, states, actors and global events. Search
combines weighted PostgreSQL full-text prefix matching, title trigrams and an
identifier fast path. List filters are combined, with labels using AND.

`issues.list` returns `{ items, nextCursor, total }`. `total` counts every
issue the filter matches, regardless of `cursor` and `limit`. `nextCursor` is
an opaque keyset: it encodes the sort key and ID of the last issue served, and
the next page is every issue that sorts strictly after it. Paging is therefore
stable while issues change: nothing repeats, nothing is skipped, an issue
edited into an already-served position does not reappear, and a cursor
outlives the deletion of its issue. A cursor belongs to the ordering that
issued it; a malformed cursor, or one replayed under another sort or a
different search mode, is a `BAD_REQUEST`. Every sort and ranked search is
ordered and paged in PostgreSQL with the issue ID as the final tie-breaker.
`sort: "priority"` runs Urgent (1) to Low (4) and puts priority 0, "No
priority", last. A text search ignores `sort` and orders by rank, then open
before closed, then most recently updated.

`POST /api/attachments` accepts a multipart `file` and a base64 JSON actor in
`X-Tracker-Actor`. Uploads are staged until a subsequent issue or comment
mutation commits their IDs. Only their uploading actor can commit them.
`maintenance.cleanupStaged` removes up to 100 uncommitted files older than 24 hours
per invocation. The central Temporal `tracker-staged-attachment-cleanup` schedule
invokes it hourly on the infra Activity queue, with SKIP overlap and one Activity
attempt per run. An ambiguous response waits for the next hourly run rather than
retrying a second batch.
It registers paused until tracker is active and compatible Workflow workers are
fully promoted. Enable normal writes and unpause that schedule after acceptance;
paused writes produce a successful no-op. The cleanup retains committed files;
committed files survive deletion of
their issue or comment so historical links remain useful. Downloads stream
through `/attachments/:id/:filename`; active formats download as files and all
responses use `nosniff`. Images can be previewed in the UI.

`/healthz` reports process health; `/readyz` requires PostgreSQL; `/metrics`
exports bounded request counters and issue/actor gauges. Structured errors
include a request ID, without logging request bodies or credentials.

## Imported history

Issues imported from the previous tracker keep their source identity in
`ImportMapping`, their original reference in `externalRef` and unsupported
source fields in `sourceMetadata`, which the issue view shows as imported
metadata. The API has no import endpoints.

## Verification

```sh
bunx turbo run build typecheck test lint --filter=@shepherdjerred/tracker
bun run --cwd packages/tracker test:e2e
```

Turbo runs the shared `generate` prerequisite once before build, typecheck,
lint, and tests. These tasks consume that client without regenerating it in
parallel. Run `bun run --cwd packages/tracker generate` before invoking package
scripts directly after a schema or dependency change; the Docker build runs
generation explicitly before building.

Vitest and Playwright start private PostgreSQL clusters and clone an isolated
database per suite. They never use a developer or production database. The
fixtures use an in-memory object store; the production adapter always uses S3.
Database checks cover concurrent numbering/votes, rollback, stale revisions,
search, board persistence, team constraints, actor requirements, write gates,
attachment retention and deletion history. Browser checks cover desktop and
mobile issue creation, comments, votes, attachments, search, themes, peeks and
board input, plus history and link behavior (`?peek=`, Back, modified clicks,
filter typing), keyboard navigation, document titles, and an axe scan of the
list, board, issue, toasts, palette and settings in both color schemes that
fails on any serious or critical violation. They also cover the client data
layer: optimistic edits and Undo, the deferred delete, drafts, and a
260-issue list that must stay windowed, page in on scroll and keep its scroll
position across Back and a reload. The image smoke checks the non-root runtime, Prisma engine and
served SPA/assets; PostgreSQL and S3 live acceptance are separate checks.
