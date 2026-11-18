# tasknotes-server

Bun + Hono server implementing the Facet sync contract (`/api/v1/sync` and REST
`/api/v1/*`) over PostgreSQL and Prisma.

## API

- `POST /api/v1/sync` — Todoist-style incremental delta pull (`sync_token`) and
  batched command execution (`commands`) with `temp_id_mapping`, `sync_status`,
  and `SyncCommandLog` UUID idempotency across tasks, projects, sections,
  labels, comments, reminders, saved filters, and user preferences.
- `/api/v1/tasks`, `/api/v1/projects`, `/api/v1/sections`, `/api/v1/labels`,
  `/api/v1/comments`, `/api/v1/reminders`, `/api/v1/filters`,
  `/api/v1/preferences` — typed REST endpoints over the same `FacetStore`.
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
