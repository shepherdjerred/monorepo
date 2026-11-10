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

An issue may have one parent in its own team (`parentIdentifier` on create and
update; `null` detaches). A hierarchy is at most five levels deep, counting the
top-level issue, and an issue can never be its own ancestor: a parent in
another team, a cycle or a deeper nesting is a `BAD_REQUEST`. Creating,
re-parenting and deleting an issue hold the team row before any state or issue
lock, so concurrent changes cannot build a cycle or exceed the depth between
them. An archived issue takes no new sub-issues but keeps the ones it has, and
its sub-issues stay visible. Deleting a parent detaches its sub-issues, which
become top-level; the deletion event keeps the list. List items carry `parent`
(`{ identifier, title }` or `null`), `childCount` and `completedChildCount`;
the detail adds `children` in board order (workflow position, board order,
number). Counts and `children` leave out archived sub-issues, and "completed"
means a state of type `completed`. `parentIdentifier` and `hasParent` filter
lists.

`dueDate` is a calendar day, `YYYY-MM-DD`, stored as a PostgreSQL `date` with no
time or time zone; impossible dates are rejected. `dueBefore` and `dueAfter`
are inclusive and never match an issue without a due date. `overdue` means
strictly before `today`, a day the caller must supply because the server does
not guess anyone's time zone; it ignores issue state, so combine it with
`states` to leave out finished work. `sort: "due"` lists the soonest first and
issues without a due date last.

Saved views (`views.list/create/update/delete/reorder`, also in
`meta.bootstrap`) store a name, a short icon string and the issue-list URL
parameters as a JSON object of strings and string arrays. Its keys are limited
to the `issues.list` input names, without `cursor`, `limit` and `today`, plus
the display keys `group` and `view`; values are not interpreted by the server.
A view is global or belongs to one team, and a team's list includes the global
views. Views share one explicit order: `reorder` takes every view ID exactly
once. Parent, due date and view changes are audited like every other field.

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
list, board, issue, palette and settings in both color schemes that fails on
any serious or critical violation. The image smoke checks the non-root runtime, Prisma engine and
served SPA/assets; PostgreSQL and S3 live acceptance are separate checks.
