# Tracker

A first-party issue tracker for the homelab. Teams own independent issue
sequences; projects span teams. The browser and automation use the same tRPC
contract. PostgreSQL 18 owns issues, identity, votes and immutable edit history;
SeaweedFS owns attachment bytes.

The service has no application authentication. Its deployment must restrict
ingress to the tailnet and explicitly authorized cluster clients. Actor
envelopes provide attribution, not proof of identity. Do not expose this app
through a public ingress.

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
The production server serves `dist/client` itself. Migrations run with
`prisma migrate deploy`; never use `db push` against a deployed database.

Operational behavior comes from the typed configuration package and the
`tracker` Flipt namespace. `tracker-writes-enabled` and
`tracker-imports-enabled` default to false. `tracker-attachment-max-bytes`
defaults to 26214400 (25 MiB) and is bounded at 100 MiB. The independent import
gate allows a read-only rehearsal without permitting normal client writes.
`tracker-telemetry-enabled` defaults to false; enabling tracing requires
`OTEL_EXPORTER_OTLP_ENDPOINT`. `SENTRY_DSN` is an optional credential. Telemetry
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

## Verification

```sh
bunx turbo run build typecheck test lint --filter=@shepherdjerred/tracker
bun run --cwd packages/tracker test:e2e
```

Vitest and Playwright start private PostgreSQL clusters and clone an isolated
database per suite. They never use a developer or production database. The
fixtures use an in-memory object store; the production adapter always uses S3.
Database checks cover concurrent numbering/votes, rollback, stale revisions,
search, board persistence, team constraints, actor requirements, write gates,
attachment retention and deletion history. Browser checks cover desktop and
mobile issue creation, comments, votes, attachments, search, themes, peeks and
board input. The image smoke checks the non-root runtime, Prisma engine and
served SPA/assets; PostgreSQL and S3 live acceptance are separate checks.
