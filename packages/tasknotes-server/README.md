# tasknotes-server

Bun + Hono server implementing the Facet sync contract (`/api/v1/sync` and REST
`/api/v1/*`) over PostgreSQL and Prisma.

## API

- `POST /api/v1/sync` — Todoist-style incremental delta pull (`sync_token`) and
  batched command execution (`commands`) with `temp_id_mapping`, `sync_status`,
  and `SyncCommandLog` UUID idempotency across tasks, projects, sections,
  labels, reminders, and saved filters.
- A task may carry an independent civil `deadline` and `recurrence_basis` (`Scheduled` or `Completion`). Omission preserves existing values on updates. Scheduled repeats retain their cadence across late completions. Timed repeats keep their wall-clock hour in `due_timezone` across daylight-saving transitions.
- Task deltas include chronological comment metadata. A `TaskUpdate` can append a text or file comment, remove its attachment, or delete a comment. A file upload (up to 16 MiB) is committed with the comment and command receipt. File contents live in private PostgreSQL storage and are fetched separately with `GET /api/v1/tasks/:taskId/comments/:commentId/file` under the same bearer and user scope.
- `/api/v1/tasks`, `/api/v1/projects`, `/api/v1/sections`, `/api/v1/labels`,
  `/api/v1/reminders`, and `/api/v1/filters` — typed REST endpoints over the same `FacetStore`.
- `TaskReschedule` applies a set of date changes atomically under one command receipt.
- `GET /api/health`, `GET /api/engine-status`, `GET /metrics` — readiness,
  storage status, and Prometheus metrics.

When `DATABASE_URL` is set, `PrismaFacetStore` persists state in PostgreSQL.
When `DATABASE_URL` is unset or empty (local UI/integration harnesses and
container smoke tests), `InMemoryFacetStore` serves the identical protocol
in-memory.

## Commands

```bash
bun run generate      # Generate the Prisma client
bun run migrate       # Apply Prisma migrations against DATABASE_URL
bun run dev           # Dev mode with reload
bun run start         # Run directly
bun run build         # Compile to dist/tasknotes-server
bun run test          # Unit and sync contract tests
bun run typecheck     # tsc --noEmit
bun run lint          # ESLint + check-architecture
bun run docker:build  # Build the container image from repo root
bun run smoke         # Smoke-test the built image
```

## Configuration

| Variable       | Required | Default     | Purpose                                                |
| -------------- | -------- | ----------- | ------------------------------------------------------ |
| `DATABASE_URL` | no       | empty       | PostgreSQL connection URL (`InMemoryFacetStore` unset) |
| `AUTH_TOKEN`   | no       | empty       | Bearer authentication token                            |
| `HOST`         | no       | `127.0.0.1` | HTTP bind address                                      |
| `PORT`         | no       | `3000`      | HTTP port                                              |
| `BUGSINK_DSN`  | no       | empty       | Optional Bugsink error reporting DSN                   |

See [AGENTS.md](AGENTS.md) for scoped invariants.
