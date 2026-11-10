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

`issues.bulkUpdate` applies one `patch` (state, priority, assignee, project,
labels, archive, parent, due date; never title, description or attachments) to
1-250 unique `identifiers` in one transaction, all or nothing. It takes the
same locks as a single update in the same order: team rows (only to re-parent),
then workflow states, then issue rows by ascending ID. Each issue is updated by
the single-issue path, so it gets its own revision increment and `updated`
event, all sharing the request ID, and the sub-issue rules apply to each in
input order. Unknown identifiers are a `NOT_FOUND` naming them; an entry in
`expectedRevisions` that no longer matches is a `CONFLICT` naming the stale
issues; a state or label missing from one issue's team is a `BAD_REQUEST`
naming that issue. It returns `{ items }` in input order, shaped like
`issues.list` items.

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

## Live updates

`GET /api/events/stream` is a Server-Sent Events stream of committed changes.
An `AFTER INSERT` trigger on `Event` publishes each audit row on the
`tracker_events` PostgreSQL channel. NOTIFY is delivered only when the writing
transaction commits, and in commit order, so a message never precedes the data
it names and a rolled-back mutation publishes nothing. The server holds one
dedicated `LISTEN` connection and fans messages out to connected browsers.

Each SSE message has an `event` of `change` or `resync` and a JSON `data` body
matching `LiveMessageSchema` from `@shepherdjerred/tracker/contract`:

- `change` carries `eventId`, `entityType`, `entityId`, `issueIdentifier`
  (null for catalog changes), `action`, `actorId`, `requestId` and
  `occurredAt`. Its SSE `id` is the `eventId`. It names what changed and omits
  the content; clients refetch what they show.
- `resync` means changes may have been missed and everything shown should be
  refetched. It is the first message on every connection, and is sent again
  after the `LISTEN` connection is replaced, after a notification that fails
  validation, and to a client more than 1000 messages behind. There is no
  replay and `Last-Event-ID` is ignored.

`requestId` equals the `x-request-id` response header of the mutation that
caused the change. The change can arrive before that response does, so a client
that needs to recognise its own changes sends a UUID of its choosing in the
`X-Tracker-Request-Id` request header (`CLIENT_REQUEST_ID_HEADER` in the
contract); the server uses it as the request ID and rejects a value that is not
a UUID with 400. Without the header the server generates the ID.

The first message sets `retry: 3000`. An idle stream sends a `: heartbeat`
comment every 8 seconds, because `Bun.serve` closes connections idle for its
default 10 seconds and the server does not raise that limit.

`tracker-live-updates-enabled` defaults on. While it is off the route returns
404, the server opens no `LISTEN` connection, and open streams end within one
heartbeat. `meta.bootstrap` reports the value as `liveUpdatesEnabled`.

### In the browser

The shell holds one stream open while `liveUpdatesEnabled` is true
(`src/client/live/`). Every tRPC request and attachment upload sends a fresh
`X-Tracker-Request-Id`; the tab remembers its last 500 IDs for five minutes
and skips changes they caused, because the mutation already refetched what it
touched. A frame that fails `LiveMessageSchema` is logged, reported once in a
toast, and handled as a resync.

Changes gather for 150 ms and are deduplicated per issue, then:

- a change to a cached issue (detail or any list row) fetches
  `issues.byIdentifier` once and writes it to every cached copy, and
  refetches that issue's history if it is shown;
- an issue created elsewhere refetches the shown lists once per batch, and
  its row carries `data-fresh` for two seconds;
- a deleted issue is dropped from the cache; a change with no
  `issueIdentifier` (labels, states, projects, teams) refetches
  `meta.bootstrap`, as does a change by an actor the workspace does not list;
- shown activity, actor and vote queries refetch once per batch.

A resync refetches shown queries whose data predates a cutoff. The resync
that opens a connection uses the moment it opened, since only older data can
have missed a change; on the page's first connection it also leaves data that
arrived in the two seconds before, or is still arriving, because the same page
load fetched it. Any later resync refetches everything shown.

The browser retries a dropped stream after the server's `retry`. A refused
stream (404 while the flag is off) is not retried: bootstrap is refetched, and
showing the tab again tries once more. A tab hidden for 60 s closes its
stream and reconnects when shown. The sidebar footer and the phone header show
"Live" or "Reconnecting…"; a polite status region announces only a lost or
restored stream. An issue changed elsewhere while open shows "Updated by
<actor> just now" in its header for five seconds. Text being typed in the
title, the description editor or a comment is never replaced; the new copy
lands underneath it.

`/healthz` reports process health; `/readyz` requires PostgreSQL; `/metrics`
exports bounded request counters, issue/actor gauges, connected event-stream
clients and delivered change messages. Structured errors
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
