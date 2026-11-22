# tasknotes-server

Bun + Hono server implementing the Facet sync contract (`/api/v1/sync`), LLM-friendly REST + OpenAPI + MCP endpoints, named API tokens (`fct_*`), and transactional mutation audit tracking over PostgreSQL and Prisma.

## API

- `POST /api/v1/sync` — Todoist-style incremental delta pull (`sync_token`) and
  batched command execution (`commands`) with `temp_id_mapping`, `sync_status`,
  and `ProcessedCommand` UUID idempotency across tasks, projects, sections,
  labels, reminders, and saved filters.
- `GET /api/v1/workspace` — Single-request context snapshot returning `server_time`, `today`, `principal`, active `projects`, `sections`, `labels`, `filters`, and `task_counts` (`open`, `completed`, `overdue`, `due_today`).
- `GET /api/v1/openapi.json` — OpenAPI 3.1.0 specification covering all `/api/v1/*` routes, schemas, enums, and bearer authentication.
- `POST /api/v1/mcp` — Stateless Streamable HTTP Model Context Protocol (MCP) JSON-RPC 2.0 endpoint (`initialize`, `ping`, `tools/list`, `tools/call`) exposing structured tools over `FacetStore`.
- `/api/v1/tasks`, `/api/v1/projects`, `/api/v1/sections`, `/api/v1/labels`,
  `/api/v1/reminders`, and `/api/v1/filters` — typed REST endpoints (`GET /`, `GET /:id`, `POST /`, `PATCH|PUT|POST /:id`, `DELETE /:id`) over the same `FacetStore`.
  - `GET /api/v1/tasks` supports filtering by `project_id`, `section_id` (or `none`), `parent_id` (or `none`), `label_id`, `completed`, `priority` (`P1`–`P4`), `due_date`, `due_before`, `due_on_or_before`, `due_after`, `due_on_or_after`, `deadline_before`, `deadline_after`, `overdue`, `tz`, `q`, `limit`, and `offset`.
  - Task lifecycle & batch routes: `POST /api/v1/tasks/:id/close`, `POST /api/v1/tasks/:id/reopen`, `POST /api/v1/tasks/:id/restore`, `POST /api/v1/tasks/move`, and `POST /api/v1/tasks/reschedule`.
  - Task comments: `GET /api/v1/tasks/:id/comments`, `POST /api/v1/tasks/:id/comments`, `DELETE /api/v1/tasks/:id/comments/:commentId`, and private attachment bytes at `GET /api/v1/tasks/:taskId/comments/:commentId/file`.
- **API Tokens & Mutation Audit:**
  - `GET /api/v1/whoami` — inspect the resolved principal (`admin` vs `api_token`), workspace `user_id`, and scopes.
  - `POST /api/v1/tokens`, `GET /api/v1/tokens`, `DELETE /api/v1/tokens/:id` — owner-only (`AUTH_TOKEN`) endpoints to mint, list, and soft-revoke named `fct_*` API tokens (`scopes`: `["read", "write"]` or `["read"]`, optional `expires_at`). Plaintext tokens are returned once on creation and stored as SHA-256 hashes.
  - `GET /api/v1/mutations` and `GET /api/v1/tasks/:id/mutations` — cursor-paginated, append-only mutation ledger recording `sync_seq`, `actor_kind`, `actor_name`, `token_id`, `token_prefix`, optional `x-facet-actor-metadata`, `source` (`sync` | `rest` | `mcp`), `changes` diff, `before`, and `after`.
- `GET /api/health`, `GET /api/engine-status` (admin-only), `GET /metrics` — readiness, storage status, and Prometheus metrics (`tasknotes_mutations_total`, `tasknotes_tasks_*`, HTTP latency).

When `DATABASE_URL` is set, `PrismaFacetStore` persists state in PostgreSQL.
When `DATABASE_URL` is unset or empty (local UI/integration harnesses and
container smoke tests), `InMemoryFacetStore` serves the identical protocol
in-memory.

## Commands

```bash
bun run generate       # Generate the Prisma client
bun run migrate        # Apply Prisma migrations against DATABASE_URL
bun run dev            # Dev mode with reload
bun run start          # Run directly
bun run build          # Compile to dist/tasknotes-server
bun run test           # Fast unit, sync, token, audit, REST, and MCP contract tests
bun run test:extended  # PostgreSQL 18 migration and PrismaFacetStore integration tests
bun run typecheck      # tsc --noEmit
bun run lint           # ESLint + check-architecture
bun run docker:build   # Build the container image from repo root
bun run smoke          # Smoke-test the built image
```

## Configuration

| Variable       | Required | Default     | Purpose                                                |
| -------------- | -------- | ----------- | ------------------------------------------------------ |
| `DATABASE_URL` | no       | empty       | PostgreSQL connection URL (`InMemoryFacetStore` unset) |
| `AUTH_TOKEN`   | no       | empty       | Owner/admin bearer authentication token                |
| `HOST`         | no       | `127.0.0.1` | HTTP bind address                                      |
| `PORT`         | no       | `3000`      | HTTP port                                              |
| `BUGSINK_DSN`  | no       | empty       | Optional Bugsink error reporting DSN                   |

See [AGENTS.md](AGENTS.md) for scoped invariants.
